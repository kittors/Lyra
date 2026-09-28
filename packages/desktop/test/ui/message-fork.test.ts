/**
 * 「从这里分叉」 on a message the person wrote: a new conversation with everything before it, opened
 * where the button was pressed, with the message back in its composer. The conversation it came from
 * is not touched — nothing is taken back, nothing is sent.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { Message, SessionMeta, UserMessage as UserMessageType } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string, title = id): SessionMeta {
	return { id, title, cwd: `/work/${id}`, projectId: `p-${id}`, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 4, seq: 5, usage };
}
const ask = (text: string, timestamp: number): UserMessageType => ({ role: "user", content: [{ type: "text", text }], timestamp });
const answer = (text: string, timestamp: number): Message => ({ role: "assistant", content: [{ type: "text", text }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp });
const said = (id: string): Message[] => [ask(`${id} 的第一个问题`, 10), answer("第一个回答", 11), ask(`${id} 的第二个问题`, 20), answer("第二个回答", 21)];
function parked(id: string, running = false): Cache[string] {
	return { meta: meta(id), messages: said(id), toolRuns: {}, state: { running, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

const FORK = meta("fork", "b（分叉）");
let forks: Array<[string, string, number, number, string | undefined]>;
let answerWith: SessionMeta | null | Error;
let reverted: number;
let notices: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	forks = [];
	answerWith = FORK;
	reverted = 0;
	notices = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			agent: { revertMessage: async () => void reverted++ },
			sessions: {
				forkBefore: async (projectId: string, sessionId: string, index: number, timestamp: number, title?: string) => {
					forks.push([projectId, sessionId, index, timestamp, title]);
					if (answerWith instanceof Error) throw answerWith;
					return answerWith ? { meta: answerWith, messages: index } : null;
				},
			},
		},
	});
	// 甲 holds the live slot; 乙 is on the other screen, parked in the cache.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: said("a"), toolRuns: {}, running: false, stopped: null, todos: [], hiccups: [],
		sessions: [meta("a"), meta("b")], sessionCache: { b: parked("b") }, activity: {}, turns: {}, carried: {}, notices: [], drafts: {},
		notify: (message: string) => void notices.push(message),
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
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function onScreen(id: string, index: number): Promise<Mounted> {
	const message = said(id)[index] as UserMessageType;
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, h(UserMessage, { message, index })) }));
}

async function settled(done: () => boolean) {
	for (let i = 0; i < 20 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the button sits last in the row and says what it does", async () => {
	view = await onScreen("b", 2);
	const button = view.find<HTMLButtonElement>("[data-message-fork]");
	assert.equal(button.getAttribute("data-ly-tip"), "从这里分叉");
	const row = button.parentElement!;
	assert.equal(row.lastElementChild, button, "after 撤回 and 编辑, where Claude Code puts its fork");
});

test("forking the second question opens a conversation of everything before it, with the question in its composer", async () => {
	view = await onScreen("b", 2);
	await click(view.find("[data-message-fork]"));
	await settled(() => useApp.getState().activeSessionId === "fork");
	assert.deepEqual(forks, [["p-b", "b", 2, 20, "b（分叉）"]], "forked this screen's conversation, before this message, named in the window's language");
	const now = useApp.getState();
	assert.equal(now.activeSessionId, "fork", "the fork is opened");
	assert.equal(now.composerDraft?.sessionId, "fork", "the draft is the fork's, not the original's");
	assert.equal(now.composerDraft?.text, "b 的第二个问题", "the question waits in the fork's composer");
	assert.equal(reverted, 0, "nothing was taken back from the original");
	assert.deepEqual(now.sessionCache.b?.messages ?? parked("b").messages, said("b"), "the original keeps every message");
});

test("offered while this conversation runs — it changes nothing here — unlike 撤回", async () => {
	useApp.setState({ sessionCache: { b: parked("b", true) } });
	view = await onScreen("b", 2);
	assert.equal(view.find<HTMLButtonElement>("[data-message-undo]").disabled, true);
	assert.equal(view.find<HTMLButtonElement>("[data-message-fork]").disabled, false);
});

test("a fork that could not be made says so, and opens nothing", async () => {
	answerWith = null;
	view = await onScreen("b", 2);
	await click(view.find("[data-message-fork]"));
	await settled(() => notices.length > 0);
	assert.deepEqual(notices, ["分叉失败"]);
	assert.equal(useApp.getState().activeSessionId, "a");

	answerWith = new Error("磁盘满了");
	await click(view.find("[data-message-fork]"));
	await settled(() => notices.length > 1);
	assert.equal(notices[1], "分叉失败: 磁盘满了");
});
