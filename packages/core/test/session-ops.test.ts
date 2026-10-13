/**
 * The two session-level tools: `spawn_session` only suggests and returns at once; `archive_session`
 * only leaves the host a request to archive after this turn, then ends the turn.
 *
 * Guards three things that are hard to see once they go wrong:
 *   - bad arguments go back at once, naming the field, rather than drawing a card with no title or
 *     half a prompt;
 *   - the archive call is where the turn stops — the model is not asked again, or its answer would
 *     land after the conversation was filed away;
 *   - a sub-agent gets neither: it is not a conversation, a card it suggested has nowhere to be
 *     drawn, and an archive it asked for would file away the conversation of whoever dispatched it.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { createSessionOpsTools, type SessionSuggestionDetails } from "../src/runtime/session-ops.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { runSubAgent } from "../src/runtime/sub-agent.ts";
import type { AgentDefinition } from "../src/tools/task.ts";
import { emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig, type Tool, type ToolContext } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model", providerId: "fake", modelId: "model", name: "Fake",
	contextWindow: 100_000, maxOutputTokens: 4096,
	supportsThinking: false, supportsImages: false, supportsTools: true,
};
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full", autoSummarizeTitle: false };

let root: string;
const previous = { home: process.env.LYRA_HOME };
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-session-ops-"));
	// Sessions write scratch space and memory under the app's home; keep both out of the real one.
	process.env.LYRA_HOME = join(root, "home");
});
after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const host = () => {
	const asked: { sessionId: string; reason?: string }[] = [];
	return { asked, tools: createSessionOpsTools({ archiveAfterTurn: (sessionId, reason) => asked.push({ sessionId, reason }) }) };
};
const named = (tools: Tool[], name: string) => {
	const tool = tools.find((one) => one.name === name);
	assert.ok(tool, `${name} 不在工具表里`);
	return tool;
};
const ctx = (sessionId = "s-1"): ToolContext => ({ cwd: "/tmp", sessionId, state: new Map() });
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map((part) => part.text ?? "").join("");

const BRIEF = {
	title: "删掉没人调用的分组函数",
	summary: "改侧栏时看到 groupLegacy 已经没有调用方了。新会话会确认后删掉它和它的测试。",
	prompt: "In packages/desktop/src/lib/sidebar-grouping.ts, `groupLegacy` has no callers. Confirm with a search, delete it and its tests, run pnpm test.",
};

test("spawn_session 立刻返回：说清楚什么都还没开始，卡片要的三样原样（去掉首尾空白）放进 details", async () => {
	const { tools, asked } = host();
	const result = await named(tools, "spawn_session").execute({ title: `  ${BRIEF.title} `, summary: BRIEF.summary, prompt: `\n${BRIEF.prompt}\n` }, ctx());
	assert.equal(result.isError, undefined);
	assert.equal(result.terminate, undefined, "建议之后这一轮照常往下走");
	assert.deepEqual(result.details, { kind: "session_suggestion", ...BRIEF } satisfies SessionSuggestionDetails);
	assert.match(text(result), /Nothing has started/);
	assert.match(text(result), /Carry on with the current task/);
	assert.equal(asked.length, 0, "建议不碰宿主");
});

test("spawn_session 的参数不合格就退回去，并且点名是哪一项", async () => {
	const { tools } = host();
	const spawn = named(tools, "spawn_session");
	const cases: [Record<string, unknown>, RegExp][] = [
		[{ summary: BRIEF.summary, prompt: BRIEF.prompt }, /^title is required/],
		[{ ...BRIEF, summary: "   " }, /^summary is required/],
		[{ ...BRIEF, prompt: 42 }, /^prompt is required/],
		[{ ...BRIEF, title: "a".repeat(61) }, /^title is 61 characters; keep it to 60/],
	];
	for (const [args, message] of cases) {
		const result = await spawn.execute(args, ctx());
		assert.equal(result.isError, true, JSON.stringify(args));
		assert.match(text(result), message);
		assert.equal(result.details, undefined, "退回去的调用不留卡片的料");
	}
	// Counted in characters, not UTF-16 units: sixty Han characters are sixty characters.
	const wide = await spawn.execute({ ...BRIEF, title: "删".repeat(60) }, ctx());
	assert.equal(wide.isError, undefined);
	const astral = await spawn.execute({ ...BRIEF, title: "𝒜".repeat(60) }, ctx());
	assert.equal(astral.isError, undefined, "60 个增补平面字符也是 60 个字");
});

test("archive_session 交一张条子给宿主，然后要求结束这一轮", async () => {
	const { tools, asked } = host();
	const result = await named(tools, "archive_session").execute({ reason: " 修好了 " }, ctx("s-42"));
	assert.equal(result.isError, undefined);
	assert.equal(result.terminate, true);
	assert.deepEqual(asked, [{ sessionId: "s-42", reason: "修好了" }]);
	assert.deepEqual(result.details, { kind: "session_archive", reason: "修好了" });
	assert.match(text(result), /Settings › Archived chats/);

	const bare = await named(tools, "archive_session").execute({}, ctx("s-43"));
	assert.equal(bare.terminate, true);
	assert.deepEqual(asked[1], { sessionId: "s-43", reason: undefined });
});

test("archive_session 不替子代理归档，也不收不像话的 reason", async () => {
	const { tools, asked } = host();
	const archive = named(tools, "archive_session");
	const sub = await archive.execute({}, ctx("s-1:sub:1a2b3c4d"));
	assert.equal(sub.isError, true);
	assert.match(text(sub), /sub-agent cannot/);
	const odd = await archive.execute({ reason: 7 }, ctx());
	assert.equal(odd.isError, true);
	assert.equal(asked.length, 0, "两次都没交条子");
});

/** One assistant reply: a sentence, then a tool call. */
function says(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
	return { role: "assistant", content, api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), stopReason, timestamp: Date.now() };
}

