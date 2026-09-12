/**
 * 一轮烧了多少 token——**包括委派出去烧的那部分**。
 *
 * 这条线此前只数主 Agent 自己的回复。于是一轮里派四个子代理去审代码，它们烧掉五十多万 token 的
 * 时候，运行指示器上写的还是主 Agent 自己的五万八：差一个数量级，而人正是靠那个数字判断这一轮
 * 花了多少、要不要按停。
 *
 * 会话卡片（`session/store.ts`）和用量统计页（`electron/usage-scan.ts`）早就把子代理算进去了，
 * 两处的注释里都记着它们各自漏掉时的样子。唯独跑起来时盯着看的这条漏着，而它恰恰是唯一在「还
 * 来得及做点什么」的时候被人看见的那条。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { AgentEvent } from "@lyra/core";
import { useApp } from "../src/store/index.ts";
import { applyAgentEvent } from "../src/store/apply-event.ts";

const SESSION = "s1";

/** 一条带用量的助手消息，`freshTokens` 认的是 input + cacheWrite + output。 */
function assistant(tokens: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number } = {}) {
	const input = tokens.input ?? 0;
	const output = tokens.output ?? 0;
	const cacheWrite = tokens.cacheWrite ?? 0;
	const cacheRead = tokens.cacheRead ?? 0;
	return {
		role: "assistant" as const,
		api: "openai-chat-completions" as const,
		provider: "p",
		model: "m",
		stopReason: "stop" as const,
		timestamp: Date.now(),
		content: [{ type: "text" as const, text: "ok" }],
		usage: {
			input,
			output,
			cacheRead,
			cacheWrite,
			total: input + output + cacheRead + cacheWrite,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function feed(event: AgentEvent): void {
	applyAgentEvent(SESSION, event, (partial) => useApp.setState(partial as never), () => useApp.getState());
}

beforeEach(() => {
	useApp.setState({ activeSessionId: SESSION, turns: {}, carried: {}, turnStartedAt: null, turnTokens: 0, queued: {} });
});

test("委派出去烧的 token 也算这一轮的", () => {
	feed({ type: "agent_start", sessionId: SESSION });
	feed({ type: "message_end", message: assistant({ input: 1000, output: 200 }) });
	assert.equal(useApp.getState().turnTokens, 1200, "主 Agent 自己的那部分，照旧");

	feed({ type: "subagent_message", id: `${SESSION}:sub:a`, message: assistant({ input: 40_000, output: 800 }) });
	assert.equal(useApp.getState().turnTokens, 42_000, "子代理那 40.8k 也进了这一轮");

	// 两个并行的子代理，各自的回合分别记账。
	feed({ type: "subagent_message", id: `${SESSION}:sub:b`, message: assistant({ input: 8_000 }) });
	assert.equal(useApp.getState().turnTokens, 50_000);
});

test("子代理的工具结果不重复记账——用量只挂在助手消息上", () => {
	feed({ type: "agent_start", sessionId: SESSION });
	feed({ type: "subagent_message", id: `${SESSION}:sub:a`, message: assistant({ input: 5_000 }) });
	feed({
		type: "subagent_message",
		id: `${SESSION}:sub:a`,
		message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "..." }], isError: false, timestamp: Date.now() },
	});
	assert.equal(useApp.getState().turnTokens, 5_000, "工具结果不带用量，数进来只会重复");
});

test("缓存读不算新烧的，和主 Agent 同一把尺", () => {
	/*
	 * `freshTokens` 是 input + cacheWrite + output，不含 cacheRead——命中缓存的那部分几乎不要钱，
	 * 把它算成「这一轮烧掉的」会让一个高命中率的长会话看起来贵得离谱。子代理必须用同一个口径，
	 * 否则同一个数字的两半各按各的算法，加起来谁也解释不了。
	 */
	feed({ type: "agent_start", sessionId: SESSION });
	feed({ type: "subagent_message", id: `${SESSION}:sub:a`, message: assistant({ input: 300, cacheRead: 90_000, cacheWrite: 100, output: 50 }) });
	assert.equal(useApp.getState().turnTokens, 450, "9 万的缓存读不进这个数");
});
