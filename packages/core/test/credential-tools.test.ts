/**
 * The tools a credential passes through, run for real.
 *
 * `bash` runs actual commands: the token printed back, the askpass helper made to print the
 * password, a prompt it refuses — and every one of them reaches the result, and the output log on
 * disk, as `[credential:name]`. The tool runner is held to masking whatever any tool returns or
 * streams, to withholding a result it cannot check, and to masking what a permission card shows.
 */

import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runTools } from "../src/agent/tool-run.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { AgentRunConfig } from "../src/agent/loop.ts";
import { CredentialBroker } from "../src/credentials/broker.ts";
import { memoryStore } from "../src/credentials/store.ts";
import type { CredentialAccess, CredentialAsk } from "../src/credentials/types.ts";
import { bashTool } from "../src/tools/bash.ts";
import { editTool } from "../src/tools/edit.ts";
import { markRead } from "../src/tools/read.ts";
import { requestCredentialTool } from "../src/tools/request-credential.ts";
import { writeTool } from "../src/tools/write.ts";
import type { ApprovalRequest, Tool, ToolContext, ToolResult } from "../src/types.ts";

const TOKEN = "lin_api_9f8e7d6c5b4a";
const PASSWORD = "Tr0ub4dor&3-kzhy";
let dir: string;
let conversation: CredentialAccess;
let credentials: CredentialBroker;

const fill = (values: Record<string, string>): CredentialAsk => async (request) => {
	await credentials.submit(request.credential!.key, { values });
	return "once";
};

before(async () => {
	dir = await mkdtemp(join(tmpdir(), "ly-cred-tools-"));
	credentials = new CredentialBroker({ vault: memoryStore(), runtimeDir: tmpdir });
	conversation = credentials.forSession("s1");
	await conversation.request({ name: "linear-token", title: "Linear", purpose: "查", kind: "token" }, fill({ token: TOKEN }));
	await conversation.request({ name: "kzhy-root", title: "kzhy", purpose: "改配置", kind: "password", target: "ssh://root@100.64.0.5" }, fill({ password: PASSWORD }));
});

after(async () => {
	await rm(dir, { recursive: true, force: true });
});

function context(asked: ApprovalRequest[] = []): ToolContext {
	return {
		cwd: dir,
		sessionId: "s1",
		state: new Map(),
		scratchDir: join(dir, "scratch"),
		credentials: conversation,
		requestApproval: async (request) => {
			asked.push(request);
			return "once";
		},
	};
}

/** As `read` records a whole file it showed: every line, so an edit anywhere in it is allowed. */
async function shown(ctx: ToolContext, file: string): Promise<void> {
	const content = await readFile(file, "utf8");
	markRead(ctx, file, content, 1, content.split("\n").length);
}

const text = (result: ToolResult) => result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");

test("request_credential：给模型的话里有用法，没有值；没填时叮嘱别让人贴进对话", async () => {
	const ctx = context();
	const provided = await requestCredentialTool.execute({ name: "linear-token", title: "Linear", purpose: "查 issue", kind: "token" }, ctx);
	assert.match(text(provided), /You cannot see its value/);
	assert.match(text(provided), /\$LINEAR_TOKEN/);
	assert.equal(JSON.stringify(provided).includes(TOKEN), false);

	const refused = await requestCredentialTool.execute({ name: "other", title: "x", purpose: "y", kind: "password" }, { ...ctx, requestApproval: async () => "reject" });
	assert.match(text(refused), /Do not ask them to paste it into the conversation/);

	const noHost = await requestCredentialTool.execute({ name: "x", title: "x", purpose: "y", kind: "password" }, { ...ctx, credentials: undefined });
	assert.equal(noHost.isError, true);
});

