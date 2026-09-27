/**
 * 主智能体在等子智能体时，窗口这一头该做的几件事——都在 store 里，不用挂界面。
 *
 *   - 排着的话不再等：名单一说主会话在等子智能体，队首就送进去；
 *   - 后台子智能体的授权卡活过一轮：主会话收尾时只收它自己的，那几张等核心说收场了再拿走；
 *   - 这一轮收尾，输入框上方那一行据此收起；
 *   - 转到后台的派发，登记簿里没有它了之后，靠转录里的送达知道怎么收场的。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubAgentSummary } from "@lyra/core";
import { useSubAgents, awaitingSubAgents } from "../src/store/subAgents.ts";
import { outlivingTurn } from "../src/lib/approval-scope.ts";
import { deliveredReports, joinDispatches } from "../src/lib/dispatches.ts";

/*
 * 收尾那一支会顺手去主进程要一次会话列表（侧栏的排序）。这里不测它，但它得有个地方可去，
 * 否则 `bridge` 在断言之前就先抛了。
 */
const scope = globalThis as { window?: { lyra?: unknown } };
scope.window ??= {};
scope.window.lyra = { sessions: { list: async () => [] } };

const { applyAgentEvent } = await import("../src/store/apply-event.ts");

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function summary(over: Partial<SubAgentSummary> & { id: string }): SubAgentSummary {
	return { agent: "review", description: over.id, status: "running", startedAt: Date.now(), toolCalls: 0, depth: 1, usage, ...over };
}

function harness(over: Record<string, unknown> = {}) {
	const steered: string[] = [];
	let state: Record<string, unknown> = {
		activity: { s: "running" },
		turns: {},
		queued: { s: [{ id: "q1", preview: "先回答我" }, { id: "q2", preview: "再说一句" }] },
		sessionCache: {},
		activeSessionId: "s",
		messages: [],
		toolRuns: {},
		approvals: [],
		sessions: [],
		steerQueued: async (_session: string, id: string) => void steered.push(id),
		flushQueue: async () => {},
		...over,
	};
	const set = (patch: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => {
		state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
	};
	const dispatch = (event: Parameters<typeof applyAgentEvent>[1]) => applyAgentEvent("s", event, set as never, (() => state) as never);
	return { steered, dispatch, state: () => state };
}

test("主会话在等它派出去的子智能体：排着的队首送进去，只送一条", async () => {
	const h = harness();
	h.dispatch({ type: "subagents", agents: [summary({ id: "a" }), summary({ id: "b", status: "queued" })] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(h.steered, ["q1"]);
});

test("子智能体都转到后台了、或者主会话没在跑：不动队伍", async () => {
	const background = harness();
	background.dispatch({ type: "subagents", agents: [summary({ id: "a", background: true })] });
	const idle = harness({ activity: {} });
	idle.dispatch({ type: "subagents", agents: [summary({ id: "a" })] });
	const nested = harness();
	// 子智能体自己派的孩子不算——主会话等的是它们的父亲。
	nested.dispatch({ type: "subagents", agents: [summary({ id: "kid", depth: 2 })] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual([...background.steered, ...idle.steered, ...nested.steered], []);
	assert.equal(awaitingSubAgents([summary({ id: "done", status: "done" })]), false);
});

test("主会话收尾时只收它自己的授权卡，后台子智能体的那张留着，核心说收场了再拿走", () => {
	const from = { subAgentId: "s:sub:1", agent: "general", description: "改 a.ts" };
	const h = harness({ approvals: [{ id: "main", kind: "bash", title: "跑命令", detail: "" }, { id: "sub", kind: "write", title: "写入 a.ts", detail: "", from }] });
	h.dispatch({ type: "agent_end", reason: "done" });
	assert.deepEqual((h.state().approvals as { id: string }[]).map((one) => one.id), ["sub"]);
	h.dispatch({ type: "approval_settled", requestId: "sub" });
	assert.deepEqual(h.state().approvals, []);
	assert.deepEqual(outlivingTurn([]), [], "没有卡就原样还回去");
});

test("授权请求带着是谁在问", () => {
	const h = harness();
	const from = { subAgentId: "s:sub:1", agent: "general", description: "改 a.ts" };
	h.dispatch({ type: "approval_request", requestId: "r1", toolCallId: "r1", kind: "write", title: "写入 a.ts", detail: "a.ts", subject: "a.ts", from });
	assert.deepEqual((h.state().approvals as { from?: unknown }[])[0]?.from, from);
});

test("这一轮收尾，名单记下收尾时刻——输入框上方那一行据此收起", () => {
	useSubAgents.setState({ settled: {} });
	const h = harness();
	const before = Date.now();
	h.dispatch({ type: "agent_end", reason: "done" });
	assert.ok((useSubAgents.getState().settled.s ?? 0) >= before);
});

test("转到后台的派发：登记簿里没有它了，就看转录里的送达；没送达的是没回来，不是做完", () => {
	const call = (id: string, subAgentId: string) => ({ id, args: { description: "审查", subagent_type: "review" }, run: { status: "done" as const, result: { details: { detached: true, subAgentId } } } });
	const delivered = deliveredReports([
		{ role: "user", delivery: [{ id: "sub:ok", agent: "review", description: "审查", status: "done" }, { id: "sub:bad", agent: "review", description: "审查", status: "failed" }] },
		{ role: "assistant" },
	]);
	const states = joinDispatches([call("c1", "sub:ok"), call("c2", "sub:bad"), call("c3", "sub:lost")], [], delivered).map((one) => one.state);
	assert.deepEqual(states, ["done", "failed", "stopped"]);

	// 登记簿里还有它（正在后台跑）：照登记簿画——转圈，不是「做完了」。
	const live = joinDispatches([call("c1", "sub:ok")], [summary({ id: "sub:ok", status: "running", background: true })], delivered);
	assert.equal(live[0].state, "working");
});
