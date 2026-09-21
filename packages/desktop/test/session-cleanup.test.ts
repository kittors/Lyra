/**
 * 按时间成片地删会话。
 *
 * 这是这个应用里最不能错的一个动作：没有回收站，删掉的是聊天记录本身，而「少删了一条」和「多删
 * 了一条」的代价差着一个量级。所以这里问的全是边界——两头含不含当天、正在跑的那条有没有留下、
 * 释放量是不是删之前量的——用真的文件问，不是用替身。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SessionMeta, SessionStorage } from "@lyra/core";
import { clearSessions, storageUse, withinRange } from "../electron/session-cleanup.ts";

let home = "";
let index: SessionMeta[] = [];

const PROJECT = "proj-a";

function meta(id: string, updatedAt: number): SessionMeta {
	return {
		id,
		title: id,
		cwd: "/tmp/x",
		projectId: PROJECT,
		projectName: "x",
		createdAt: updatedAt,
		updatedAt,
		modelId: "relay/m",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 1,
	};
}

/** 只实现这两个函数真正会碰的那几个方法；别的被调到就是这些测试问错了问题。 */
function fakeStore(): SessionStorage {
	return {
		listSessions: async () => index,
		deleteMany: async (targets: { projectId: string; id: string }[]) => {
			const gone = new Set(targets.map((target) => target.id));
			for (const target of targets) await rm(join(home, "sessions", target.projectId, `${target.id}.jsonl`), { force: true });
			index = index.filter((each) => !gone.has(each.id));
		},
	} as unknown as SessionStorage;
}

/** 一条会话：索引里一行，磁盘上一个有大小的文件。 */
async function seed(id: string, updatedAt: number, bytes = 1024): Promise<void> {
	index.push(meta(id, updatedAt));
	await writeFile(join(home, "sessions", PROJECT, `${id}.jsonl`), "x".repeat(bytes));
}

const at = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0).getTime();

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-cleanup-"));
	await mkdir(join(home, "sessions", PROJECT), { recursive: true });
	index = [];
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

describe("withinRange", () => {
	it("两头都含当天", () => {
		const range = { from: "2026-09-01", to: "2026-09-10" };
		assert.equal(withinRange({ updatedAt: at(9, 1) }, range), true);
		assert.equal(withinRange({ updatedAt: at(9, 10) }, range), true);
		assert.equal(withinRange({ updatedAt: at(8, 31) }, range), false);
		assert.equal(withinRange({ updatedAt: at(9, 11) }, range), false);
	});

	it("两头都空就是全部——这是「一键清空」，不是一段退化的区间", () => {
		assert.equal(withinRange({ updatedAt: at(1, 1) }, { from: null, to: null }), true);
	});

	it("当天深夜的会话属于那一天，不是第二天", () => {
		// 本地日期，和用量页同一个口径。按 UTC 算的话这条会跑到 9-11 去，于是「删到 9-10」会漏掉它。
		const late = new Date(2026, 8, 10, 23, 30).getTime();
		assert.equal(withinRange({ updatedAt: late }, { from: null, to: "2026-09-10" }), true);
	});
});

