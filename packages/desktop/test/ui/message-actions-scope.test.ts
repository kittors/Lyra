/**
 * 撤回 and 编辑并重新发送 under a message act on the conversation that message is in.
 *
 * Both worked on the live slot — the focused screen's conversation. A press on another screen
 * focuses it first, so the mouse happened to be right; from the keyboard they took back, or rewrote
 * and re-ran, the message at the same place in the conversation beside it. Measured in a real window
 * (`e2e/split-scope-rest-probe.ts revert` and `edit`): the focused conversation's transcript on disk
 * was emptied, or replaced by the other screen's edited question.
 *
 * The buttons' own state had the same fault: disabled while the *focused* conversation ran, and
 * the confirmation skipped by the focused conversation's idea of which message was the last.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { Message, SessionMeta, UserContent, UserMessage as UserMessageType } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const question = (id: string): UserMessageType => ({ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 });
const said = (id: string): Message[] => [
	question(id),
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
function parked(id: string, running = false): Cache[string] {
	return { meta: meta(id), messages: said(id), toolRuns: {}, state: { running, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let reverted: Array<[string, number]>;
let edited: Array<[string, number, string]>;
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	reverted = [];
	edited = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			agent: {
				revertMessage: async (sessionId: string, index: number) => {
					reverted.push([sessionId, index]);
				},
				editMessage: async (sessionId: string, index: number, content: UserContent[]) => {
					const first = content.at(-1);
					edited.push([sessionId, index, first?.type === "text" ? first.text : ""]);
				},
			},
		},
	});
	// 甲 holds the live slot; 乙 is on the other screen, parked in the cache.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: said("a"), toolRuns: {}, running: false, stopped: null, todos: [], hiccups: [],
		sessions: [meta("a"), meta("b")], sessionCache: { b: parked("b") }, activity: {}, turns: {}, carried: {}, notices: [],
		// What `openSession` does to the live slot — park the one leaving, take the one arriving — without the disk read.
		openSession: async (target: SessionMeta) => {
			const now = useApp.getState();
			const cache = { ...now.sessionCache };
			if (now.activeSessionId && now.activeSessionId !== target.id && now.meta) cache[now.activeSessionId] = { ...parked(now.activeSessionId, now.running), messages: now.messages };
			const away = cache[target.id];
			useApp.setState({ sessionCache: cache, activeSessionId: target.id, meta: target, messages: away?.messages ?? [], running: away?.state?.running ?? false });
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

function onScreen(id: string): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, h(UserMessage, { message: question(id), index: 0 })) }));
}

test("撤回 on the screen without focus takes back that screen's message, not the focused one's", async () => {
	view = await onScreen("b");
	await click(view.find("[data-message-undo]"));
	// Settles once the conversation has been brought on stage and the take-back has gone out.
	for (let i = 0; i < 5 && reverted.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(reverted, [["b", 0]], "took back the message in the conversation with focus");
	assert.equal(useApp.getState().activeSessionId, "b", "the conversation acted on is brought on stage, as a press there would have");
});

test("编辑并重新发送 on the screen without focus rewrites that screen's conversation", async () => {
	view = await onScreen("b");
	await click(view.find('button[aria-label="编辑并重新发送"]'));
	const field = view.find<HTMLTextAreaElement>("textarea");
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
	setter?.call(field, "b 改过的问题");
	await fire(field, new Event("input", { bubbles: true }));
	await fire(field, new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	for (let i = 0; i < 5 && edited.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(edited, [["b", 0, "b 改过的问题"]], "the edit replaced the focused conversation's question");
	const now = useApp.getState();
	assert.deepEqual(now.activeSessionId === "a" ? now.messages : now.sessionCache.a?.messages, said("a"), "the focused conversation's transcript was cut");
});

test("the buttons read this screen's turn: busy only while this conversation runs", async () => {
	// The focused conversation is running; the one on this screen is not.
	useApp.setState({ running: true });
	view = await onScreen("b");
	assert.equal(view.find<HTMLButtonElement>("[data-message-undo]").disabled, false, "greyed out because the conversation beside it was running");
	await view.unmount();

	// And the other way round: this screen's conversation is running while the focused one is idle.
	useApp.setState({ running: false, sessionCache: { b: parked("b", true) } });
	view = await onScreen("b");
	assert.equal(view.find<HTMLButtonElement>("[data-message-undo]").disabled, true, "offered to take back a message in a conversation that is running");
});

test("naming the live conversation, or none, acts as before without opening anything", async () => {
	const opened: string[] = [];
	const open = useApp.getState().openSession;
	useApp.setState({
		openSession: async (target: SessionMeta) => {
			opened.push(target.id);
			await open(target);
		},
	});
	await useApp.getState().revertMessage(0, "a");
	await useApp.getState().revertMessage(0);
	assert.deepEqual(opened, []);
	assert.deepEqual(reverted, [["a", 0]], "the second take-back found nothing left to take back");
});
