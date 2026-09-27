/**
 * What a screen shows about "is a turn running" follows that screen's conversation.
 *
 * Two readers still asked the live slot's `running`, which is the focused screen's turn:
 *
 *   The context reading under a composer re-reads its breakdown when its conversation finishes a
 *   turn and holds still while one runs. With the focused conversation running, the reading under
 *   the screen beside it froze across that screen's own finished turns; with the focused one idle, a
 *   running screen beside it re-read on every message. A summary in the focused conversation re-read
 *   every screen's.
 *
 *   The newest reasoning in a transcript types itself out while its turn runs. Under a screen whose
 *   turn had stopped, reasoning cut short by that stop started typing again whenever the focused
 *   conversation was running.
 *
 * Both measured in a real window (`e2e/split-scope-more-probe.ts meter` and `thinking`).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type AssistantMessage, type Message, type SessionMeta, type Settings } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { ContextMeter } from "../../src/features/composer/ContextMeter.tsx";
import { MessageRow } from "../../src/features/conversation/rows.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model = { id: "qa/model", modelId: "model", providerId: "qa", name: "QA", contextWindow: 128_000, maxOutputTokens: 4096, supportsThinking: true, supportsImages: false, supportsTools: true };
const settings: Settings = { ...DEFAULT_SETTINGS, providers: [{ id: "qa", name: "QA", api: "anthropic-messages", apiKey: "test", baseUrl: "http://localhost", enabled: true, models: [model] }], defaultModelId: model.id };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: model.id, messageCount: 2, seq: 3, usage };
}
const exchange = (id: string, turn: number): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的第 ${turn} 个问题` }], timestamp: turn * 10 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的第 ${turn} 个回答` }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: turn * 10 + 1 },
];
function parked(id: string, messages: Message[], running: boolean): Cache[string] {
	return { meta: meta(id), messages, toolRuns: {}, state: { running, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let reads: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	reads = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			sessions: {
				contextBreakdown: async (sessionId: string) => {
					reads.push(sessionId);
					return { used: 1000, limit: 128_000, measured: true, segments: [] };
				},
			},
			// A reply row asks whether its turn left a delivery; none did.
			delivery: { get: async () => null },
		},
	});
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: exchange("a", 1), toolRuns: {}, compactions: [], approvals: [],
		sessions: [meta("a"), meta("b")], activity: {}, settings,
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function meterUnder(id: string, messages: Message[]): ReturnType<typeof h> {
	return h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, h(ContextMeter, { messages, settings, modelId: model.id, sessionId: id })) });
}
const settle = () => act(async () => {});

test("the reading under a screen re-reads when that screen finishes a turn, whatever the focused one is doing", async () => {
	// 甲, focused, is running; 乙 beside it is not.
	useApp.setState({ running: true, sessionCache: { b: parked("b", exchange("b", 1), false) } });
	view = await mount(meterUnder("b", exchange("b", 1)));
	await settle();
	assert.deepEqual(reads, ["b"]);
	// 乙 finishes another turn while 甲 is still running.
	const later = [...exchange("b", 1), ...exchange("b", 2)];
	await act(async () => useApp.setState({ sessionCache: { b: parked("b", later, false) } }));
	await view.rerender(meterUnder("b", later));
	await settle();
	assert.deepEqual(reads, ["b", "b"], "the reading froze because the conversation beside it was running");
});

test("the reading under a running screen holds still while its turn runs, even with the focused one idle", async () => {
	// 甲, focused, is idle; 乙 is mid-turn.
	useApp.setState({ running: false, sessionCache: { b: parked("b", exchange("b", 1), true) } });
	view = await mount(meterUnder("b", exchange("b", 1)));
	await settle();
	const during = [...exchange("b", 1), exchange("b", 2)[0]];
	await act(async () => useApp.setState({ sessionCache: { b: parked("b", during, true) } }));
	await view.rerender(meterUnder("b", during));
	await settle();
	assert.deepEqual(reads, ["b"], "rebuilt the prompt for a message in the middle of a running turn");
});

test("a summary in the focused conversation does not re-read the screen beside it", async () => {
	useApp.setState({ running: false, sessionCache: { b: parked("b", exchange("b", 1), false) } });
	view = await mount(meterUnder("b", exchange("b", 1)));
	await settle();
	await act(async () => useApp.setState({ compactions: [{ at: 2, before: 90_000, after: 20_000 }] }));
	await settle();
	assert.deepEqual(reads, ["b"], "re-read because the focused conversation was summarised");
});

test("reasoning cut short under a stopped screen stays still while the focused conversation runs", async () => {
	// 乙 stopped mid-thought; 甲, focused, is running.
	const stopped: AssistantMessage = { role: "assistant", content: [{ type: "thinking", thinking: "先看目录\n再读配置" }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "aborted", timestamp: 21 };
	const said: Message[] = [exchange("b", 1)[0], stopped];
	useApp.setState({ running: true, sessionCache: { b: parked("b", said, false) } });
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: "b" }, h(MessageRow, { message: stopped, index: 1, upTo: 1, newest: true })) }));
	const row = view.find("[data-ly-thinking] .ly-flow-summary");
	assert.equal(row.hasAttribute("data-follow-end"), false, "the stopped reasoning is typing itself out again");
	assert.equal(row.textContent?.trim(), "先看目录", "a settled reasoning row opens with its first line");
});
