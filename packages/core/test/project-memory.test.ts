/**
 * Project memory: what gets kept, what gets folded together, and what never reaches the file.
 *
 * The redaction and the deduplication are the two that matter. A lesson is written by a model that
 * has just been reading a config file, and it is injected into every prompt in this project from
 * then on — so a credential landing here is a credential in the prompt forever, in a file nobody
 * opens. And a lesson learned twice is worded differently both times; stored twice it spends the
 * cap and the context on the repetition.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
	formatProjectMemory,
	MAX_LESSONS,
	parseLessons,
	projectMemoryDir,
	readLessons,
	recordLesson,
	redactSecrets,
	similar,
	writeLessons,
} from "../src/runtime/project-memory.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-mem-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-mem-proj-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test("credentials never reach the file", () => {
	/*
	 * Memory is injected into every prompt in this project. A key that lands here is a key in the
	 * prompt forever, in a file nobody has a reason to open.
	 */
	const dirty = "接口的 key 是 sk-proj-abc123def456ghi789jkl012mno345pqr678，别忘了";
	const clean = redactSecrets(dirty);
	assert.ok(!clean.includes("sk-proj-abc123"), "the key is gone");
	assert.match(clean, /已脱敏/, "and something says why the text changed");
});

test("the hyphenated formats are covered, not only the old one", () => {
	for (const key of ["sk-proj-abcdefghij0123456789", "sk-ant-api03-abcdefghij0123456789", "ghp_abcdefghij0123456789xy", "AKIAIOSFODNN7EXAMPLE"]) {
		assert.ok(!redactSecrets(`用 ${key} 登录`).includes(key), `${key} must be redacted`);
	}
});

test("ordinary text is untouched", () => {
	const text = "这个仓库用 pnpm，不是 npm。构建前要先 pnpm build:contract。";
	assert.equal(redactSecrets(text), text);
});

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

test("the same lesson worded two ways is recognised as one", () => {
	assert.ok(similar("这个仓库用 pnpm 不是 npm", "这个仓库的包管理器是 pnpm 不是 npm"));
});

test("two different lessons are not merged", () => {
	assert.ok(!similar("这个仓库用 pnpm 不是 npm", "提交信息的 scope 必须是 core 或 desktop"));
});

test("an empty string matches nothing", () => {
	assert.ok(!similar("", "任何内容"));
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

test("a lesson is recorded and read back", async () => {
	const result = await recordLesson(project, { text: "这个仓库用 pnpm，不是 npm。" });
	assert.equal(result.action, "added");
	assert.equal(result.total, 1);

	const back = await readLessons(project);
	assert.equal(back[0].text, "这个仓库用 pnpm，不是 npm。");
});

test("a near-duplicate is merged rather than appended, and moves to the front", async () => {
	await recordLesson(project, { text: "提交信息的 scope 只能是 core、desktop、cli。" });
	const before = (await readLessons(project)).length;

	const result = await recordLesson(project, { text: "提交的 scope 只能用 core、desktop 或者 cli 这几个。" });

	assert.equal(result.action, "merged");
	assert.equal(result.total, before, "nothing was added");
	const back = await readLessons(project);
	assert.match(back[0].text, /或者 cli/, "the newer wording won — it usually came from an actual correction");
});

test("context is kept and rendered with the lesson", async () => {
	await recordLesson(project, { text: "e2e 要先 build:contract。", context: "跑 pnpm e2e 之前" });
	const back = await readLessons(project);
	const found = back.find((l) => l.text.includes("e2e"));
	assert.equal(found?.context, "跑 pnpm e2e 之前");
});

test("a secret in a lesson is redacted before it is stored, not just before it is shown", async () => {
	await recordLesson(project, { text: "部署要用 ghp_abcdefghij0123456789xy 这个令牌。" });
	const raw = await readFile(join(projectMemoryDir(project), "learned.md"), "utf8");
	assert.ok(!raw.includes("ghp_abcdefghij"), "the file on disk must not hold it either");
});

test("the store is capped, and the oldest go first", async () => {
	const many = Array.from({ length: MAX_LESSONS + 10 }, (_, i) => ({ text: `第 ${i} 条互不相同的教训 alpha${i}`, at: i }));
	await writeLessons(project, many);
	await recordLesson(project, { text: "刚学到的一条 omega" });

	const back = await readLessons(project);
	assert.equal(back.length, MAX_LESSONS, "the cap holds");
	assert.match(back[0].text, /omega/, "the newest is kept");
});

// ---------------------------------------------------------------------------
// The file is meant to be edited
// ---------------------------------------------------------------------------

test("a hand-edited file without timestamps still parses", async () => {
	/*
	 * Memory that cannot be corrected by hand is memory that stays wrong, so a person deleting a
	 * bullet — timestamp comment and all — must not break the file.
	 */
	const dir = projectMemoryDir(project);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "learned.md"), "# 手写的\n\n- 第一条\n- 第二条\n  - 适用于：某种情况\n", "utf8");

	const back = await readLessons(project);
	assert.deepEqual(
		back.map((l) => l.text),
		["第一条", "第二条"],
	);
	assert.equal(back[1].context, "某种情况");
});

test("the header prose is not read back as a lesson", () => {
	const parsed = parseLessons("# 这个项目学到的\n\n由 `learn` 工具写入，也可以手改。\n\n- 真正的一条\n");
	assert.deepEqual(
		parsed.map((l) => l.text),
		["真正的一条"],
	);
});

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

test("nothing learned means nothing in the prompt", () => {
	assert.equal(formatProjectMemory([]), "", "an empty block is noise plus a question about where the memory went");
});

test("the injected block tells the model what to do when memory and code disagree", () => {
	const block = formatProjectMemory([{ text: "用 pnpm", at: 1 }]);
	assert.match(block, /<project_memory>/);
	assert.match(block, /以代码为准/, "a stale entry has to lose to what is actually there");
	assert.match(block, /先看一眼再用/, "and what can be checked in the repository is checked before it is trusted");
});

test("each lesson carries how long ago it was written — age is what lets a model discount it", () => {
	const now = Date.parse("2026-09-05T00:00:00Z");
	const block = formatProjectMemory(
		[
			{ text: "用 pnpm", at: now - 90 * 86_400_000 },
			{ text: "跑 e2e 前先 build", context: "只在 CI", at: now - 3 * 86_400_000 },
			{ text: "今天学的", at: now },
		],
		"",
		now,
	);
	assert.match(block, /- 用 pnpm · 3 个月前记下/);
	assert.match(block, /- 跑 e2e 前先 build（只在 CI） · 3 天前记下/);
	assert.match(block, /- 今天学的 · 今天记下/);
	assert.match(block, /每条标了记下的时间/);
});
