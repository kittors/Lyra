/**
 * The model and effort pickers under a screen read, and change, that screen's conversation.
 *
 * Measured in a real window (`e2e/split-scope-more-probe.ts model`): with focus on 甲 (QA 2, effort
 * 高), the effort button under 乙 read 「高」 — 甲's. 乙's model menu, opened by keyboard, ticked
 * QA 2; choosing QA 3 there rewrote 甲's model on disk, and moving 乙's effort slider moved 甲's
 * effort. The pickers read the live slot's `meta`, and `setModel` and `setThinking` acted on the live
 * slot: right after a press, which focuses its screen first, and wrong from the keyboard.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type Message, type SessionMeta, type Settings, type ThinkingLevel } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { EffortMenu } from "../../src/features/models/EffortMenu.tsx";
import { EffortTrigger } from "../../src/features/models/EffortTrigger.tsx";
import { ModelMenu } from "../../src/features/models/ModelMenu.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { fire, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const models = [
	{ id: "qa/model", name: "QA" },
	{ id: "qa/model-2", name: "QA 2" },
	{ id: "qa/model-3", name: "QA 3" },
].map((one) => ({ ...one, modelId: one.id.split("/")[1], providerId: "qa", contextWindow: 128_000, maxOutputTokens: 4096, supportsThinking: true, supportsImages: false, supportsTools: true }));
const settings: Settings = {
	...DEFAULT_SETTINGS,
	providers: [{ id: "qa", name: "探针模型", api: "anthropic-messages", apiKey: "test", baseUrl: "http://localhost", enabled: true, models }],
	defaultModelId: "qa/model",
	thinking: "off",
};

function meta(id: string, modelId: string, thinking?: ThinkingLevel): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId, messageCount: 2, seq: 3, usage, ...(thinking ? { thinking } : {}) };
}
// 甲 thinks hard on QA 2; 乙 has thinking off, on QA.
const A = meta("a", "qa/model-2", "high");
const B = meta("b", "qa/model");
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: 2 },
];
function parked(one: SessionMeta): Cache[string] {
	return { meta: one, messages: said(one.id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let chosen: Array<[string, string]>;
let efforts: Array<[string, string]>;
let opened: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	chosen = [];
	efforts = [];
	opened = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			agent: {
				setModel: async (sessionId: string, modelId: string) => {
					chosen.push([sessionId, modelId]);
				},
				setThinking: async (sessionId: string, level: string) => {
					efforts.push([sessionId, level]);
				},
			},
		},
	});
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: A, messages: said("a"), toolRuns: {}, running: false, stopped: null, todos: [], hiccups: [],
		sessions: [A, B], sessionCache: { b: parked(B) }, activity: {}, turns: {}, carried: {}, notices: [], settings,
		saveSettings: async (next: Settings) => {
			useApp.setState({ settings: next });
		},
		// What `openSession` does to the live slot — park the one leaving, take the one arriving — without the disk read.
		openSession: async (target: SessionMeta) => {
			opened.push(target.id);
			const now = useApp.getState();
			const cache = { ...now.sessionCache };
			if (now.activeSessionId && now.activeSessionId !== target.id && now.meta) cache[now.activeSessionId] = { ...parked(now.meta), messages: now.messages };
			const away = cache[target.id];
			useApp.setState({ sessionCache: cache, activeSessionId: target.id, meta: away?.meta ?? target, messages: away?.messages ?? [] });
		},
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	// The whole state back, stand-in actions included, so nothing leaks into the next test.
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function onScreen(id: string, body: ReturnType<typeof h>): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, body) }));
}

/** A real press: the capture-phase mousedown first, then the click. */
async function pressButton(element: Element): Promise<void> {
	await fire(element, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
	await fire(element, new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** Where the model this conversation now runs is recorded: the live slot, or its parked copy. */
function modelOf(id: string): string | undefined {
	const now = useApp.getState();
	return now.activeSessionId === id ? now.meta?.modelId : now.sessionCache[id]?.meta.modelId;
}

test("the effort button under a screen without focus reads that screen's effort", async () => {
	view = await onScreen("b", h(EffortTrigger, { modelId: B.modelId }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：关", "read the focused conversation's effort");
});

test("the model menu there ticks that screen's model", async () => {
	view = await onScreen("b", h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	const ticked = document.querySelector('[data-model][data-selected="true"]')?.getAttribute("data-model");
	assert.equal(ticked, B.modelId, "ticked the focused conversation's model");
});

test("choosing a model there changes that screen's conversation, brought on stage first", async () => {
	view = await onScreen("b", h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	const row = document.querySelector('[data-model="qa/model-3"] button');
	assert.ok(row, "no QA 3 row in the menu");
	await pressButton(row);
	// Mid-conversation, so it asks first; the answer lands when the card's exit animation ends.
	const confirm = [...document.querySelectorAll("[data-ly-modal] button")].find((one) => (one.getAttribute("aria-label") ?? one.textContent) === "确认切换");
	assert.ok(confirm, "switching mid-conversation did not ask");
	await pressButton(confirm);
	await new Promise((resolve) => setTimeout(resolve, 200));
	const card = document.querySelector("[data-ly-modal]");
	if (card) await fire(card, new Event("animationend", { bubbles: true }));
	for (let i = 0; i < 5 && chosen.length === 0; i++) await act(async () => {});
	assert.deepEqual(chosen, [["b", "qa/model-3"]], "switched the model of the conversation that has focus");
	assert.equal(useApp.getState().activeSessionId, "b", "the conversation acted on is brought on stage, as a press there would have");
	assert.equal(modelOf("b"), "qa/model-3");
	assert.equal(modelOf("a"), A.modelId, "the focused conversation's model changed");
});

test("the effort slider there starts at that screen's effort, and moves it", async () => {
	view = await onScreen("b", h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
	assert.ok(slider, "no effort slider");
	// Off is the first stop and high the last: 乙 is off, 甲 is at the top.
	assert.equal(slider.value, "0", "the slider opened at the focused conversation's effort");
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "2");
	await fire(slider, new Event("input", { bubbles: true }));
	for (let i = 0; i < 5 && efforts.length === 0; i++) await act(async () => {});
	assert.deepEqual(efforts, [["b", "medium"]], "moved the focused conversation's effort");
	assert.equal(useApp.getState().activeSessionId, "b");
});

test("naming the live conversation acts as before, and the blank screen touches no conversation", async () => {
	await useApp.getState().setModel("qa/model-3");
	await useApp.getState().setModel("qa/model", { sessionId: "a" });
	await useApp.getState().setThinking("low", "a");
	assert.deepEqual(opened, [], "brought a conversation on stage that was on stage already");
	assert.deepEqual(chosen, [["a", "qa/model-3"], ["a", "qa/model"]]);
	assert.deepEqual(efforts, [["a", "low"]]);
	// The blank screen has no session for a choice to land on: it becomes the default, whoever holds the live slot.
	await useApp.getState().setModel("qa/model-2", { sessionId: null });
	await useApp.getState().setThinking("medium", null);
	assert.equal(chosen.length, 2, "the blank screen's choice changed the model of the conversation beside it");
	assert.equal(efforts.length, 1, "the blank screen's effort changed the conversation beside it");
	assert.equal(useApp.getState().settings?.defaultModelId, "qa/model-2");
	assert.equal(useApp.getState().settings?.thinking, "medium");
});
