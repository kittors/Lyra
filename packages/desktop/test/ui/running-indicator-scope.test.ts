/**
 * The running line under a screen's transcript tells that screen's turn: its clock, its tokens, what
 * it is doing, and whether it is reconnecting or has just been summarised.
 *
 * Measured in a real window (`e2e/split-scope-more-probe.ts running`): 甲 running a shell command
 * for a while, 乙 beside it typing out a reply. Every painted frame drew the same line under both
 * screens — the focused conversation's clock, count and activity. With focus on 乙, 甲's line said
 * 「composing · 2s · 900 tokens」; with focus on 甲, 乙's said 「working · 13s · 4.0k tokens」.
 * The line read `turnStartedAt`, `turnTokens`, `messages`, `toolRuns`, `retrying` and `compactedAt`,
 * which only describe the live slot.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { RunningIndicator } from "../../src/features/conversation/RunningIndicator.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import type { ToolRun } from "../../src/store/tool-run.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const now = Date.now();

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage: none };
}
const asked = (id: string): Message => ({ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: now - 20_000 });
// 乙's reply is still being typed out, 900 tokens in.
const typing: Message = { role: "assistant", content: [{ type: "text", text: "写写写" }], api: "anthropic-messages", provider: "qa", model: "model", usage: { ...none, input: 900 }, stopReason: "pending", timestamp: now - 2_000 };
// 甲 is waiting on a shell command.
const shell: ToolRun = { toolCallId: "t1", toolName: "bash", args: { command: "sleep 30" }, summary: "sleep 30", status: "running", startedAt: now - 10_000 } as ToolRun;

function beside(): Cache[string] {
	return {
		meta: meta("b"), messages: [asked("b"), typing], toolRuns: {},
		state: { running: true, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null },
	};
}

let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	// 甲 holds the live slot: twelve seconds in, 4k tokens spent, on a shell command. 乙 has been going three seconds.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: [asked("a")], toolRuns: { t1: shell },
		running: true, approvals: [], retrying: null, compactedAt: null,
		turnStartedAt: now - 12_000, turnTokens: 4_000,
		turns: { a: { startedAt: now - 12_000, tokens: 4_000 }, b: { startedAt: now - 3_000, tokens: 0 } },
		sessions: [meta("a"), meta("b")], sessionCache: { b: beside() }, activity: { a: "running", b: "running" },
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function lineUnder(id: string): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, h(RunningIndicator)) }));
}

/** What the line says: the orb's reading, and the clock and count beside it. */
function read(on: Mounted): { mood: string | null; clock: string; tokens: string } {
	const line = on.find("[data-ly-running]");
	const numbers = [...line.querySelectorAll(".tabular-nums")].map((el) => el.textContent?.trim() ?? "");
	return { mood: line.getAttribute("data-ly-mood"), clock: numbers[0] ?? "", tokens: numbers.find((text) => text.includes("tokens")) ?? "" };
}

test("the line under a screen without focus tells that screen's turn, not the focused one's", async () => {
	view = await lineUnder("b");
	const line = read(view);
	assert.equal(line.mood, "composing", "said the focused conversation was running a command");
	assert.equal(line.clock, "3s", "showed the focused conversation's clock");
	assert.equal(line.tokens, "本轮 900 tokens", "counted the focused conversation's tokens");
});

/*
 * Reconnecting and summarised are asked apart: while a turn reconnects the line leaves the summary
 * unsaid (the countdown is the news), so a case holding both would only ever test the first.
 */
test("a reconnecting focused conversation says so under its own screen only", async () => {
	await act(async () => useApp.setState({ retrying: { attempt: 1, until: now + 8_000, reason: "连接中断", resume: false } }));
	view = await lineUnder("b");
	assert.equal(read(view).mood, "composing", "said it was reconnecting while its own stream was arriving");
});

test("a just-summarised focused conversation says so under its own screen only", async () => {
	await act(async () => useApp.setState({ compactedAt: now }));
	view = await lineUnder("b");
	assert.doesNotMatch(view.text(), /已压缩较早的对话/, "announced the focused conversation's summary");
});

test("a screen's own reconnect is told under it while another holds the live slot", async () => {
	await act(async () => useApp.setState({ sessionCache: { b: { ...beside(), state: { ...beside().state!, retrying: { attempt: 1, until: now + 8_000, reason: "连接中断", resume: false } } } } }));
	view = await lineUnder("b");
	assert.equal(read(view).mood, "connecting", "missed that this conversation is reconnecting");
});

test("a screen's own summary is told under it while another holds the live slot", async () => {
	await act(async () => useApp.setState({ sessionCache: { b: { ...beside(), state: { ...beside().state!, compactedAt: now } } } }));
	view = await lineUnder("b");
	assert.match(view.text(), /已压缩较早的对话/, "missed that this conversation was just summarised");
});

test("the line keeps its reading when its conversation takes the live slot", async () => {
	view = await lineUnder("b");
	const before = read(view);
	// What `openSession` puts in the live slot for 乙: its messages and tool runs, and its meter mirrored from `turns`.
	await act(async () =>
		useApp.setState({
			activeSessionId: "b", meta: meta("b"), messages: [asked("b"), typing], toolRuns: {}, turnStartedAt: now - 3_000, turnTokens: 0,
			sessionCache: { a: { meta: meta("a"), messages: [asked("a")], toolRuns: { t1: shell }, state: { ...beside().state!, running: true } } },
		}),
	);
	assert.deepEqual(read(view), before, "the reading jumped when focus moved to this screen");
});
