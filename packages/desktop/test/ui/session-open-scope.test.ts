/**
 * A conversation opened from inside a screen opens in that screen.
 *
 * Two controls open another conversation from inside one: the capsule of a conversation a message
 * referenced with @, and the trajectory panel's fork. Both called `openSession`, which puts the
 * conversation in the live slot, and the split then shows it in place of the screen with focus. A
 * press focuses its screen first, so the mouse replaced the screen it pressed in; the keyboard
 * reaches a control in another screen without that press, and replaced the focused one instead.
 *
 * The rule, decided 2026-09-27: it opens where it was pressed, as it always did with the mouse. The
 * split takes it from there — in place of that screen, or by moving the focus to the screen that
 * already shows it.
 *
 * Every test stages the same split: 甲 (`a`) holds the live slot and the focus; 乙 (`b`) is beside
 * it, parked. The control is pressed inside 乙 without focusing it, which is what the keyboard does.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { Message, SessionMeta, UserMessage as UserMessageType } from "@lyra/core";
import { DockScope, provideScreenFocus, SessionScope } from "../../src/app/session-scope.tsx";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { TrajectoryPanel } from "../../src/features/conversation/trajectory/TrajectoryPanel.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
function parked(id: string): Cache[string] {
	return { meta: meta(id), messages: said(id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

/** Each conversation `openSession` was asked for, and which one held the live slot — the screen it replaces. */
let opened: Array<{ id: string; replacing: string | null }>;
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	opened = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: said("a"), toolRuns: {}, running: false,
		sessions: [meta("a"), meta("b"), meta("c")], sessionCache: { b: parked("b") }, notices: [],
		notify: () => {},
		openSession: async (target: SessionMeta) => {
			opened.push({ id: target.id, replacing: useApp.getState().activeSessionId });
		},
	});
	/*
	 * What the split registers: a press on a screen puts its conversation in the live slot, in the
	 * same tick — `openSession`'s own state change runs before its first await.
	 */
	provideScreenFocus((id) => {
		const now = useApp.getState();
		useApp.setState({ activeSessionId: id, pendingSessionId: null, selectionEpoch: now.selectionEpoch + 1, meta: id ? meta(id) : null });
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	provideScreenFocus(null);
	// The whole state back, stand-in actions included, so nothing leaks into the next test.
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function inScreen(id: string, body: ReturnType<typeof h>): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, body)) }));
}

/** Two frames and a turn: the capsule lights the sidebar row first and swaps the screen after a paint. */
async function settle(): Promise<void> {
	for (let round = 0; round < 10 && opened.length === 0; round++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
}

test("a conversation capsule pressed on the screen without focus opens that conversation in place of that screen", async () => {
	const message: UserMessageType = {
		role: "user",
		content: [{ type: "text", text: "接着那次的讨论" }],
		displayText: "接着那次的讨论",
		sessionRefs: [{ id: "c", title: "丙" }],
		timestamp: 1,
	};
	view = await inScreen("b", h(UserMessage, { message, index: 0 }));
	await click(view.find('button[data-ly-tip="点击切换至该会话"]'));
	await settle();
	assert.deepEqual(opened, [{ id: "c", replacing: "b" }], "the capsule replaced the screen with focus");
});

test("a conversation capsule on the screen with focus opens there, as it always did", async () => {
	const message: UserMessageType = { role: "user", content: [{ type: "text", text: "接着" }], displayText: "接着", sessionRefs: [{ id: "c", title: "丙" }], timestamp: 1 };
	view = await inScreen("a", h(UserMessage, { message, index: 0 }));
	await click(view.find('button[data-ly-tip="点击切换至该会话"]'));
	await settle();
	assert.deepEqual(opened, [{ id: "c", replacing: "a" }]);
});

/** A turn for what a press started to come back, and for React to draw it. */
async function tick(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

/** A row of a menu, which draws into a portal outside the mounted tree. */
function menuItem(label: string): HTMLElement {
	const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim() === label);
	assert.ok(item, `no menu row 「${label}」`);
	return item;
}

test("a conversation forked from the trajectory panel of the screen without focus opens in place of that screen", async () => {
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			sessions: {
				trajectoryChanges: async () => ({ cursor: "b:1", reset: true, upserts: [{ id: "one", seq: 1, ts: 1, source: "request", summary: "请求" }], removals: [] }),
				fork: async () => ({ meta: meta("f") }),
			},
			agent: { onEvent: () => () => {} },
		},
	});
	view = await inScreen("b", h(TrajectoryPanel));
	await tick();
	await click(view.find("button[data-trace-entry]"));
	await click(view.find('[data-trace-inspector-header] button[aria-label="记录操作"]'));
	await click(menuItem("从这里分叉"));
	await settle();
	assert.deepEqual(opened, [{ id: "f", replacing: "b" }], "the fork replaced the screen with focus");
});
