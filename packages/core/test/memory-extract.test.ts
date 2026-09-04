/**
 * Background extraction: which sessions it reads, what it writes, and what it refuses to touch.
 *
 * The three properties worth pinning are the ones that make it safe to run unattended — it never
 * overwrites what a person wrote, two windows cannot both run it, and a session that is probably
 * still in progress is left alone.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
	acquireLock,
	extractionPrompt,
	extractMemory,
	isCandidate,
	LOCK_STALE_MS,
	MAX_AGE_MS,
	MIN_AGE_MS,
	readExtractedMemory,
	renderSessions,
} from "../src/runtime/memory-extract.ts";
import { formatProjectMemory, projectMemoryDir, readLessons, recordLesson } from "../src/runtime/project-memory.ts";
import type { AssistantMessage, Message } from "../src/types.ts";

let home: string;
let project: string;

/**
 * A stream that emits the reply as one delta and then returns it.
 *
 * Yields rather than only returning, because a real provider does — a consumer that works against
 * a stub which never yields is a consumer that might be skipping the loop entirely.
 */
function scripted(text: string, stopReason: AssistantMessage["stopReason"] = "stop") {
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "p",
		model: "m",
		usage: {},
		stopReason,
		timestamp: Date.now(),
	} as AssistantMessage;
	return async function* () {
		yield { type: "text_delta" as const, index: 0, delta: text, partial: message };
		return message;
	} as never;
}

function session(id: string, lines: string[]): { id: string; updatedAt: number; messages: Message[] } {
	const messages: Message[] = lines.map((text, i) =>
		i % 2 === 0
			? { role: "user", content: [{ type: "text", text }], timestamp: 0 }
			: ({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: 0 } as AssistantMessage),
	);
	return { id, updatedAt: Date.now(), messages };
}

const DEPS = {
	provider: { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as never,
	model: { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: false } as never,
};

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-ext-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-ext-proj-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// Which sessions
// ---------------------------------------------------------------------------

test("a session that just ended is left alone", () => {
	/*
	 * Somebody who closed a window twenty minutes ago is likely still in the middle of the work —
	 * summarising it now reads its unfinished half as a conclusion.
	 */
	const now = Date.now();
	assert.equal(isCandidate({ updatedAt: now - 60_000, messageCount: 20 }, now), false);
});

test("a session old enough, and not too old, is read", () => {
	const now = Date.now();
	assert.equal(isCandidate({ updatedAt: now - MIN_AGE_MS - 1, messageCount: 20 }, now), true);
	assert.equal(isCandidate({ updatedAt: now - MAX_AGE_MS - 1, messageCount: 20 }, now), false, "past a month it is probably no longer true of the code");
});

test("a two-message session is a lookup, not work", () => {
	const now = Date.now();
	assert.equal(isCandidate({ updatedAt: now - MIN_AGE_MS - 1, messageCount: 2 }, now), false);
});

// ---------------------------------------------------------------------------
// What it sends
// ---------------------------------------------------------------------------

test("tool results are not sent", () => {
	/*
	 * They are the bulk of a transcript and the least of what it means: file contents and command
	 * output describe the code at one moment, which is exactly what must not become a memory.
	 */
	const withTool: Message[] = [
		{ role: "user", content: [{ type: "text", text: "找一下登录" }], timestamp: 0 },
		{ role: "toolResult", toolCallId: "c", toolName: "read", content: [{ type: "text", text: "整个文件的内容" }], isError: false, timestamp: 0 },
	];
	const rendered = renderSessions([{ id: "s", updatedAt: 0, messages: withTool }]);
	assert.match(rendered, /找一下登录/);
	assert.ok(!rendered.includes("整个文件的内容"));
});

test("the runtime's own messages are not sent as the user's", () => {
	const withSynthetic: Message[] = [
		{ role: "user", content: [{ type: "text", text: "真的问题" }], timestamp: 0 },
		{ role: "user", content: [{ type: "text", text: "规则注入的提醒" }], timestamp: 0, synthetic: true },
	];
	const rendered = renderSessions([{ id: "s", updatedAt: 0, messages: withSynthetic }]);
	assert.ok(!rendered.includes("规则注入的提醒"));
});

test("the prompt spends most of its length on what not to record", () => {
	const prompt = extractionPrompt();
	assert.match(prompt, /不要记/);
	assert.match(prompt, /会过期/);
	assert.match(prompt, /宁可少写/);
});

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

test("two passes cannot run at once", async () => {
	const dir = join(project, "lock-test");
	const first = await acquireLock(dir);
	assert.ok(first);
	assert.equal(await acquireLock(dir), null, "the second finds it held");
	await first();
	assert.ok(await acquireLock(dir), "and can take it once released");
});

test("a lock left behind by a closed window is taken over", async () => {
	/*
	 * The alternative is memory that stops updating until somebody finds a dotfile and deletes it.
	 */
	const dir = join(project, "stale-test");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, ".lock"), "999999", "utf8");
	const info = await stat(join(dir, ".lock"));
	assert.ok(await acquireLock(dir, info.mtimeMs + LOCK_STALE_MS + 1));
});

