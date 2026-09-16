import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createElement as h } from "react";
import type { GitStatus } from "../../electron/ipc-types.ts";
import { BranchesView } from "../../src/features/git/BranchesView.tsx";
import { ChangesView } from "../../src/features/git/ChangesView.tsx";
import { GroupHeader } from "../../src/features/git/GroupHeader.tsx";
import { syncPlan } from "../../src/features/git/syncPlan.ts";
import { click, mount } from "../helpers/mount.ts";

const cwd = "/fixture/project";
const status: GitStatus = {
	branch: "main", upstream: null, ahead: 0, behind: 0, remoteState: "none", remote: null,
	operation: null, unpushed: null, head: null,
	staged: [{ path: "staged.ts", status: "modified", staged: true, unstaged: false, added: 2, removed: 1 }],
	unstaged: [{ path: "unstaged.ts", status: "modified", staged: false, unstaged: true, added: 3, removed: 0 }],
};

function fixture(t: TestContext) {
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	const calls: { operation: string; cwd: string; paths: string[] }[] = [];
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		git: {
			diffRefs: async () => ({ files: [], added: 0, removed: 0 }),
			stage: async (cwd: string, paths: string[]) => { calls.push({ operation: "stage", cwd, paths }); return { ok: true }; },
			unstage: async (cwd: string, paths: string[]) => { calls.push({ operation: "unstage", cwd, paths }); return { ok: true }; },
			branches: async () => ({ current: "main", local: ["main"], remote: ["origin/feature"] }),
		},
		diff: { workspaceDiff: async () => ({ files: [], added: 0, removed: 0 }) },
	} });
	t.after(() => {
		if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra");
	});
	return calls;
}

function changes(busy = false, current = status) {
	return h(ChangesView, {
		cwd, status: current, busy, act: async operation => (await operation()).ok,
		plan: syncPlan(current),
	});
}

test("bulk Git icons retain their action labels and stage only the corresponding group", async t => {
	const calls = fixture(t);
	const view = await mount(changes());
	try {
		const stage = view.find('[aria-label="全部暂存"]');
		const unstage = view.find('[aria-label="全部取消暂存"]');
		assert.ok(stage.querySelector("svg"));
		assert.ok(unstage.querySelector("svg"));
		assert.equal(stage.textContent, "");
		assert.equal(unstage.textContent, "");
		await click(stage);
		await click(unstage);
		assert.deepEqual(calls, [
			{ operation: "stage", cwd, paths: ["unstaged.ts"] },
			{ operation: "unstage", cwd, paths: ["staged.ts"] },
		]);
	} finally { await view.unmount(); }
});

test("busy Git group actions stay disabled while the view toggle remains usable", async t => {
	const calls = fixture(t);
	const view = await mount(changes(true));
	try {
		for (const label of ["全部暂存", "全部取消暂存"]) {
			const button = view.find<HTMLButtonElement>(`[aria-label="${label}"]`);
			assert.equal(button.disabled, true);
			await click(button);
		}
		assert.deepEqual(calls, []);
		await click(view.find('[aria-label="切换为树状视图"]'));
		assert.equal(view.all('[aria-label="切换为扁平列表"]').length, 1);
		await click(view.find('[aria-label="切换为扁平列表"]'));
		assert.equal(view.all('[aria-label="切换为树状视图"]').length, 1);
	} finally { await view.unmount(); }
});

test("an unstaged-only group still offers one view toggle", async t => {
	fixture(t);
	const view = await mount(changes(false, { ...status, staged: [] }));
	try {
		assert.equal(view.all('[aria-label="切换为树状视图"]').length, 1);
		assert.equal(view.all('[aria-label="全部取消暂存"]').length, 0);
		assert.equal(view.all('[aria-label="全部暂存"]').length, 1);
	} finally { await view.unmount(); }
});

test("a group without actions has no empty button", async () => {
	const view = await mount(h(GroupHeader, { label: "远程", count: 12 }));
	try {
		assert.equal(view.text(), "远程12");
		assert.equal(view.all("button").length, 0);
	} finally { await view.unmount(); }
});

test("the local branch icon opens and cancels creation without blank actions in other groups", async t => {
	fixture(t);
	const page = (busy: boolean) => h(BranchesView, {
		cwd, status, busy, act: async operation => (await operation()).ok,
		repos: [
			{ path: cwd, label: "project", branch: "main", worktree: false },
			{ path: "/fixture/other", label: "other", branch: "main", worktree: false },
		], trees: {}, onSelectRepo: () => {},
	});
	const view = await mount(page(false));
	try {
		assert.ok(view.all("button").every(button => button.textContent?.trim() || button.getAttribute("aria-label")));
		const create = view.find('[aria-label="新建分支"]');
		assert.ok(create.querySelector("svg"));
		await click(create);
		assert.ok(view.find('input[placeholder="新分支名"]'));
		await click(view.find('[aria-label="取消新建分支"]'));
		assert.equal(view.host.querySelector('input[placeholder="新分支名"]'), null);
		await view.rerender(page(true));
		const disabled = view.find<HTMLButtonElement>('[aria-label="新建分支"]');
		assert.equal(disabled.disabled, true);
		await click(disabled);
		assert.equal(view.host.querySelector('input[placeholder="新分支名"]'), null);
	} finally { await view.unmount(); }
});

for (const [name, ahead, behind, upstream] of [
	["ahead", 1, 0, "origin/main"], ["behind", 0, 1, "origin/main"],
	["diverged", 1, 1, "origin/main"], ["unpublished", 0, 0, null],
] as const) {
	test(`clean ${name} changes view describes sync without a duplicate action`, async t => {
		fixture(t);
		const view = await mount(changes(false, { ...status, staged: [], unstaged: [], ahead, behind, upstream }));
		try {
			assert.ok(view.text().trim().length > 0);
			assert.equal(view.all("button").length, 0);
		} finally { await view.unmount(); }
	});
}