test("bash：命令打印出的令牌在结果里、在磁盘上的输出日志里都是标记", { skip: process.platform === "win32" }, async () => {
	const result = await bashTool.execute({ command: `printf 'token=%s\\n' "$LINEAR_TOKEN"; printf '%s' "$LINEAR_TOKEN" | base64`, credentials: ["linear-token"] }, context());
	assert.equal(result.isError, false, text(result));
	assert.match(text(result), /token=\[credential:linear-token\]/);
	assert.equal(text(result).includes(TOKEN), false);
	assert.equal(text(result).includes(Buffer.from(TOKEN).toString("base64").slice(2, 12)), false, "nor its base64");
	const details = result.details as { outputPath?: string; credentials?: string[] };
	assert.deepEqual(details.credentials, ["linear-token"]);
	if (details.outputPath) assert.equal((await readFile(details.outputPath, "utf8")).includes(TOKEN), false, "the log on disk is masked as it is written");
});

test("bash：askpass 真把密码交出来时也被换掉；它不肯回答的提示写进结果", { skip: process.platform === "win32" }, async () => {
	const result = await bashTool.execute(
		{
			command: `"$SSH_ASKPASS" "root@100.64.0.5's password: "; echo "wrapper=$SSH_ASKPASS"; "$SSH_ASKPASS" "root@evil.example's password: " || echo refused`,
			credentials: ["kzhy-root"],
		},
		context(),
	);
	const output = text(result);
	assert.match(output, /\[credential:kzhy-root\]/);
	assert.equal(output.includes(PASSWORD), false);
	assert.match(output, /refused/);
	assert.match(output, /did not answer "root@evil\.example's password:" — none of this command's credentials is bound to that destination/);
	const wrapper = /wrapper=(\S+)/.exec(output)![1]!;
	await assert.rejects(access(wrapper), "the socket directory is gone once the command ends");
});

test("bash：点了这个对话没有的凭据，命令不跑，告诉模型去要", async () => {
	const asked: ApprovalRequest[] = [];
	const result = await bashTool.execute({ command: "echo hi", credentials: ["nope"] }, context(asked));
	assert.equal(result.isError, true);
	assert.match(text(result), /request_credential/);
	assert.equal(asked.length, 0, "no permission card for a command that cannot run");
	const noHost = await bashTool.execute({ command: "echo hi", credentials: ["linear-token"] }, { ...context(), credentials: undefined });
	assert.equal(noHost.isError, true);
});

test("bash：要审批的命令，卡片上写着它会拿到哪些凭据", { skip: process.platform === "win32" }, async () => {
	const asked: ApprovalRequest[] = [];
	await bashTool.execute({ command: "true && echo done", credentials: ["linear-token"] }, context(asked));
	assert.deepEqual(asked.map((request) => request.credentials), [["linear-token"]]);
});

const MODEL = { id: "m", providerId: "p", modelId: "m", name: "m", contextWindow: 1000, maxOutputTokens: 100, supportsThinking: false, supportsImages: false, supportsTools: true };

function toolThat(behave: (ctx: ToolContext) => Promise<ToolResult>): Tool {
	return { name: "leaky", description: "", snippet: "", parameters: { type: "object" }, execute: (_args, ctx) => behave(ctx) } as Tool;
}

async function runOne(tool: Tool, config: Partial<AgentRunConfig> = {}): Promise<{ events: AgentEvent[]; result: string }> {
	const events: AgentEvent[] = [];
	const asked: ApprovalRequest[] = [];
	const messages = await runTools(
		[{ type: "toolCall", id: "c1", name: tool.name, arguments: {} }],
		{
			sessionId: "s1",
			cwd: dir,
			provider: { id: "p" } as never,
			model: MODEL as never,
			systemPrompt: "",
			tools: [tool],
			messages: [],
			credentials: conversation,
			requestApproval: async (request) => {
				asked.push(request);
				events.push({ type: "notice", level: "info", message: JSON.stringify(request) });
				return "once";
			},
			...config,
		} as AgentRunConfig,
		new Map(),
		(event) => void events.push(event),
	);
	return { events, result: JSON.stringify(messages) };
}

test("出口：任何工具的结果和流式进度都在发出之前换掉", async () => {
	const { events, result } = await runOne(
		toolThat(async (ctx) => {
			ctx.onProgress?.({ content: [{ type: "text", text: `partial ${PASSWORD}` }] });
			return { content: [{ type: "text", text: `got ${PASSWORD}` }], details: { url: `https://x/?t=${TOKEN}` } };
		}),
	);
	assert.equal(result.includes(PASSWORD) || result.includes(TOKEN), false);
	assert.match(result, /got \[credential:kzhy-root\]/);
	assert.equal(JSON.stringify(events).includes(PASSWORD), false, "tool_update and tool_end both masked");
});

test("出口：查不了的结果整条拦下，不放原文过去", async () => {
	const cycle: Record<string, unknown> = { leak: PASSWORD };
	cycle.self = cycle;
	const { result } = await runOne(toolThat(async () => ({ content: [{ type: "text", text: PASSWORD }], details: cycle })));
	assert.equal(result.includes(PASSWORD), false);
	assert.match(result, /withheld/);
});

test("审批卡片上显示的内容也换掉——卡片会写进会话日志", async () => {
	const { events } = await runOne(
		toolThat(async (ctx) => {
			await ctx.requestApproval!({ kind: "edit", title: `Edit ${TOKEN}`, detail: `+ key=${PASSWORD}`, subject: "/a/b" });
			return { content: [{ type: "text", text: "ok" }] };
		}),
	);
	const card = events.find((event) => event.type === "notice")!;
	assert.equal(JSON.stringify(card).includes(PASSWORD) || JSON.stringify(card).includes(TOKEN), false);
	assert.match(JSON.stringify(card), /\[credential:kzhy-root\]/);
});

test("edit：照着读到的标记改，按原值匹配、原值留在文件里；不问「写入凭据」", async () => {
	const file = join(dir, "config.env");
	await writeFile(file, `HOST=100.64.0.5\nPASSWORD=${PASSWORD}\n`);
	const asked: ApprovalRequest[] = [];
	const ctx = context(asked);
	await shown(ctx, file);
	const result = await editTool.execute({ path: file, old_string: "PASSWORD=[credential:kzhy-root]", new_string: "ROOT_PASSWORD=[credential:kzhy-root]" }, ctx);
	assert.equal(result.isError, undefined, text(result));
	assert.equal(await readFile(file, "utf8"), `HOST=100.64.0.5\nROOT_PASSWORD=${PASSWORD}\n`);
	assert.equal(asked[0]!.mustAsk, undefined);
});

test("edit / write：把凭据写进原来没有它的文件，任何模式都要人点头；拒绝就不写", async () => {
	const file = join(dir, "deploy.yml");
	await writeFile(file, "host: 100.64.0.5\n");
	const asked: ApprovalRequest[] = [];
	const ctx = { ...context(asked), requestApproval: async (request: ApprovalRequest) => (asked.push(request), "reject" as const) };
	await shown(ctx, file);
	const edited = await editTool.execute({ path: file, old_string: "host: 100.64.0.5", new_string: "host: 100.64.0.5\npassword: [credential:kzhy-root]" }, ctx);
	assert.equal(edited.isError, true);
	assert.equal(asked[0]!.mustAsk, true);
	assert.deepEqual(asked[0]!.credentials, ["kzhy-root"]);
	assert.match(asked[0]!.title, /Write kzhy-root into/);
	assert.equal(await readFile(file, "utf8"), "host: 100.64.0.5\n");

	const written = await writeTool.execute({ path: join(dir, "new.env"), content: "TOKEN=[credential:linear-token]\n" }, ctx);
	assert.equal(written.isError, true);
	assert.equal(asked[1]!.mustAsk, true);
	await assert.rejects(access(join(dir, "new.env")));
});
