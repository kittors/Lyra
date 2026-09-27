/**
 * Which panels a screen offers is decided by that screen's conversation.
 *
 * Measured in a real window (`e2e/split-scope-more-probe.ts defs`): 甲 in a project beside 丙, a
 * conversation in no project. With focus on 丙, 甲's title bar lost its Git button; with focus on 甲,
 * 丙's title bar grew one. Availability was read from the live slot's project and conversation,
 * which describe the focused screen only.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { PanelMenu } from "../../src/app/window/WindowToolbar.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const CHAT = "/lyra/workspaces/chat-c";

function meta(id: string, cwd: string): SessionMeta {
	return { id, title: id, cwd, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}

let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: { workspace: { info: async (path: string) => (path === ALPHA.path ? ALPHA : null) } } });
	useApp.setState({
		sessions: [meta("a", ALPHA.path), meta("c", CHAT)], sessionCache: {}, workspaceByPath: { [ALPHA.path]: ALPHA },
		scratchRoots: ["/lyra/workspaces"], settings: null, parkedDraft: null,
	});
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	window.localStorage.clear();
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

/** The live slot on 甲, in its project. */
const focusOnA = () => useApp.setState({ activeSessionId: "a", meta: meta("a", ALPHA.path), workspace: ALPHA, scratchCwd: null });
/** The live slot on 丙, in no project. */
const focusOnC = () => useApp.setState({ activeSessionId: "c", meta: meta("c", CHAT), workspace: null, scratchCwd: CHAT });

function titleBarOf(id: string | null): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(SessionScope.Provider, { value: id }, h(PanelMenu, { scope: id ?? "@draft" })) }) }));
}

/** The quick buttons in the title bar, by label. */
const quick = (on: Mounted) => on.all("[data-ly-panel-quick] button").map((button) => button.getAttribute("aria-label") ?? "");
const hasGit = (labels: string[]) => labels.some((label) => label.startsWith("Git"));

test("a project's screen keeps its Git button while a conversation in no project has focus", async () => {
	focusOnC();
	view = await titleBarOf("a");
	assert.ok(hasGit(quick(view)), `the project's screen lost its Git button: ${JSON.stringify(quick(view))}`);
});

test("a screen in no project offers no Git while a project's conversation has focus", async () => {
	focusOnA();
	view = await titleBarOf("c");
	assert.ok(!hasGit(quick(view)), `the project-less screen offered Git: ${JSON.stringify(quick(view))}`);
});

test("the blank screen offers none of a conversation's panels while a conversation has focus", async () => {
	focusOnA();
	view = await titleBarOf(null);
	await click(view.find("button[data-ly-toolbar-button][aria-label='面板']"));
	const listed = [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent?.trim() ?? "");
	for (const panel of ["轨迹", "子 Agent"]) {
		assert.ok(!listed.some((row) => row.startsWith(panel)), `the blank screen offered 「${panel}」: ${JSON.stringify(listed)}`);
	}
});
