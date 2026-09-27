/**
 * The offer to keep a correction as a rule belongs to the conversation that made it.
 *
 * It was one slot for the live conversation, drawn at the end of every transcript on screen. Measured
 * in a real window (`e2e/split-scope-rest-probe.ts rule`): the card stood under both screens of a
 * split, and when focus moved to the other screen the offer was dropped unanswered. An offer from
 * the conversation beside the focused one never showed at all.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { AgentEvent, Message, SessionMeta } from "@lyra/core";
import type { SessionSnapshot } from "../../electron/ipc-types.ts";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { RuleSuggestion } from "../../src/features/conversation/RuleSuggestion.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id}: 别用 var` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: "好" }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];

const OFFER: AgentEvent = { type: "rule_suggested", name: "no-var", body: "别用 var，统一用 const。", condition: "\\bvar\\s", scope: "text" };

let kept: Array<[string, string]>;
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	kept = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			rules: {
				preview: async () => "---\nname: no-var\n---\n别用 var，统一用 const。\n",
				keep: async (sessionId: string, scope: string) => {
					kept.push([sessionId, scope]);
					return { path: `/work/${sessionId}/.lyra/rules/no-var.md` };
				},
				decline: async () => {},
			},
			sessions: {
				transcript: async (_projectId: string, id: string): Promise<SessionSnapshot> => ({ meta: meta(id), messages: said(id), running: false, pendingApprovals: [] }),
				capabilities: async () => null,
			},
			subAgents: { list: async () => [] },
			workspace: { info: async () => null },
		},
	});
	useApp.setState({
		activeSessionId: null, pendingSessionId: null, meta: null, messages: [], toolRuns: {}, running: false, ruleOffers: {},
		workspace: null, scratchCwd: null, scratchRoots: ["/scratch"], settings: null,
		sessions: [meta("a"), meta("b")], sessionCache: {}, activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

/** Clicking a conversation: what a press on its screen does. */
const focus = (id: string) => act(async () => useApp.getState().openSession(meta(id)));
const event = (id: string, one: AgentEvent) => act(async () => useApp.getState().applyEvent(id, one));

function screens(): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: ["a", "b"].map((id) => h(SessionScope.Provider, { key: id, value: id }, h("section", { "data-screen": id }, h(RuleSuggestion)))) }));
}

const cards = (mounted: Mounted, id: string) => mounted.all(`[data-screen="${id}"] button[aria-label="保存到项目"]`).length;

test("the card stands under the conversation that was corrected, and stays there while focus moves", async () => {
	await focus("b");
	await focus("a");
	view = await screens();
	await event("a", OFFER);
	assert.equal(cards(view, "a"), 1);
	assert.equal(cards(view, "b"), 0, "the other screen drew the offer too, about an exchange it does not have");

	await focus("b");
	assert.equal(cards(view, "a"), 1, "focus moved to the other screen and the offer was dropped unanswered");
	assert.equal(cards(view, "b"), 0);

	// Saved from the screen without focus — the keyboard gets there without focusing it.
	await click(view.find('[data-screen="a"] button[aria-label="保存到项目"]'));
	await act(async () => {});
	assert.deepEqual(kept, [["a", "project"]], "saved under the conversation with focus");
	assert.equal(cards(view, "a"), 0, "answered, and still on screen");
});

test("a conversation beside the focused one shows its own offer, and its next turn takes it away", async () => {
	await focus("b");
	await focus("a");
	view = await screens();
	await event("b", OFFER);
	assert.equal(cards(view, "b"), 1, "an offer from the conversation without focus was dropped");
	assert.equal(cards(view, "a"), 0);

	await event("b", { type: "agent_start", sessionId: "b" });
	assert.equal(cards(view, "b"), 0, "an unanswered offer outlived the exchange it was about");
});
