/**
 * 跑在自己工作树里的会话：算在原项目名下，标着它在工作树里，从它开的新会话回到原项目。
 *
 * 从前它的项目名是工作树的文件夹名（`Lyra-3f9a1c2e`），在它里面点「新对话」会在工作树里再建一棵
 * 工作树（`Lyra-3f9a1c2e-9b0d77aa`），侧栏上它和别的会话看不出区别。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { SessionStatus } from "../../src/features/conversation/SessionStatus.tsx";
import { sessionWorkspace } from "../../src/store/session-workspace.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
let previous: AppState | undefined;

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	if (previous) useApp.setState(previous, true);
	previous = undefined;
});

const WORKTREE = "/home/.lyra/worktrees/repo-1234abcd";
const BRANCH = "lyra/session-1234abcd";

function info(answers: Record<string, string>, asked: string[] = []) {
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: {
				info: async (path: string) => {
					asked.push(path);
					return { path, name: path.split("/").pop(), isGitRepo: true, branch: answers[path] ?? null };
				},
			},
			git: { generalScratch: async () => null },
		},
	});
	return asked;
}

test("会话行：空闲时那一格画着它在工作树里，悬停说出分支；在跑的时候先说在跑", async () => {
	view = await mount(h("div", null, h(SessionStatus, { activity: null, worktree: BRANCH })));
	const mark = view.find("[data-ly-status-mark]");
	assert.equal(mark.getAttribute("data-ly-status-mark"), "worktree");
	assert.ok(view.find("[data-ly-tip]").getAttribute("data-ly-tip")?.includes(BRANCH));
	await view.rerender(h("div", null, h(SessionStatus, { activity: "running", worktree: BRANCH })));
	assert.equal(view.find("[data-ly-status-mark]").getAttribute("data-ly-status-mark"), "running");
	await view.rerender(h("div", null, h(SessionStatus, { activity: null })));
	assert.equal(view.find("[data-ly-status-mark]").getAttribute("data-ly-status-mark"), "idle", "an ordinary conversation keeps its ring");
});

test("打开工作树会话：路径、分支是工作树的，名字是项目的", async () => {
	info({ [WORKTREE]: BRANCH });
	const workspace = await sessionWorkspace({ cwd: WORKTREE, worktree: { project: "/code/repo", branch: BRANCH } });
	assert.deepEqual(workspace, { path: WORKTREE, name: "repo", isGitRepo: true, branch: BRANCH, worktreeOf: "/code/repo" });
	const plain = await sessionWorkspace({ cwd: "/code/repo" });
	assert.equal(plain?.worktreeOf, undefined);
	assert.equal(plain?.name, "repo");
});

test("在工作树会话里点新对话：回到原项目，分支重新读，不在工作树里再套一层", async () => {
	previous = useApp.getState();
	const asked = info({ "/code/repo": "main" });
	useApp.setState({
		activeSessionId: "in-worktree",
		meta: null,
		loadingSession: true,
		workspace: { path: WORKTREE, name: "repo", isGitRepo: true, branch: BRANCH, worktreeOf: "/code/repo" },
		scratchCwd: null,
	});
	await act(async () => {
		await useApp.getState().newSession();
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	const workspace = useApp.getState().workspace;
	assert.equal(workspace?.path, "/code/repo");
	assert.equal(workspace?.worktreeOf, undefined);
	assert.equal(workspace?.name, "repo");
	assert.equal(workspace?.branch, "main", "the project's own branch, read again");
	assert.deepEqual(asked, ["/code/repo"]);
});
