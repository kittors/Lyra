/**
 * The project menu under a screen is that screen's: it ticks that screen's project, and a project
 * chosen there is opened by that screen.
 *
 * The menu read the live slot's `workspace` and chose through `openWorkspace` and `clearWorkspace`,
 * which act on the live slot — the focused screen. A press on a screen focuses it first, so the
 * mouse was right. The keyboard reaches the composer's project chip in another screen without that
 * press: the menu ticked the focused conversation's project, and choosing a project from a blank
 * screen started the new conversation from the focused one — which, in a split, is 新对话 and
 * closes every other screen, the one the chip was on included.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, type ReactNode } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, provideScreenFocus, SessionScope } from "../../src/app/session-scope.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { ProjectPicker } from "../../src/features/modals/ProjectPicker.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

function meta(id: string, cwd: string, name: string): SessionMeta {
	return { id, title: id, cwd, projectId: cwd, projectName: name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
function parked(one: SessionMeta): Cache[string] {
	return { meta: one, messages: said(one.id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}
const A = meta("a", ALPHA.path, ALPHA.name);
const B = meta("b", BETA.path, BETA.name);
const settings = { projects: [{ id: ALPHA.path, path: ALPHA.path, name: ALPHA.name, pinned: true, lastOpenedAt: 2 }, { id: BETA.path, path: BETA.path, name: BETA.name, pinned: true, lastOpenedAt: 1 }], editor: {} } as unknown as AppState["settings"];

/** Each project `openWorkspace` was asked for, and which conversation held the live slot at that moment. */
let chosen: Array<{ path: string; live: string | null }>;
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	chosen = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) }, sessions: { contextBreakdown: async () => null, list: async () => [] } },
	});
	useApp.setState({
		pendingSessionId: null, toolRuns: {}, running: false, stopped: null, todos: [], hiccups: [],
		scratchCwd: null, scratchRoots: ["/scratch"], workspaceByPath: { [ALPHA.path]: ALPHA, [BETA.path]: BETA },
		activity: {}, turns: {}, queued: {}, drafts: {}, notices: [], settings,
		notify: () => {},
		openWorkspace: async (path: string) => {
			chosen.push({ path, live: useApp.getState().activeSessionId });
		},
	});
	/*
	 * What the split registers: a press on a screen puts its conversation in the live slot in the
	 * same tick — a blank screen by `stageDraft`, which takes back the project it was parked in.
	 */
	provideScreenFocus((id) => {
		const now = useApp.getState();
		if (id === null) useApp.setState({ activeSessionId: null, meta: null, messages: [], workspace: now.parkedDraft?.workspace ?? null, parkedDraft: null });
		else useApp.setState({ activeSessionId: id, meta: now.sessions.find((one) => one.id === id) ?? null, workspace: id === "a" ? ALPHA : BETA });
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	provideScreenFocus(null);
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function screen(id: string | null, body: ReactNode): ReactNode {
	return h(DockScope.Provider, { value: id ?? "@draft" }, h(SessionScope.Provider, { value: id }, body));
}

function inWindow(body: ReactNode): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: body }) }));
}

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
}

/** A row of the menu, which draws into a portal outside the mounted tree. */
function menuItem(label: string): HTMLElement {
	const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === label);
	assert.ok(item, `no menu row 「${label}」`);
	return item;
}

function button(label: string, host: Element): HTMLElement {
	const found = [...host.querySelectorAll<HTMLElement>("button")].find((element) => element.textContent?.trim() === label);
	assert.ok(found, `no button 「${label}」`);
	return found;
}

test("the project menu under a screen without focus ticks that screen's project", async () => {
	// 甲 holds the live slot in alpha; the menu hangs off 乙's chip, and 乙 works in beta.
	useApp.setState({ activeSessionId: "a", meta: A, messages: said("a"), workspace: ALPHA, parkedDraft: null, sessions: [A, B], sessionCache: { b: parked(B) } });
	const anchor = { x: 0, y: 0, width: 10, height: 10 } as unknown as Parameters<typeof ProjectPicker>[0]["anchor"];
	view = await inWindow(screen("b", h(ProjectPicker, { anchor, onClose() {} })));
	await settle();
	const ticked = [...document.querySelectorAll('[role="menuitem"][data-selected="true"]')].map((element) => element.getAttribute("data-ly-tip"));
	assert.deepEqual(ticked, [BETA.path], "ticked the focused conversation's project");
});

test("a project chosen from a blank screen without focus is opened by that blank screen, leaving the conversation beside it", async () => {
	// 乙 holds the live slot in beta; beside it, a blank screen parked in alpha.
	useApp.setState({ activeSessionId: "b", meta: B, messages: said("b"), workspace: BETA, parkedDraft: { workspace: ALPHA, scratchCwd: null }, sessions: [B], sessionCache: {} });
	view = await inWindow(screen(null, h(Composer)));
	await settle();
	// The chip names the blank screen's own project; pressing it the keyboard's way — no press on the screen first.
	await click(button(ALPHA.name, view.host));
	await settle();
	await click(menuItem(BETA.name));
	await settle();
	assert.deepEqual(chosen, [{ path: BETA.path, live: null }], "the project was opened by the conversation with focus, which in a split starts 新对话 and closes the other screens");
});