const STORE = (id: string) =>
	({
		create: async () => ({ id, projectId: "p", cwd: root, title: "", updatedAt: 1 }),
		listSessions: async () => [],
		messages: async () => [],
		append: async (meta: unknown) => meta,
	}) as never;

test("归档那一下之后，这一轮就停在那儿：模型不再被问，收尾是 done 而不是 aborted", async () => {
	const { tools, asked } = host();
	const timeline: string[] = [];
	let requests = 0;
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("archive-1"),
		extraTools: tools,
		emit: async (event: AgentEvent) => {
			if (event.type === "agent_end") timeline.push(`agent_end:${event.reason}`);
			if (event.type === "tool_end") timeline.push(`tool_end:${event.toolName}`);
		},
		streamFn: async () => {
			requests += 1;
			if (requests === 1) return says([{ type: "text", text: "都做完了，按你说的归档。" }, { type: "toolCall", id: "c-archive", name: "archive_session", arguments: { reason: "做完了" } }]);
			return says([{ type: "text", text: "这句不该被要出来" }], "stop");
		},
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "修完就归档" }]);
	await session.dispose();

	assert.equal(requests, 1, "工具返回之后没有再问模型");
	assert.deepEqual(timeline, ["tool_end:archive_session", "agent_end:done"]);
	assert.deepEqual(asked, [{ sessionId: "archive-1", reason: "做完了" }]);
	const result = session.messages.find((message) => message.role === "toolResult");
	assert.ok(result?.role === "toolResult" && !result.isError && result.terminate === true, "结果记下来了，而且记着它结束了这一轮");
});

test("建议之后这一轮照常往下走：模型拿到结果，接着把话说完", async () => {
	const { tools } = host();
	const ends: string[] = [];
	let requests = 0;
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("spawn-1"),
		extraTools: tools,
		emit: async (event: AgentEvent) => {
			if (event.type === "agent_end") ends.push(event.reason);
		},
		streamFn: async () => {
			requests += 1;
			if (requests === 1) return says([{ type: "toolCall", id: "c-spawn", name: "spawn_session", arguments: BRIEF }]);
			return says([{ type: "text", text: "主任务做完了。" }], "stop");
		},
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "修这个 bug" }]);
	await session.dispose();
	assert.equal(requests, 2, "建议没有打断这一轮");
	assert.deepEqual(ends, ["done"]);
});

/** Dispatch one sub-agent and record the tool names its first request was offered. */
async function toolsSeenBy(definition: AgentDefinition, tools: Tool[]): Promise<string[]> {
	const seen: string[][] = [];
	await runSubAgent(
		{
			sessionId: "s-1",
			cwd: root,
			settings: { thinking: "off", retryAttempts: 0, maxConcurrentSubAgents: 4, providers: [] } as unknown as Settings,
			tools,
			skills: [],
			agents: [definition],
			requestApproval: async () => "once",
			emit: async () => {},
			streamFn: async (context) => {
				seen.push(context.tools.map((tool) => tool.name));
				return says([{ type: "text", text: "好" }], "stop");
			},
		},
		{ description: "看一眼", prompt: "看一眼", agentType: definition.name },
		PROVIDER,
		MODEL,
		"",
	);
	assert.ok(seen.length > 0, "子代理至少问了一次模型");
	return seen[0];
}

test("子代理拿不到这两个工具：`tools: \"*\"` 拿不到，点名要也拿不到", async () => {
	const { tools } = host();
	const read: Tool = { name: "read", description: "r", snippet: "r", parameters: { type: "object" }, execute: async () => ({ content: [] }) };
	const everything = await toolsSeenBy({ name: "general", description: "g", systemPrompt: "do", tools: "*" } as AgentDefinition, [read, ...tools]);
	assert.ok(everything.includes("read"), `其余的工具照给：${everything.join(",")}`);
	assert.ok(!everything.includes("spawn_session") && !everything.includes("archive_session"), `general 拿到了会话级工具：${everything.join(",")}`);

	const asking = await toolsSeenBy({ name: "picky", description: "p", systemPrompt: "do", tools: ["read", "spawn_session", "archive_session"] } as AgentDefinition, [read, ...tools]);
	assert.ok(asking.includes("read"));
	assert.ok(!asking.includes("spawn_session") && !asking.includes("archive_session"), `点名要也不给：${asking.join(",")}`);
});
