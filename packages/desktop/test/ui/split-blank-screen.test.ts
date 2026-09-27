/**
 * A split's blank screen speaks for itself.
 *
 * The website's screenshot script found it: open a new conversation, drag a finished one in beside
 * it, type into the fresh screen — and the message went to the conversation beside it, the one with
 * focus. Reproduced in a real window by mouse and by keyboard alike (`e2e/split-scope-probe.ts`).
 *
 * The blank screen had no way to be the live conversation. Focusing it moved the split's focus and
 * nothing else; its composer had no id to name, and leaving the id out of `send` meant "the live
 * one"; and every scoped read on it answered with the live slot — the other conversation's running
 * turn, its stop button, its model. These are the three halves, each pinned here.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { AssistantMessage, Message, SessionMeta, UserContent } from "@lyra/core";
import type { SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { SessionScope, useScopedMessages, useScopedMeta, useScopedRunning } from "../../src/app/session-scope.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { focusPane } from "../../src/features/split/actions.ts";
import { useSplit } from "../../src/features/split/store.ts";
// Imported for its module wiring too: it tells a composer how to put its screen in the live slot.
import { SplitWorkspace } from "../../src/features/split/SplitWorkspace.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { fire, mount, press, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

function meta(id: string, cwd: string): SessionMeta {
	return { id, title: id, cwd, projectId: cwd, projectName: cwd === ALPHA.path ? ALPHA.name : BETA.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}

const B = meta("b", BETA.path);
const bMessages: Message[] = [
	{ role: "user", content: [{ type: "text", text: "b's question" }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: "b's answer" }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 } satisfies AssistantMessage,
];

let created: string[];
let prompted: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(async () => {
	created = [];
	prompted = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: { info: async (path: string) => [ALPHA, BETA].find((one) => one.path === path) ?? null },
			sessions: {
				transcript: async (): Promise<SessionSnapshot> => ({ meta: B, messages: bMessages, running: false, pendingApprovals: [] }),
				capabilities: async () => null,
				contextBreakdown: async () => null,
				create: async (cwd: string, _model: string, first: { content: UserContent[] }): Promise<SessionSnapshot> => {
					created.push(cwd);
					return { meta: meta("fresh", cwd), messages: [{ role: "user", content: first.content, timestamp: 3 }], running: true, pendingApprovals: [] };
				},
			},
			agent: { prompt: async (id: string) => { prompted.push(id); return id === "b" ? B : meta(id, ALPHA.path); } },
			subAgents: { list: async () => [] },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			git: { generalScratch: async () => "/scratch", stat: async () => ({ added: 0, removed: 0, files: 0 }) },
			delivery: { get: async () => null },
		},
	});
	/*
	 * The reported sequence, through the real actions: a blank conversation opened in alpha, then the
	 * finished beta conversation taking the live slot beside it — its screen now the focused one.
	 */
	useApp.setState({
		activeSessionId: null, pendingSessionId: null, meta: null, messages: [], toolRuns: {}, running: false,
		workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], settings: null,
		sessions: [B], sessionCache: {}, activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
	});
	useSplit.setState({ windowId: "", focused: "b", tree: { type: "split", dir: "row", children: [{ type: "leaf", sessionId: null }, { type: "leaf", sessionId: "b" }], sizes: [0.5, 0.5] } });
	await useApp.getState().openSession(B);
	// The beta project arrives on its own errand after the transcript; let it land.
	await act(async () => {});
	assert.equal(useApp.getState().activeSessionId, "b");
	assert.equal(useApp.getState().workspace?.path, BETA.path, "the live slot is beta's now");
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
});

test("a message named for the blank conversation starts one in its project, whoever has focus", async () => {
	await useApp.getState().send([{ type: "text", text: "for the fresh screen" }], { sessionId: null });
	assert.deepEqual(prompted, ["fresh"], "the message went to the conversation that had focus");
	assert.deepEqual(created, [ALPHA.path], "the new conversation belongs to the project its screen was opened in");
	assert.equal(useApp.getState().messages.length, 2, "nothing was painted into beta's transcript");
});

test("focusing the blank screen puts the blank conversation in the live slot, with its own project", () => {
	focusPane(null);
	const state = useApp.getState();
	assert.equal(state.activeSessionId, null, "the split's focus moved and the live slot stayed on beta");
	assert.equal(state.workspace?.path, ALPHA.path, "the blank screen came back in beta's project");
	assert.deepEqual(state.messages, []);
	assert.equal(state.sessionCache.b?.messages, bMessages, "beta is parked for its own screen, not dropped");
	assert.equal(useSplit.getState().focused, null);
	assert.equal(useSplit.getState().tree.type, "split", "focusing a screen does not take the other one away");
});

/** A composer on the blank screen, and whatever `send` was handed with who held the live slot then. */
async function blankComposer(): Promise<{ sent: Array<{ sessionId: string | null | undefined; live: string | null }>; field: HTMLTextAreaElement }> {
	const sent: Array<{ sessionId: string | null | undefined; live: string | null }> = [];
	useApp.setState({
		send: async (_content: UserContent[], options?: { sessionId?: string | null }) => {
			sent.push({ sessionId: options?.sessionId, live: useApp.getState().activeSessionId });
			return true;
		},
	});
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(SessionScope.Provider, { value: null }, h(Composer)) }) }));
	return { sent, field: view.find<HTMLTextAreaElement>("textarea") };
}

test("Enter in the blank screen's composer sends for it, by keyboard, with no press to focus it first", async () => {
	const { sent, field } = await blankComposer();
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
	assert.ok(setter);
	setter.call(field, "typed into the fresh screen");
	await fire(field, new Event("input", { bubbles: true }));
	await press(field, "Enter");
	await act(async () => {});
	assert.deepEqual(sent, [{ sessionId: null, live: null }], "named the blank conversation, and put it in the live slot before sending");
});

test("the workspace keeps both screens when the blank one takes focus, and leaves it the live slot", async () => {
	// Found in the real window after the first fix: the blank screen took the live slot and its project,
	// the workspace's restore-after-reload step saw an empty live slot and reopened beta, and the new
	// conversation the message started never reached its screen.
	const reopened: string[] = [];
	useApp.setState({ openSessionById: async (id: string) => { reopened.push(id); return true; } });
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(SplitWorkspace) }) }));
	await act(async () => focusPane(null));
	await act(async () => {});
	assert.equal(useSplit.getState().tree.type, "split", "focusing the blank screen was taken for 新对话 and the split dissolved");
	assert.equal(useApp.getState().activeSessionId, null);
	assert.deepEqual(reopened, [], "the conversation beside it was opened again over the blank screen");
});

test("the blank screen does not wear the focused conversation's state", async () => {
	useApp.setState({ running: true });
	const seen: Array<{ running: boolean; messages: number; meta: string | null }> = [];
	function Probe() {
		seen.push({ running: useScopedRunning(), messages: useScopedMessages().length, meta: useScopedMeta()?.id ?? null });
		return null;
	}
	view = await mount(h(SessionScope.Provider, { value: null }, h(Probe)));
	assert.deepEqual(seen.at(-1), { running: false, messages: 0, meta: null }, "a blank screen read beta's live turn as its own");
	await view.unmount();
	// And the one control that makes it dangerous: beta running drew a stop button on the blank screen.
	const { field } = await blankComposer();
	assert.ok(field);
	assert.equal(view.find("[data-composer-send]").getAttribute("data-composer-send"), "send");
});
