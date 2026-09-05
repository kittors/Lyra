/**
 * 「最后一次被注入」：记在旁边，不记在记忆里。
 *
 * 每一轮都注入，所以这个字段主要分开的是「到得了模型」和「上次会话之后才加的 / 被关掉了」。
 * 它必须写在旁车文件里：`memory.json` 是人手动加条目的地方，每轮改写整个文件会跟那一次
 * 添加撞车——丢一个时间戳无所谓，丢一条记忆不行。
 *
 * 最后一条是接线：`gatherMemory` 是轮次里读记忆的唯一入口，它回来的时候两个旁车文件都该有
 * 今天的时间戳；把 `markInjected` 那两行摘掉它必须变红。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gatherMemory } from "../src/runtime/memory-inject.ts";
import { annotateInjected, EXTRACTED_KEY, markInjected, projectInjectedPath, readInjected, userInjectedPath } from "../src/runtime/memory-injected.ts";
import { addMemoryEntry, loadMemory, memoryPath } from "../src/runtime/memory.ts";
import { projectMemoryDir, recordLesson } from "../src/runtime/project-memory.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-inject-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-inject-proj-"));
	process.env.LYRA_HOME = home;
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("marking writes the sidecar and leaves memory.json byte-for-byte alone", async () => {
	const entry = await addMemoryEntry("用 pnpm", "user");
	const before = await readFile(memoryPath(), "utf8");

	const wrote = await markInjected(userInjectedPath(), [entry.id], 1_000_000, 0);
	assert.equal(wrote, true);
	assert.equal(await readFile(memoryPath(), "utf8"), before, "the store is content; the timestamp lives beside it");

	const injected = await readInjected(userInjectedPath());
	assert.equal(injected[entry.id], 1_000_000);
	const [shown] = annotateInjected((await loadMemory()).entries, injected);
	assert.equal(shown.lastInjectedAt, 1_000_000, "and the page sees it on the entry");
});

test("a second mark inside the interval is skipped; outside it, the newer time wins and other keys keep theirs", async () => {
	const file = join(home, "throttle.json");
	assert.equal(await markInjected(file, ["a", "b"], 10_000, 60_000), true);
	assert.equal(await markInjected(file, ["a"], 20_000, 60_000), false, "a turn ten seconds later does not rewrite the file");
	assert.equal(await markInjected(file, ["a"], 80_000, 60_000), true);
	assert.deepEqual(await readInjected(file), { a: 80_000, b: 10_000 });
});

test("a corrupt or missing sidecar reads as empty rather than throwing", async () => {
	assert.deepEqual(await readInjected(join(home, "nope.json")), {});
	await writeFile(join(home, "bad.json"), "{not json", "utf8");
	assert.deepEqual(await readInjected(join(home, "bad.json")), {});
	await writeFile(join(home, "odd.json"), JSON.stringify({ a: "yesterday", b: 5 }), "utf8");
	assert.deepEqual(await readInjected(join(home, "odd.json")), { b: 5 }, "only numbers are times");
});

test("接线：一轮的 gatherMemory 把两边都盖上今天的戳", async () => {
	await addMemoryEntry("回答用中文", "user");
	await recordLesson(project, { text: "这个仓库的测试要用 node --test" });
	await mkdir(projectMemoryDir(project), { recursive: true });
	await writeFile(join(projectMemoryDir(project), "MEMORY.md"), "# 记忆\n\n- 抽取出来的一条。\n", "utf8");

	const now = 5_000_000;
	const gathered = await gatherMemory(project, true, now);
	assert.match(gathered.memorySnippet, /回答用中文/);
	assert.match(gathered.projectMemory, /node --test/);
	assert.match(gathered.projectMemory, /抽取出来的一条/);

	const user = await readInjected(userInjectedPath());
	const ids = (await loadMemory()).entries.map((e) => e.id);
	assert.ok(ids.length >= 2 && ids.every((id) => user[id] === now), `every user entry is stamped: ${JSON.stringify(user)}`);
	const proj = await readInjected(projectInjectedPath(project));
	assert.equal(proj["这个仓库的测试要用 node --test"], now, "the lesson, keyed by its text");
	assert.equal(proj[EXTRACTED_KEY], now, "and the extracted file as one item");

	const off = await gatherMemory(project, false, now + 1);
	assert.deepEqual(off, { memorySnippet: "", projectMemory: "" }, "switched off: nothing gathered");
	assert.equal((await readInjected(userInjectedPath()))[ids[0]], now, "and nothing stamped");
});
