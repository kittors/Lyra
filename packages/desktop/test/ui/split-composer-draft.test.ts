/**
 * Text left for the composer lands in the composer of the screen it was left for, and in no other.
 *
 * `composerDraft` is one slot for the whole window, and every mounted composer took whatever was in
 * it, in the same commit. A split mounts a composer per screen, so a suggestion card pressed on the
 * blank screen typed itself into the conversation beside it as well — and the caret followed it
 * there. Reproduced in a real window by mouse and by keyboard (`e2e/split-draft-probe.ts`).
 *
 * A draft now names its screen the way `send` does: a conversation's id, or null for the blank one.
 * The screen that takes it takes the live slot too, since a card reached by keyboard had no press on
 * the screen to do that first.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, type ReactNode } from "react";
import type { AssistantMessage, Message, SessionMeta } from "@lyra/core";
import type { SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { EmptyState } from "../../src/features/conversation/EmptyState.tsx";
import { focusPane } from "../../src/features/split/actions.ts";
import { useSplit } from "../../src/features/split/store.ts";
// For its module wiring: it tells a composer how to put its screen in the live slot.
import "../../src/features/split/SplitWorkspace.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { zhCN } from "../../src/i18n/messages/zh-CN.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

const B: SessionMeta = { id: "b", title: "b", cwd: BETA.path, projectId: BETA.path, projectName: BETA.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
const bMessages: Message[] = [
	{ role: "user", content: [{ type: "text", text: "b's question" }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: "b's answer" }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 } satisfies AssistantMessage,
];

let previous: AppState;
let view: Mounted | undefined;

beforeEach(async () => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: { info: async (path: string) => [ALPHA, BETA].find((one) => one.path === path) ?? null },
			sessions: {
				transcript: async (): Promise<SessionSnapshot> => ({ meta: B, messages: bMessages, running: false, pendingApprovals: [] }),
				capabilities: async () => null,
				contextBreakdown: async () => null,
			},
			subAgents: { list: async () => [] },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			git: { generalScratch: async () => "/scratch", stat: async () => ({ added: 0, removed: 0, files: 0 }) },
			delivery: { get: async () => null },
		},
	});
	// A blank conversation opened in alpha, then beta dragged in beside it — its screen the focused one.
	useApp.setState({
		activeSessionId: null, pendingSessionId: null, meta: null, messages: [], toolRuns: {}, running: false,
		workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], settings: null,
		sessions: [B], sessionCache: {}, activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
	});
	useSplit.setState({ windowId: "", focused: "b", tree: { type: "split", dir: "row", children: [{ type: "leaf", sessionId: null }, { type: "leaf", sessionId: "b" }], sizes: [0.5, 0.5] } });
	await useApp.getState().openSession(B);
	await act(async () => {});
	assert.equal(useApp.getState().activeSessionId, "b");
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
});

function screen(key: "blank" | "b", body: ReactNode): ReactNode {
	return h("div", { key, "data-screen": key }, h(SessionScope.Provider, { value: key === "blank" ? null : key }, body));
}

/** The split as its two screens draw their composers: the blank one under its suggestion cards, and beta's. */
function split(): ReactNode {
	return h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: [screen("blank", h(EmptyState)), screen("b", h(Composer))] }) });
}

function only(key: "blank" | "b"): ReactNode {
	return h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: screen(key, h(Composer)) }) });
}

const fieldOf = (key: "blank" | "b") => view!.find<HTMLTextAreaElement>(`[data-screen="${key}"] textarea`).value;

/** The first suggestion card, pressed the keyboard's way: a click with no pointer press on its screen first. */
async function pressCard(): Promise<void> {
	const card = view!.all<HTMLButtonElement>('[data-screen="blank"] button').find((button) => button.textContent?.includes(zhCN["empty.explore"]));
	assert.ok(card, "the blank screen draws its suggestion cards");
	await click(card);
	await act(async () => {});
}

test("a suggestion card on the blank screen fills that screen's composer and no other", async () => {
	view = await mount(split());
	await pressCard();
	assert.equal(fieldOf("b"), "", "the card typed itself into the conversation beside the blank screen");
	assert.equal(fieldOf("blank"), zhCN["empty.explorePrompt"]);
	assert.equal(useApp.getState().composerDraft, null, "taken once, by the screen it was left for");
});

test("the blank screen takes the live slot with the draft, as a press on it would have", async () => {
	view = await mount(split());
	await pressCard();
	assert.equal(useApp.getState().activeSessionId, null, "the caret went to the blank screen while beta kept the live slot");
	assert.equal(useSplit.getState().focused, null);
	assert.equal(useApp.getState().workspace?.path, ALPHA.path, "the blank screen came back in its own project");
	assert.equal(useSplit.getState().tree.type, "split", "taking the draft does not take the other screen away");
});

test("a draft left for one screen is not taken by another, and waits for its own", async () => {
	view = await mount(only("b"));
	await act(async () => useApp.getState().setComposerDraft("for the blank screen", { sessionId: null }));
	assert.equal(fieldOf("b"), "", "beta's composer took a draft left for the blank screen");
	assert.equal(useApp.getState().composerDraft?.text, "for the blank screen", "and cleared it from the slot");
	await view.unmount();
	view = await mount(only("blank"));
	await act(async () => {});
	assert.equal(fieldOf("blank"), "for the blank screen");
	assert.equal(useApp.getState().composerDraft, null);
});

test("a draft for a conversation off the live slot lands in its screen and puts it there", async () => {
	// The blank screen has focus now; beta is parked on its own screen. The Git panel and a sub-agent's
	// resume both leave drafts for the screen they sit in, which a keyboard can reach from here.
	focusPane(null);
	view = await mount(split());
	await act(async () => useApp.getState().setComposerDraft("for beta", { sessionId: "b" }));
	await act(async () => {});
	assert.equal(fieldOf("blank"), "", "the blank screen took beta's draft");
	assert.equal(fieldOf("b"), "for beta");
	assert.equal(useApp.getState().activeSessionId, "b");
	assert.equal(useSplit.getState().focused, "b");
	assert.deepEqual(useApp.getState().messages, bMessages, "beta came back with its own transcript");
});
