/**
 * The extra roots the window's path gate takes from conversations: each conversation's own worktree,
 * and nothing else — kept current as conversations are given one, filed back, moved away or deleted.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionStore, type SessionMeta } from "@lyra/core";
import { observeSessionStorage } from "../electron/session-storage.ts";
import { worktreeRoots } from "../electron/worktree-roots.ts";

const meta = (id: string, cwd: string, worktree?: SessionMeta["worktree"]): SessionMeta =>
	({ id, cwd, title: id, projectId: id, projectName: id, createdAt: 1, updatedAt: 1, modelId: "m", messageCount: 1, usage: {} as SessionMeta["usage"], seq: 1, ...(worktree ? { worktree } : {}) }) as SessionMeta;

test("启动时只收带 worktree 的会话的 cwd，普通会话跑在哪儿都不收", () => {
	const roots = worktreeRoots();
	roots.load([
		meta("tree", "/src/app-1a2b3c4d", { project: "/src/app", branch: "lyra/session-1a2b3c4d" }),
		meta("anywhere", "/etc"),
		meta("project", "/src/app"),
	]);
	assert.deepEqual(roots.roots(), ["/src/app-1a2b3c4d"]);
});

test("跟着会话的写入变：有了工作树就收，移走、删掉就不收", () => {
	const roots = worktreeRoots();
	roots.load([]);
	roots.observe({ id: "a", projectId: "a", meta: meta("a", "/home/.lyra/worktrees/app-aaaa0000", { project: "/src/app", branch: "lyra/session-aaaa0000" }) });
	roots.observe({ id: "b", projectId: "b", meta: meta("b", "/src/app-bbbb0000", { project: "/src/app", branch: "lyra/session-bbbb0000" }) });
	assert.deepEqual(roots.roots().sort(), ["/home/.lyra/worktrees/app-aaaa0000", "/src/app-bbbb0000"]);
	roots.observe({ id: "a", projectId: "a", meta: meta("a", "/elsewhere") });
	assert.deepEqual(roots.roots(), ["/src/app-bbbb0000"], "moved to another project: the field went, and its folder with it");
	roots.observe({ id: "b", projectId: "b", meta: null });
	assert.deepEqual(roots.roots(), [], "deleted");
});

test("列表读到之前就听到的写入更新：读到的旧列表不会把删掉的会话放回来", () => {
	const roots = worktreeRoots();
	const tree = meta("gone", "/src/app-cccc0000", { project: "/src/app", branch: "lyra/session-cccc0000" });
	roots.observe({ id: "gone", projectId: "gone", meta: null });
	roots.load([tree, meta("kept", "/src/app-dddd0000", { project: "/src/app", branch: "lyra/session-dddd0000" })]);
	assert.deepEqual(roots.roots(), ["/src/app-dddd0000"]);
});

test("接在真实存储上：建工作树、窗口发来的移动、删除，都改白名单；窗口的移动带不进 worktree", async () => {
	const home = await mkdtemp(join(tmpdir(), "lyra-wt-roots-"));
	const roots = worktreeRoots();
	const store = observeSessionStorage(new SessionStore(join(home, "sessions")), (change) => roots.observe(change));
	try {
		roots.load(await store.listSessions());
		const made = await store.create("/src/app", "model");
		// What `startStoredSession` writes once the worktree exists.
		await store.append(made, { type: "meta", meta: { ...made, cwd: "/home/.lyra/worktrees/app-eeee0000", worktree: { project: "/src/app", branch: "lyra/session-eeee0000" } } });
		assert.deepEqual(roots.roots(), ["/home/.lyra/worktrees/app-eeee0000"]);
		// `sessions:move` from the window, to a path of its choosing: the field is cleared, not taken from it.
		await store.move(made.projectId, made.id, "/etc", "etc");
		assert.deepEqual(roots.roots(), []);
		const filed = await store.create("/src/app-ffff0000", "model");
		await store.move(filed.projectId, filed.id, filed.cwd, "app", { project: "/src/app", branch: "lyra/session-ffff0000" });
		assert.deepEqual(roots.roots(), ["/src/app-ffff0000"]);
		await store.delete(filed.projectId, filed.id);
		assert.deepEqual(roots.roots(), []);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
