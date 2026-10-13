/**
 * The main process's two parts in the session-level operations.
 *
 * One: `archive_session` archives only after its turn has ended. The ordinary archive path
 * (`sessions:setArchived`) runs `disposeSession` → `abort()` first, cutting off the very turn still
 * waiting for the tool to return, and its last result never lands. So the tool leaves a request,
 * the archive happens on `agent_end`, and the session is let go once it is idle.
 *
 * Two: which card a conversation was started from (`spawnedFrom`) has to pass the create-session
 * whitelist, reach the meta and survive a reopen — the card reads it to know whether it is "Start"
 * or "Started". That whitelist has dropped a new field before.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentSession, createSessionOpsTools, DEFAULT_SETTINGS, emptyUsage, SessionStore, type AgentEvent, type AssistantMessage, type Settings } from "@lyra/core";
import { createStoredSession } from "../electron/create-session.ts";
import { initialPrompt } from "../electron/prompt-input.ts";
import { archiveAfterTurn } from "../electron/session-ops.ts";
import { setActiveLocale } from "../src/i18n/translate.ts";
import { describeActivity } from "../src/lib/tool-kinds.ts";
import { summarizeToolCall } from "../src/lib/tool-summary.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 400 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(check(), `等不到：${what}`);
}

const end = (reason: Extract<AgentEvent, { type: "agent_end" }>["reason"]): AgentEvent => ({ type: "agent_end", reason });

/** A bookkeeping stand-in: records the order things happen in; the test decides when it is busy. */
function fakeHost() {
	const log: string[] = [];
	const state = { busy: false, archived: true };
	const archives = archiveAfterTurn({
		archive: async (id) => { log.push(`archive:${id}`); },
		busy: () => state.busy,
		archived: async () => state.archived,
		dispose: async (id) => { log.push(`dispose:${id}`); },
		pollMs: 1,
	});
	return { log, state, archives };
}

test("交了条子之后，这一轮里别的事件都不动；agent_end(done) 才归档", async () => {
	const { log, archives } = fakeHost();
	archives.request("a");
	for (const event of [{ type: "tool_end", toolCallId: "c", toolName: "archive_session", result: { content: [] }, isError: false }, { type: "turn_end" }] as AgentEvent[]) archives.observe("a", event);
	await settle();
	assert.deepEqual(log, [], "还没说完就归档，等于把这一轮最后那句话关在门外");
	archives.observe("a", end("done"));
	await until(() => log.length === 2, "归档并放掉");
	assert.deepEqual(log, ["archive:a", "dispose:a"]);
});

test("会话还在忙（收尾、排着的下一条）就先不放掉它；闲下来、而且还归档着，才放", async () => {
	const { log, state, archives } = fakeHost();
	state.busy = true;
	archives.request("a");
	archives.observe("a", end("done"));
	await until(() => log.length === 1, "先归档");
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.deepEqual(log, ["archive:a"], "忙着的时候一直没放——放就是 abort");
	state.busy = false;
	await until(() => log.length === 2, "闲下来之后放掉");
	assert.deepEqual(log, ["archive:a", "dispose:a"]);
});

test("等它闲下来的工夫里人又把它取消归档了：那就留着，不放", async () => {
	const { log, state, archives } = fakeHost();
	state.busy = true;
	archives.request("a");
	archives.observe("a", end("done"));
	await until(() => log.length === 1, "先归档");
	state.archived = false;
	state.busy = false;
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.deepEqual(log, ["archive:a"]);
});

test("这一轮被停下或出错就不归档，条子也作废：下一轮正常说完不会被顺手归掉", async () => {
	const { log, archives } = fakeHost();
	archives.request("a");
	archives.observe("a", end("aborted"));
	archives.request("b");
	archives.observe("b", end("error"));
	archives.observe("a", end("done"));
	archives.observe("b", end("done"));
	await settle();
	await settle();
	assert.deepEqual(log, []);
});

test("只认交条子的那个会话；没交条子的 agent_end 什么都不做", async () => {
	const { log, archives } = fakeHost();
	archives.request("a");
	archives.observe("other", end("done"));
	await settle();
	assert.deepEqual(log, []);
	archives.observe("a", end("done"));
	await until(() => log.length === 2, "a 归档");
	assert.deepEqual(log, ["archive:a", "dispose:a"]);
});

