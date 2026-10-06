/**
 * 把一条对话归到另一个项目下，并且它留在那儿。
 *
 * 这件事一度只在屏幕上发生过：菜单点下去，渲染层把 `cwd`、`projectId`、`projectName` 三个字段
 * 在内存里改掉、弹一句「已移动到 X」，磁盘上一个字节都没动——主进程那边根本没有「移动会话」这个
 * 操作可调。于是下一次推送把整条 meta 换回磁盘上那一份，对话自己飘回原来的项目。用户报上来的话
 * 是「无法移动到新项目」「过 1 秒就恢复原样了」，两句说的是同一件事。
 *
 * 所以这里每一条都要**跨一次重新读取**才算数：`listSessions()` 问的是同一个实例的缓存，而 bug 的
 * 形状恰恰是「内存里是对的」。新开一个 `SessionStore` 指向同一个目录，等于重启一次应用。
 *
 * The logs used to be filed by project, so a move was a file moving between directories, and these
 * tests checked the file. In the database a move is a record like any other (ADR-0032): what is left
 * to check is that it is written, survives a restart, and reads back under the new project.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectIdFor, SessionStore } from "../src/session/store.ts";

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "lyra-move-"));
	try {
		await run(new SessionStore(root), root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}


test("移动之后重新打开，它还在新项目里", async () => {
	await withStore(async (store, root) => {
		const from = "/tmp/project-a";
		const to = "/tmp/project-b";
		const meta = await store.create(from, "fake/model", "搬家的对话");
		await store.append(meta, { type: "message", message: { role: "user", content: [{ type: "text", text: "搬之前说的话" }], timestamp: Date.now() } });

		const moved = await store.move(meta.projectId, meta.id, to, "B 项目");
		assert.ok(moved, "移动应当返回新的 meta");
		assert.equal(moved.cwd, to);
		assert.equal(moved.projectId, projectIdFor(to));
		assert.equal(moved.projectName, "B 项目");

		/*
		 * 重启。
		 *
		 * 这一条就是那个 bug：内存里怎么改都对，磁盘上没写过，所以换一个实例来读，它就回到了原处。
		 */
		const restarted = new SessionStore(root);
		const listed = (await restarted.listSessions()).find((s) => s.id === meta.id);
		assert.ok(listed, "重启之后还应当找得到这条会话");
		assert.equal(listed.cwd, to, "重启之后 cwd 应当仍然是新项目");
		assert.equal(listed.projectId, projectIdFor(to));
		assert.equal(listed.projectName, "B 项目");
	});
});

test("移动之后按新项目读得出来", async () => {
	await withStore(async (store, root) => {
		const from = "/tmp/project-a";
		const to = "/tmp/project-b";
		const meta = await store.create(from, "fake/model");
		await store.move(meta.projectId, meta.id, to, "B 项目");
		store.close();
		const loaded = await new SessionStore(root).load(projectIdFor(to), meta.id);
		assert.ok(loaded, "用新的 projectId 应当读得出这条会话");
		assert.equal(loaded.meta.cwd, to);
		assert.equal(loaded.meta.projectId, projectIdFor(to));
	});
});

test("对话内容一条不少", async () => {
	await withStore(async (store, root) => {
		const to = "/tmp/project-b";
		const meta = await store.create("/tmp/project-a", "fake/model");
		let latest = meta;
		for (const text of ["第一句", "第二句", "第三句"]) {
			latest = await store.append(latest, { type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } });
		}

		await store.move(meta.projectId, meta.id, to, "B 项目");

		const loaded = await new SessionStore(root).load(projectIdFor(to), meta.id);
		assert.equal(loaded?.messages.length, 3, "三条消息都应当跟着过来");
		assert.deepEqual(
			loaded?.messages.map((m) => (m.content[0] as { text: string }).text),
			["第一句", "第二句", "第三句"],
		);
		assert.equal(loaded?.meta.messageCount, 3);
	});
});

test("整理不是活动：移动不把它顶到列表最前面", async () => {
	await withStore(async (store) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		const before = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;
		await new Promise((resolve) => setTimeout(resolve, 8));

		const moved = await store.move(created.projectId, created.id, "/tmp/project-b", "B 项目");
		const after = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;

		assert.equal(after, before, "updatedAt 不该被一次归类刷新——否则半年没动的对话会窜到最前面");
		assert.equal(moved?.updatedAt, before);
		assert.ok((moved?.seq ?? 0) > created.seq, "但 seq 要往前走：这确实是日志里新的一条");
	});
});

test("移进它已经在的那个项目：改名照样生效，什么都没变就不写", async () => {
	await withStore(async (store) => {
		const cwd = "/tmp/project-a";
		const meta = await store.create(cwd, "fake/model");

		// 项目被重命名过：目录没变，名字变了。
		const renamed = await store.move(meta.projectId, meta.id, cwd, "改过名的 A");
		assert.equal(renamed?.projectName, "改过名的 A");
		assert.equal(renamed?.projectId, meta.projectId);
		assert.ok((renamed?.seq ?? 0) > meta.seq, "改名这一条应当写进会话的记录里");

		// 两样都没变，就不该再留一条什么都没说的记录。
		const again = await store.move(meta.projectId, meta.id, cwd, "改过名的 A");
		assert.equal(again?.seq, renamed?.seq, "无事可做时不写记录");
	});
});

test("对着一条已经不在了的会话点移动，答 null 而不是抛异常", async () => {
	await withStore(async (store) => {
		// 一个还没刷新的侧边栏可以对着一条刚被别处删掉的对话点「移动到」。
		assert.equal(await store.move(projectIdFor("/tmp/nowhere"), "没有这个 id", "/tmp/project-b", "B 项目"), null);
	});
});
