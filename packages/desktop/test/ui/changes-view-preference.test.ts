/**
 * 平铺还是树：点出来的形状活得过一次重建。
 *
 * 这个视图被重建得比看上去频繁——它在 `GitPanel` 里挂着，key 是当前分支名，所以切一次分支就是
 * 一次重建；关掉面板再打开、换个项目的会话、重启应用，都算。从前形状是 `useState(false)`，每
 * 一次重建都回到平铺，人点了树也白点。
 *
 * 所以这里测的不是「点了会不会变」——那从来没坏过——而是**重新挂一次还在不在**。
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createElement as h } from "react";
import type { GitStatus } from "../../electron/ipc-types.ts";
import { ChangesView } from "../../src/features/git/ChangesView.tsx";
import { syncPlan } from "../../src/features/git/syncPlan.ts";
import { click, mount } from "../helpers/mount.ts";

const cwd = "/fixture/project";
const status: GitStatus = {
	branch: "main", upstream: null, ahead: 0, behind: 0, remoteState: "none", remote: null,
	operation: null, unpushed: null, head: null,
	staged: [{ path: "a/staged.ts", status: "modified", staged: true, unstaged: false, added: 2, removed: 1 }],
	unstaged: [{ path: "b/unstaged.ts", status: "modified", staged: false, unstaged: true, added: 3, removed: 0 }],
};

function fixture(t: TestContext) {
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		git: { diffRefs: async () => ({ files: [], added: 0, removed: 0 }), branches: async () => ({ current: "main", local: ["main"], remote: [] }) },
		diff: { workspaceDiff: async () => ({ files: [], added: 0, removed: 0 }) },
	} });
	localStorage.removeItem("lyra.git.changes.tree");
	t.after(() => {
		localStorage.removeItem("lyra.git.changes.tree");
		if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra");
	});
}

const changes = () => h(ChangesView, { cwd, status, busy: false, act: async (operation: () => Promise<{ ok: boolean }>) => (await operation()).ok, plan: syncPlan(status) });

/** 切换那一颗：它的标签在两种形状之间换，所以认标签而不是认图标。 */
function toggle(): HTMLButtonElement {
	const button = [...document.querySelectorAll("button")].find((b) => /切换为树状视图|切换为扁平列表/.test(b.getAttribute("aria-label") ?? ""));
	assert.ok(button, "找不到切换视图那一颗");
	return button as HTMLButtonElement;
}

test("点成树形之后，重新挂一次还是树形", async (t) => {
	fixture(t);
	const first = await mount(changes());
	try {
		await click(toggle());
		assert.equal(localStorage.getItem("lyra.git.changes.tree"), "1", "选择没有落到本地");
	} finally {
		await first.unmount();
	}

	/*
	 * 重新挂一次，就是切分支、关掉面板再打开、重启应用在这个组件身上的样子。
	 *
	 * 认标签：显示树形的时候，那一颗提供的是「切换为扁平列表」。
	 */
	const second = await mount(changes());
	try {
		assert.match(toggle().getAttribute("aria-label") ?? "", /切换为扁平列表/, "重新挂上来之后又回到了平铺");
	} finally {
		await second.unmount();
	}
});

test("再点回平铺，记住的也是平铺", async (t) => {
	fixture(t);
	localStorage.setItem("lyra.git.changes.tree", "1");
	const first = await mount(changes());
	try {
		assert.match(toggle().getAttribute("aria-label") ?? "", /切换为扁平列表/, "本地存着树形，挂上来却不是树形");
		await click(toggle());
		assert.equal(localStorage.getItem("lyra.git.changes.tree"), "0", "关掉树形没有被记下来");
	} finally {
		await first.unmount();
	}

	const second = await mount(changes());
	try {
		assert.match(toggle().getAttribute("aria-label") ?? "", /切换为树状视图/, "重新挂上来之后又变回了树形");
	} finally {
		await second.unmount();
	}
});

test("本地没存过的时候是平铺", async (t) => {
	fixture(t);
	const view = await mount(changes());
	try {
		assert.match(toggle().getAttribute("aria-label") ?? "", /切换为树状视图/, "默认该是平铺，那一颗提供的该是「换成树形」");
	} finally {
		await view.unmount();
	}
});