// ---------------------------------------------------------------------------
// What it writes
// ---------------------------------------------------------------------------

test("what it concluded lands in MEMORY.md", async () => {
	const result = await extractMemory({
		cwd: project,
		candidates: [session("s1", ["改完 core 要跑 pnpm arch", "记下了"])],
		stream: scripted("- 改完 packages/core 之后要跑 `pnpm arch` 检查依赖方向。"),
		...DEPS,
	});

	assert.equal(result.sessions, 1);
	assert.match(result.memory, /pnpm arch/);
	const written = await readFile(join(projectMemoryDir(project), "MEMORY.md"), "utf8");
	assert.match(written, /pnpm arch/);
});

test("it never touches what a person wrote", async () => {
	/*
	 * The whole reason the two files are separate. This pass rewrites its own output wholesale,
	 * which is only safe while the deliberate half lives somewhere it cannot reach.
	 */
	await recordLesson(project, { text: "这条是手写的，抽取不许动。" });
	await extractMemory({ cwd: project, candidates: [session("s2", ["a", "b"])], stream: scripted("- 别的结论"), ...DEPS });

	const lessons = await readLessons(project);
	assert.ok(lessons.some((l) => l.text.includes("手写的")), "learned.md survives");
});

test("«nothing worth recording» is an answer, not a lesson", async () => {
	/*
	 * A model told to find something will find something. Leaving it a way to say no is what keeps
	 * the file from filling with restatements of the obvious.
	 */
	const result = await extractMemory({ cwd: project, candidates: [session("s3", ["随便聊聊", "好"])], stream: scripted("（没有）"), ...DEPS });
	assert.equal(result.memory, "");
	assert.match(result.skipped ?? "", /没有值得记的/);
});

test("a provider that fails is a pass that did not happen, not an error", async () => {
	const result = await extractMemory({ cwd: project, candidates: [session("s4", ["a", "b"])], stream: scripted("x", "error"), ...DEPS });
	assert.equal(result.memory, "");
	assert.ok(result.skipped);
});

test("no candidates means no request", async () => {
	let called = false;
	await extractMemory({
		cwd: project,
		candidates: [],
		stream: (() => {
			called = true;
			return scripted("x");
		}) as never,
		...DEPS,
	});
	assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

test("the extracted half is marked as inferred, and ranks below what was written", async () => {
	/*
	 * Presenting both at the same confidence would let a guess from three weeks ago outrank
	 * something a person typed yesterday.
	 */
	const block = formatProjectMemory([{ text: "手写的一条", at: 1 }], "- 推断出来的一条");
	assert.match(block, /手写的一条/);
	assert.match(block, /推断出来的一条/);
	assert.match(block, /可信度低于上面几条/);
	assert.ok(block.indexOf("手写的一条") < block.indexOf("推断出来的一条"));
});

test("reading it back drops the header meant for a person", async () => {
	const back = await readExtractedMemory(project);
	assert.ok(!back.includes("# 从会话里总结的"));
	assert.ok(!back.includes("由后台抽取生成"));
});

test("a project with no extracted memory contributes nothing", async () => {
	const empty = await mkdtemp(join(tmpdir(), "ly-ext-empty-"));
	assert.equal(await readExtractedMemory(empty), "");
	assert.equal(formatProjectMemory([], ""), "");
	await rm(empty, { recursive: true, force: true });
});
