/**
 * The side chat under a screen says which model and effort it will use for that screen's
 * conversation, not for the one with focus.
 *
 * A side chat left on 「跟随主会话」 names the model its next question goes to and offers that
 * model's effort levels. Both were read from the live slot's `meta`, which describes the focused
 * screen only: with focus on 甲 (QA 2, effort 高), the side chat under 乙 (QA, effort off) said QA 2
 * and 高. The request itself went to the right place — the main process reads the side chat's own
 * conversation — so what was wrong was what the person was told before sending.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type Message, type SessionMeta, type Settings, type ThinkingLevel } from "@lyra/core";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { useSide } from "../../src/features/dock/sideStore.ts";
import { SideComposer } from "../../src/features/sidechat/SideComposer.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const models = [
	{ id: "qa/model", name: "QA" },
	{ id: "qa/model-2", name: "QA 2" },
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
// 甲 thinks hard on QA 2 and holds the live slot; 乙, beside it, is on QA with thinking off.
const A = meta("a", "qa/model-2", "high");
const B = meta("b", "qa/model");
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: 2 },
];
function parked(one: SessionMeta): Cache[string] {
	return { meta: one, messages: said(one.id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let previous: { app: AppState; side: ReturnType<typeof useSide.getState> };
let view: Mounted | undefined;

beforeEach(() => {
	previous = { app: useApp.getState(), side: useSide.getState() };
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: A, messages: said("a"), toolRuns: {}, running: false,
		sessions: [A, B], sessionCache: { b: parked(B) }, settings,
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous.app, true);
	useSide.setState(previous.side, true);
	Reflect.deleteProperty(window, "lyra");
});

/** The side chat as it sits in a screen's dock: that screen's dock, beside that screen's conversation. */
function sideChatIn(id: string): Promise<Mounted> {
	const body = h(SideComposer, { running: false, onSend() {}, onStop() {} });
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, body)) }));
}

test("a side chat following its conversation names that conversation's model, under a screen without focus", async () => {
	view = await sideChatIn("b");
	assert.equal(view.find('button[aria-label="侧边聊天模型"]').textContent?.trim(), "QA", "named the focused conversation's model");
});

test("a side chat following its conversation offers that conversation's effort, under a screen without focus", async () => {
	view = await sideChatIn("b");
	assert.equal(view.find('button[aria-label^="推理强度"]').getAttribute("aria-label"), "推理强度：关", "read the focused conversation's effort");
});

test("the 「跟随主会话」 row of the side chat's model menu names the model it follows", async () => {
	view = await sideChatIn("b");
	await click(view.find('button[aria-label="侧边聊天模型"]'));
	const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].find((element) => element.textContent?.startsWith("跟随主会话"));
	assert.ok(row, "no 「跟随主会话」 row");
	assert.equal(row.textContent, "跟随主会话QA", "the row named the focused conversation's model");
});

test("the side chat under the screen with focus still names its own conversation's model", async () => {
	view = await sideChatIn("a");
	assert.equal(view.find('button[aria-label="侧边聊天模型"]').textContent?.trim(), "QA 2");
	assert.equal(view.find('button[aria-label^="推理强度"]').getAttribute("aria-label"), "推理强度：高");
});