describe("storageUse", () => {
	it("空的 home 是零，不是崩", async () => {
		const use = await storageUse(fakeStore(), home);
		assert.deepEqual(use, { bytes: 0, sessions: 0, earliest: null, latest: null, days: [] });
	});

	it("量的是磁盘上的字节，条数和头尾日期来自索引", async () => {
		await seed("s1", at(8, 11), 2048);
		await seed("s2", at(9, 21), 1024);
		const use = await storageUse(fakeStore(), home);
		assert.equal(use.bytes, 3072);
		assert.equal(use.sessions, 2);
		assert.equal(use.earliest, "2026-08-11");
		assert.equal(use.latest, "2026-09-21");
	});

	it("索引里没有的孤儿日志照样占着盘，所以照样要数出来", async () => {
		await seed("s1", at(9, 1), 1024);
		await writeFile(join(home, "sessions", PROJECT, "orphan.jsonl"), "x".repeat(512));
		const use = await storageUse(fakeStore(), home);
		assert.equal(use.bytes, 1536, "走目录而不是走索引");
		assert.equal(use.sessions, 1, "但它不是一条会话");
	});

	it("不是日志的文件不算", async () => {
		await seed("s1", at(9, 1), 1024);
		await writeFile(join(home, "sessions", PROJECT, "notes.txt"), "x".repeat(4096));
		assert.equal((await storageUse(fakeStore(), home)).bytes, 1024);
	});

	it("按天摊开，好让界面算得出「选了这一段会删掉什么」", async () => {
		// 少了这张表，确认框只能拿总数去问「删除全部 303 条？」——而实际落在范围里的可能只有一条。
		await seed("a", at(9, 5), 1024);
		await seed("b", at(9, 5), 2048);
		await seed("c", at(9, 21), 512);
		const use = await storageUse(fakeStore(), home);
		assert.deepEqual(use.days, [
			{ day: "2026-09-05", sessions: 2, bytes: 3072 },
			{ day: "2026-09-21", sessions: 1, bytes: 512 },
		]);
	});

	it("孤儿日志算进总量，但不属于任何一天", async () => {
		// 它占着盘（所以总数要数它），可它不在索引里，删除动作够不着它（所以按天那张表没有它）。
		await seed("a", at(9, 5), 1024);
		await writeFile(join(home, "sessions", PROJECT, "orphan.jsonl"), "x".repeat(4096));
		const use = await storageUse(fakeStore(), home);
		assert.equal(use.bytes, 5120);
		assert.deepEqual(use.days, [{ day: "2026-09-05", sessions: 1, bytes: 1024 }]);
	});
});

describe("clearSessions", () => {
	const never = () => false;

	it("只删落在这一段里的，别的一条不动", async () => {
		await seed("old", at(8, 1));
		await seed("mid", at(9, 5));
		await seed("new", at(9, 21));

		const result = await clearSessions(fakeStore(), { from: "2026-09-01", to: "2026-09-10" }, never, home);
		assert.deepEqual(result, { removed: 1, freed: 1024, skipped: 0 });
		assert.deepEqual(index.map((each) => each.id).sort(), ["new", "old"]);
		await assert.rejects(stat(join(home, "sessions", PROJECT, "mid.jsonl")), "文件也要真的没了");
	});

	it("两头都空就是全删", async () => {
		await seed("a", at(8, 1));
		await seed("b", at(9, 21));
		const result = await clearSessions(fakeStore(), { from: null, to: null }, never, home);
		assert.equal(result.removed, 2);
		assert.equal(index.length, 0);
	});

	it("正在跑的那条留下，并且要报出来", async () => {
		// 删一条正在执行工具调用的会话，省下的那几 KB 远不如它正在写的东西值钱——而且它下一次
		// 落盘又会把文件建回来，于是「删干净了」是假的。
		await seed("running", at(9, 5));
		await seed("idle", at(9, 6));

		const result = await clearSessions(fakeStore(), { from: null, to: null }, (id) => id === "running", home);
		assert.deepEqual(result, { removed: 1, freed: 1024, skipped: 1 });
		assert.deepEqual(index.map((each) => each.id), ["running"]);
	});

	it("一条都没匹配上时，删除动作根本不发生", async () => {
		await seed("a", at(9, 21));
		const result = await clearSessions(fakeStore(), { from: "2020-01-01", to: "2020-12-31" }, never, home);
		assert.deepEqual(result, { removed: 0, freed: 0, skipped: 0 });
		assert.equal(index.length, 1);
	});

	it("释放量是删之前量的，不是删之后", async () => {
		// 删完再 stat 得到的是一片零，界面上就会说「释放 0 KB」——看起来像什么都没发生。
		await seed("a", at(9, 1), 4096);
		await seed("b", at(9, 2), 2048);
		const result = await clearSessions(fakeStore(), { from: null, to: null }, never, home);
		assert.equal(result.freed, 6144);
	});

	it("会话写在项目外的东西跟着一起走", async () => {
		await seed("a", at(9, 1));
		await mkdir(join(home, "previews", "a"), { recursive: true });
		await writeFile(join(home, "previews", "a", "index.html"), "<!doctype html>");

		await clearSessions(fakeStore(), { from: null, to: null }, never, home);
		await assert.rejects(stat(join(home, "previews", "a")), "预览目录是这条会话写的，它应该跟着没");
	});
});
