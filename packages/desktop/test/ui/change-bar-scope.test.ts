/**
 * The change counter under a screen opens that screen's Git panel, and the panel shows that
 * screen's repository.
 *
 * Two faults of one kind, both measured in a real window (`e2e/split-scope-rest-probe.ts changebar`):
 *
 *   The counter asked for the Git panel without naming a screen, which means the focused one. A press
 *   focuses its screen first, so clicks landed; from the keyboard the panel opened beside the other
 *   conversation.
 *
 *   The panel read the live slot's project. Opened in the screen without focus it listed the focused
 *   conversation's repository, and swapped repositories every time focus moved.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { provideScope } from "../../src/features/dock/popout.ts";
import { has } from "../../src/features/dock/tree.ts";
import { ChangeBar } from "../../src/features/git/ChangeBar.tsx";
import { GitPanel } from "../../src/features/git/GitPanel.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

function meta(id: string, project: WorkspaceInfo): SessionMeta {
	return { id, title: id, cwd: project.path, projectId: project.path, projectName: project.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}

let scanned: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	scanned = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			git: {
				stat: async (cwd: string) => (cwd === BETA.path ? { added: 2, removed: 0, files: 2 } : { added: 1, removed: 0, files: 1 }),
				// No repository found: the panel stops at its empty state, which is all these tests need to see.
				repos: async (path: string) => {
					scanned.push(path);
					return [];
				},
				worktrees: async () => [],
			},
			workspace: { info: async (path: string) => [ALPHA, BETA].find((one) => one.path === path) ?? null },
		},
	});
	// 甲 holds the live slot in alpha; 乙, beside it, left the live slot earlier and is remembered in beta.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, running: false, workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"],
		sessions: [meta("a", ALPHA), meta("b", BETA)], sessionCache: {}, workspaceByPath: { [BETA.path]: BETA }, settings: null,
	});
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	// Both screens measured, focus on 甲's — what `SplitWorkspace` reports for this split.
	usePaneDock.getState().rememberSize("a", { width: 1200, height: 900 });
	usePaneDock.getState().rememberSize("b", { width: 1200, height: 900 });
	provideScope(() => "a");
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	provideScope(() => null);
	Reflect.deleteProperty(window, "lyra");
});

/** What sits inside one screen: its dock and its conversation, both named. */
function inScreen(id: string, body: typeof ChangeBar | typeof GitPanel): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, h(body))) }) }));
}

test("the counter under a screen without focus opens the Git panel in that screen", async () => {
	view = await inScreen("b", ChangeBar);
	const counter = view.all<HTMLButtonElement>("button").find((button) => button.getAttribute("data-ly-tip")?.includes("未提交"));
	assert.ok(counter, `no counter under the screen: ${view.host.innerHTML.slice(0, 300)}`);
	await click(counter);
	assert.ok(has(usePaneDock.getState().tree("b"), "review"), "the Git panel did not open in the screen whose counter was pressed");
	assert.ok(!has(usePaneDock.getState().tree("a"), "review"), "it opened beside the conversation that has focus");
});

test("the Git panel in a screen without focus reads that screen's repository, and keeps it as focus moves", async () => {
	view = await inScreen("b", GitPanel);
	await act(async () => {});
	assert.deepEqual(scanned, [BETA.path], "the panel scanned the focused conversation's project");

	await act(async () => useApp.setState({ activeSessionId: "b", workspace: BETA, workspaceByPath: { [ALPHA.path]: ALPHA, [BETA.path]: BETA } }));
	await act(async () => useApp.setState({ activeSessionId: "a", workspace: ALPHA }));
	assert.ok(!scanned.includes(ALPHA.path), `focus moved and the panel went to look at alpha: ${JSON.stringify(scanned)}`);
});
