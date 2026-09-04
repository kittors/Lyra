/**
 * 后台抽取不会把密钥写进记忆。
 *
 * 一个人在会话里贴过 `sk-proj-…` 排查问题，是再正常不过的事。而记忆是密钥最坏的去处：它每轮
 * 注入提示词、永远、没人读那个文件。`learn` 那条显式路径早就脱敏了，这条后台路径一直没有——
 * 验收清单（12 §10）点名的那一条。
 *
 * 两道防线各测一次。**输入侧**是要紧的那道：模型没见过的东西回显不出来，也编不进技能提案。
 * **输出侧**是兜底：防它凭形状重构，防输入侧的正则漏了某种新格式。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { extractMemory } from "../src/runtime/memory-extract.ts";
import { pendingSkills } from "../src/runtime/managed-skills.ts";
import { projectMemoryDir } from "../src/runtime/project-memory.ts";
import type { AssistantMessage, Message } from "../src/types.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-redact-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-redact-proj-"));
	process.env.LYRA_HOME = home;
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** 长得像真的，但不是真的：每一段都是能匹配到的形状。 */
const OPENAI = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ";
const GITHUB = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345";

const DEPS = {
	provider: { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as never,
	model: { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100_000, maxOutputTokens: 4096 } as never,
};

function session(id: string, lines: string[]): { id: string; updatedAt: number; messages: Message[] } {
	const messages: Message[] = lines.map((text, i) =>
		i % 2 === 0
			? { role: "user", content: [{ type: "text", text }], timestamp: 0 }
			: ({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: 0 } as AssistantMessage),
	);
	return { id, updatedAt: Date.now(), messages };
}

/**
 * 按次序回不同内容的模型替身，并记下每次收到的输入。
 *
 * 抽取现在发两次请求（记忆，然后技能提案），`memory-extract.test.ts` 里那个只回一段的
 * `scripted` 不够用。而「模型收到了什么」正是输入侧那道防线要断言的东西。
 */
function sequenced(replies: string[]) {
	const received: string[] = [];
	let call = 0;
	const stream = ((_p: unknown, _m: unknown, request: { messages: Message[] }) => {
		received.push(
			request.messages
				.flatMap((m) => m.content)
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n"),
		);
		const text = replies[Math.min(call, replies.length - 1)];
		call += 1;
		const message = {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-responses",
			provider: "p",
			model: "m",
			usage: {},
			stopReason: "stop",
			timestamp: 0,
		} as AssistantMessage;
		return (async function* () {
			yield { type: "text_delta" as const, index: 0, delta: text, partial: message };
			return message;
		})();
	}) as never;
	return { stream, received };
}

test("发给模型之前，密钥已经不在了", async () => {
	/*
	 * 这是两道里更要紧的一道。模型根本没见过的密钥，它回显不出来，也编不进技能提案里——
	 * 输出侧的检查因此成了兜底，而不是唯一的防线。
	 */
	const model = sequenced(["- 这个项目用 pnpm。", "（没有）"]);
	await extractMemory({
		cwd: project,
		candidates: [session("s1", [`帮我看看为什么报错，key 是 ${OPENAI}`, "看到了，这个错是……"])],
		stream: model.stream,
		...DEPS,
	});

	assert.ok(model.received.length >= 1, "至少发了一次请求");
	for (const input of model.received) {
		assert.ok(!input.includes(OPENAI), "模型收到的输入里不该有那串密钥");
	}
	assert.ok(model.received[0].includes("[已脱敏的凭证]"), "脱敏的痕迹要在——不然分不清是脱掉了还是根本没发");
});

test("模型把密钥回显进记忆，写盘前也拦下", async () => {
	/*
	 * 输入侧已经脱过，这条防的是另一种事：模型凭形状重构出一个像密钥的串，或者输入侧的正则
	 * 漏了某种新格式。记忆会每轮注入提示词，一次漏网就是永久泄漏。
	 */
	const model = sequenced([`- 这个项目的 GitHub token 是 ${GITHUB}，记住。\n- 用 pnpm。`, "（没有）"]);
	const result = await extractMemory({
		cwd: project,
		candidates: [session("s2", ["随便聊", "好"])],
		stream: model.stream,
		...DEPS,
	});

	const onDisk = await readFile(join(projectMemoryDir(project), "MEMORY.md"), "utf8");
	assert.ok(!onDisk.includes(GITHUB), "MEMORY.md 里不该有 token");
	assert.ok(onDisk.includes("[已脱敏的凭证]"), "换成了脱敏标记");
	assert.ok(onDisk.includes("用 pnpm"), "其余内容照旧");
	assert.ok(!result.memory.includes(GITHUB), "返回值也是脱过的——它会被拿去显示");
});

test("技能提案里的密钥也进不了待确认区", async () => {
	/*
	 * 技能正文会在被批准后整段注入。「先 export API_KEY=sk-…」是一段完全可能被当成「步骤」
	 * 写进提案里的话——而批准它的人看到的是一段命令，不是一个泄漏。
	 */
	const model = sequenced([
		"- 部署前先设环境变量。",
		`NAME: deploy-steps\nDESCRIPTION: 部署的固定步骤\nBODY:\n1. export OPENAI_API_KEY=${OPENAI}\n2. pnpm deploy`,
	]);
	await extractMemory({
		cwd: project,
		candidates: [session("s3", ["部署一下", "好"])],
		stream: model.stream,
		...DEPS,
	});

	const waiting = await pendingSkills(project);
	const proposal = waiting.find((c) => c.name === "deploy-steps");
	assert.ok(proposal, `提案该在待确认区：${JSON.stringify(waiting.map((c) => c.name))}`);
	assert.ok(!proposal.body.includes(OPENAI), "正文里不该有密钥");
	assert.ok(proposal.body.includes("[已脱敏的凭证]"), "换成了脱敏标记");
	assert.ok(proposal.body.includes("pnpm deploy"), "其余步骤照旧");
});
