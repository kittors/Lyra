/**
 * 转录末尾那行小字：此刻在等什么。
 *
 * 上一轮还在写的时候又发一条，那条气泡已经画进转录了，可后台还没开始处理它。从前这里画的是
 * 正常的 `Thinking…`——紧挨在新气泡下面，读起来是「正在想你这条」，而真相是 agent 还在写上面
 * 那条。人看着一个说它在想的转圈，等来的却是上一条的答案。
 *
 * 判据是 `pendingUserMessage`：它是「已经乐观画出来、但还没听见后台承认」的那一条。后台真正
 * 受理时会把它作为 `message_start` 广播回来，那一刻它就空了。所以它还在 = 还没轮到。
 *
 * 门槛那一条单列出来测：闲着的时候发一条，这个标记也会亮几十毫秒，那时候闪一行「在排队」说的
 * 是一件没发生过的事。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import type { Message } from "@lyra/core";
import { RunningIndicator } from "../../src/features/conversation/RunningIndicator.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

const AWAIT_GRACE_MS = 400;

const asked: Message = { role: "user", content: [{ type: "text", text: "第二条消息" }], timestamp: 1_700_000_000_000 };

/** 门槛是真的定时器，所以只能真的等——比门槛多一点，别卡在边上。 */
const past = () => new Promise((resolve) => setTimeout(resolve, AWAIT_GRACE_MS + 150));

function reset(): void {
	useApp.setState({
		activeSessionId: "s1", messages: [asked], running: true, turnStartedAt: Date.now(),
		turnTokens: 0, toolRuns: {}, approvals: [], retrying: null, compactedAt: null,
		pendingUserMessage: null, sessionCache: {},
	});
}

const line = () => document.querySelector("[data-ly-running]");

test("后台还没受理这一条：说的是「等上一条回复完成」", async () => {
	reset();
	useApp.setState({ pendingUserMessage: { sessionId: "s1", message: asked } });
	const view = await mount(h(RunningIndicator, null));
	try {
		await past();
		const row = line();
		assert.ok(row, "转录末尾那行没画出来");
		assert.ok(row.hasAttribute("data-ly-awaiting-turn"), "没有标成「还没轮到」——它画的还是普通的「正在想」");
		assert.match(row.textContent ?? "", /等上一条回复完成/);
	} finally {
		await view.unmount();
	}
});

test("后台受理了：换回正常的那一行", async () => {
	reset();
	const view = await mount(h(RunningIndicator, null));
	try {
		await past();
		const row = line();
		assert.ok(row, "转录末尾那行没画出来");
		assert.equal(row.hasAttribute("data-ly-awaiting-turn"), false, "没人在等，却说在等");
		assert.doesNotMatch(row.textContent ?? "", /等上一条回复完成/);
	} finally {
		await view.unmount();
	}
});

/*
 * 闲着的时候发一条，从按下回车到后台承认也就几十毫秒——那段时间这个标记同样亮着。
 *
 * 不设门槛的话，每一次正常发送都会先闪一行「等上一条回复完成」再被顶掉，看上去是界面自己抽了
 * 一下。所以门槛内必须还是原来那一行。
 */
test("门槛之内不说话：正常发一条不会闪出「在排队」", async () => {
	reset();
	useApp.setState({ pendingUserMessage: { sessionId: "s1", message: asked } });
	const view = await mount(h(RunningIndicator, null));
	try {
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.equal(line()?.hasAttribute("data-ly-awaiting-turn"), false, "刚发出去就喊在排队");
	} finally {
		await view.unmount();
	}
});

/*
 * 等回答优先。
 *
 * 一次提问或审批摆在面前时，后台早就受理过这条消息了（`message_start` 是在提问之前发出去的），
 * 所以两者本不该同时成立。但这一行只有一个位置，谁先谁后要说死：人被问住了是更要紧的事。
 */
test("在等人回答的时候，让位给「等待你的回答」", async () => {
	reset();
	useApp.setState({
		pendingUserMessage: { sessionId: "s1", message: asked },
		approvals: [{ id: "a1", kind: "interactive", sessionId: "s1", question: "选哪个？", options: [] }] as never,
	});
	const view = await mount(h(RunningIndicator, null));
	try {
		await past();
		const row = line();
		assert.ok(row, "转录末尾那行没画出来");
		assert.equal(row.hasAttribute("data-ly-awaiting-turn"), false, "抢了等回答那一行的位置");
		assert.match(row.textContent ?? "", /等待你的回答/);
	} finally {
		await view.unmount();
	}
});

/*
 * 分屏里的另一格：问的是那一格自己的会话，不是台上那个。
 *
 * `useScopedAwaitingTurn` 对不在台上的会话读的是缓存里的那份。读错了的话，一格在等、另一格也
 * 跟着喊在等——而它们各自跑各自的轮。
 */
test("不在台上的那个会话，读的是它自己的状态", async () => {
	reset();
	useApp.setState({
		activeSessionId: "s2", messages: [], pendingUserMessage: null,
		sessionCache: { s1: { meta: { id: "s1" }, messages: [asked], toolRuns: {},
			state: { running: true, approvals: [], todos: [], compactions: [], stopped: null, retrying: null, capabilities: null,
				pendingUserMessage: { sessionId: "s1", message: asked } } } } as never,
	});
	const { SessionScope } = await import("../../src/app/session-scope.tsx");
	const view = await mount(h(SessionScope.Provider, { value: "s1" }, h(RunningIndicator, null)));
	try {
		await past();
		assert.equal(line()?.hasAttribute("data-ly-awaiting-turn"), true, "读的是台上那个会话，不是这一格自己的");
	} finally {
		await view.unmount();
	}
});
