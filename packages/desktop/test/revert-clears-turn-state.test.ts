/**
 * 撤回一条消息，也要把「上一轮怎么结束的」一起退回去。
 *
 * `stopped` 讲的是最后那一轮的收场。撤回把那一轮整个拿掉之后它却原样留着，于是撤回唯一一条
 * 消息之后：转录空了，而 `ResumeRow` 照着一个已经不存在的轮次说「已暂停 · 继续」，点下去往
 * 空会话里发一句「继续」。真窗口里看到的就是一整片空白外加那一行——见
 * `e2e/revert-empties-session-probe.ts`。
 *
 * 这里测的是状态那一半（画成什么样归探针管）：撤到哪儿，`stopped` 就该是那一截自己的结论。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Message } from "@lyra/core";

const storage: Record<string, string> = {};
const reverted: { sessionId: string; index: number }[] = [];

(globalThis as unknown as { window: unknown }).window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	localStorage: {
		getItem: (k: string) => storage[k] ?? null,
		setItem: (k: string, v: string) => { storage[k] = v; },
		removeItem: (k: string) => { delete storage[k]; },
	},
	matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
	lyra: {
		sessions: { list: async () => [], running: async () => false },
		agent: { revertMessage: async (sessionId: string, index: number) => { reverted.push({ sessionId, index }); } },
	},
};

const { useApp } = await import("../src/store/index.ts");

const SESSION = "revert-session";
const T0 = 1_700_000_000_000;

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: T0 };
}

/** `stopReason` 决定 `howItStopped` 读出什么，这正是要测的那条线。 */
function assistant(text: string, stopReason: "stop" | "aborted" | "error"): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "qa",
		model: "qa",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason,
		timestamp: T0 + 1,
	} as Message;
}

function seed(messages: Message[], stopped: "user" | "error" | "interrupt" | null) {
	useApp.setState({
		activeSessionId: SESSION,
		messages,
		stopped,
		running: false,
		toolRuns: {},
		approvals: [],
		commandRuns: [],
		compactions: [],
		hiccups: [],
		sessionCache: {},
	});
}

beforeEach(() => {
	reverted.length = 0;
});

test("撤回唯一一条消息之后，不再有「上一轮」可以继续", async () => {
	seed([user("看看那个目录"), assistant("那里有三个子项目。", "aborted")], "user");
	assert.equal(useApp.getState().stopped, "user", "前提：这一轮是被中止的");

	await useApp.getState().revertMessage(0);

	assert.deepEqual(useApp.getState().messages, [], "转录空了");
	assert.equal(useApp.getState().stopped, null, "「已暂停」也该跟着没了");
	assert.deepEqual(reverted, [{ sessionId: SESSION, index: 0 }], "撤回请求发出去了");
});

test("撤到中间时，留下的那一截自己说了算", async () => {
	/*
	 * 不是简单置空：撤回点之前的那一截可能本来就是中断的，那时「已暂停」是对的，不该抹掉。
	 */
	seed([user("第一问"), assistant("第一答被中止了。", "aborted"), user("第二问"), assistant("第二答好好结束了。", "stop")], null);

	await useApp.getState().revertMessage(2);

	assert.equal(useApp.getState().messages.length, 2, "只留下第一轮");
	assert.equal(useApp.getState().stopped, "user", "而第一轮确实是被中止的");
});

test("撤回后留下的是正常结束的一轮，就没有什么要继续", async () => {
	seed([user("第一问"), assistant("第一答好好结束了。", "stop"), user("第二问"), assistant("第二答被中止了。", "aborted")], "user");

	await useApp.getState().revertMessage(2);

	assert.equal(useApp.getState().messages.length, 2);
	assert.equal(useApp.getState().stopped, null, "被中止的那一轮已经被撤掉了");
});

test("撤回失败时，连同 stopped 一起回滚", async () => {
	const lyra = (globalThis as unknown as { window: { lyra: { agent: { revertMessage: unknown } } } }).window.lyra;
	const good = lyra.agent.revertMessage;
	lyra.agent.revertMessage = async () => { throw new Error("磁盘满了"); };
	try {
		const messages = [user("看看那个目录"), assistant("那里有三个子项目。", "aborted")];
		seed(messages, "user");

		await useApp.getState().revertMessage(0);

		assert.equal(useApp.getState().messages.length, 2, "转录退回去了");
		assert.equal(useApp.getState().stopped, "user", "「已暂停」也该退回去——否则那一行会凭空消失");
	} finally {
		lyra.agent.revertMessage = good;
	}
});