// Bounded: an archive that let the session go mid-turn leaves `prompt` waiting forever — that must fail, not hang the file.
test("真会话走一遍：模型说完、调 archive_session，这一轮以 done 收尾，之后才归档、闲下来才放掉", { timeout: 15_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-archive-turn-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = join(root, "home");
	try {
		const store = new SessionStore(join(root, "sessions"));
		const settings: Settings = {
			...DEFAULT_SETTINGS,
			providers: [{ id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [{ id: "fake/model", providerId: "fake", modelId: "model", name: "Fake", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true }] }],
			defaultModelId: "fake/model",
			autoSummarizeTitle: false,
		};
		const saved = await createStoredSession(store, settings, root, "fake/model");
		const timeline: string[] = [];
		let session!: AgentSession;
		const archives = archiveAfterTurn({
			archive: async (id) => {
				timeline.push(`archive:running=${session.running}`);
				await store.setArchived(saved.meta.projectId, id, true);
			},
			busy: () => session.running,
			archived: async () => (await store.get?.(saved.meta.id))?.archived === true,
			dispose: async () => {
				timeline.push(`dispose:running=${session.running}`);
				await session.dispose();
			},
			pollMs: 2,
		});
		let requests = 0;
		session = new AgentSession({
			cwd: root,
			settings,
			store,
			meta: saved.meta,
			extraTools: createSessionOpsTools({ archiveAfterTurn: (id) => archives.request(id) }),
			emit: (event) => {
				if (event.type === "agent_end") timeline.push(`agent_end:${event.reason}`);
				archives.observe(saved.meta.id, event);
			},
			streamFn: async () => {
				requests += 1;
				const reply: AssistantMessage = {
					role: "assistant", api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), timestamp: Date.now(), stopReason: "toolUse",
					content: [{ type: "text", text: "修好了，按你说的归档。" }, { type: "toolCall", id: "c-1", name: "archive_session", arguments: {} }],
				};
				return reply;
			},
		});
		await session.initialize();
		await session.prompt([{ type: "text", text: "修完就归档" }]);
		await until(() => timeline.some((step) => step.startsWith("dispose")), "放掉会话");

		assert.equal(requests, 1, "工具返回后没有再问模型");
		assert.equal(timeline[0], "agent_end:done", `先收尾：${timeline.join(" → ")}`);
		assert.ok(!timeline.includes("agent_end:aborted"), "这一轮没有被砍");
		assert.equal(timeline.at(-1), "dispose:running=false", `闲下来才放掉：${timeline.join(" → ")}`);
		const stored = await store.load(saved.meta.projectId, saved.meta.id);
		assert.equal(stored?.meta.archived, true, "进了归档");
		assert.equal(stored?.messages.at(-1)?.role, "toolResult", "那一轮的最后一条结果也落进去了");
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
		await rm(root, { recursive: true, force: true });
	}
});

test("spawnedFrom 穿过建会话的白名单（本机和手机都认），坏的形状当场拒绝", () => {
	const from = { sessionId: "s-origin", toolCallId: "toolu_01" };
	assert.deepEqual(initialPrompt({ content: "去做", spawnedFrom: from })?.spawnedFrom, from);
	assert.deepEqual(initialPrompt({ content: "去做", spawnedFrom: from }, "remote")?.spawnedFrom, from);
	assert.equal(initialPrompt({ content: "去做" })?.spawnedFrom, undefined, "不给就没有这一项");
	for (const invalid of [null, "s-origin", { sessionId: "s" }, { sessionId: "", toolCallId: "t" }, { sessionId: "s", toolCallId: 4 }, { sessionId: "s", toolCallId: "t".repeat(201) }]) {
		assert.throws(() => initialPrompt({ content: "去做", spawnedFrom: invalid }), `本该拒绝：${JSON.stringify(invalid)}`);
	}
});

test("spawnedFrom 写进新会话的 meta，换一个库实例重读还在", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-spawned-"));
	try {
		const from = { sessionId: "s-origin", toolCallId: "toolu_01" };
		const saved = await createStoredSession(new SessionStore(join(root, "sessions")), DEFAULT_SETTINGS, root, "", initialPrompt({ content: "去做", spawnedFrom: from }));
		assert.deepEqual(saved.meta.spawnedFrom, from, "交回去的快照里就有，卡片当场能翻成「已开始」");
		assert.equal(saved.meta.pendingPrompt, true, "开场那条照常等着跑");
		const reread = await new SessionStore(join(root, "sessions")).listSessions();
		assert.deepEqual(reread.find((meta) => meta.id === saved.meta.id)?.spawnedFrom, from);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("两个工具在转录里的说法：重开的会话和跑着的一样", () => {
	setActiveLocale("zh-CN");
	assert.equal(summarizeToolCall("spawn_session", { title: " 删掉没人用的函数 " }), "Suggest session 删掉没人用的函数");
	assert.equal(describeActivity(summarizeToolCall("spawn_session", { title: "删掉没人用的函数" })), "建议新会话 删掉没人用的函数");
	assert.equal(describeActivity(summarizeToolCall("archive_session", {})), "归档会话");
	setActiveLocale("en");
	try {
		assert.equal(describeActivity("Archive session"), "Archived the chat");
	} finally {
		setActiveLocale("zh-CN");
	}
});
