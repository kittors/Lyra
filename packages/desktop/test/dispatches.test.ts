/**
 * 对话里的 `task` 调用和登记簿里的子智能体，对不对得上号。
 *
 * 界面上「谁在排队」全靠这一步：闸门后面的调用在登记簿里一个字都没有，只有对不上号、调用又还在
 * 跑，才知道它在等。对错了号，面板会把 A 的进度画在 B 的脸上。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubAgentSummary } from "@lyra/core";
import { joinDispatches, stateOf, type DispatchCall } from "../src/lib/dispatches.ts";

function summary(over: Partial<SubAgentSummary> & { id: string }): SubAgentSummary {
	return {
		agent: "general",
		description: over.id,
		status: "running",
		startedAt: 1000,
		toolCalls: 0,
		depth: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		...over,
	};
}

const call = (id: string, args: Record<string, unknown>, run?: DispatchCall["run"]): DispatchCall => ({ id, args, run });

test("four dispatched, one admitted by the gate: the other three are queued, not missing", () => {
	const calls = [
		call("c1", { description: "找登录入口", subagent_type: "general" }, { status: "running", startedAt: 900 }),
		call("c2", { description: "审一遍鉴权", subagent_type: "simple" }, { status: "running", startedAt: 900 }),
		call("c3", { description: "规划迁移", subagent_type: "reason" }, { status: "running", startedAt: 900 }),
		call("c4", { description: "整理文档", subagent_type: "docs-writer" }, { status: "running", startedAt: 900 }),
	];
	const views = joinDispatches(calls, [summary({ id: "sub:1", description: "找登录入口", startedAt: 950 })]);
	assert.deepEqual(views.map((view) => [view.callId, view.agent, view.state]), [
		["c1", "general", "working"],
		["c2", "simple", "waiting"],
		["c3", "reason", "waiting"],
		["c4", "docs-writer", "waiting"],
	]);
	assert.equal(views[0].summary?.id, "sub:1");
});

test("a finished call is matched by the id in its result, even when another has the same words", () => {
	const roster = [
		summary({ id: "sub:old", description: "查一下", status: "done", startedAt: 100 }),
		summary({ id: "sub:new", description: "查一下", status: "failed", startedAt: 2000 }),
	];
	const views = joinDispatches([call("c", { description: "查一下" }, { status: "error", startedAt: 1900, result: { details: { subAgentId: "sub:new" } } })], roster);
	assert.equal(views[0].summary?.id, "sub:new");
	assert.equal(views[0].state, "failed");
});

test("two calls with the same agent and words take one record each, in order, and never one started before them", () => {
	// 上一轮那个「看看」一分钟前就登记了；这一轮的两个调用在 60 秒那一刻发出，各自对上这一轮登记的两条。
	const roster = [
		summary({ id: "sub:earlier-turn", description: "看看", startedAt: 1000 }),
		summary({ id: "sub:b", description: "看看", startedAt: 60020 }),
		summary({ id: "sub:a", description: "看看", startedAt: 60010 }),
	];
	const views = joinDispatches(
		[call("x", { description: "看看" }, { status: "running", startedAt: 60000 }), call("y", { description: "看看" }, { status: "running", startedAt: 60000 })],
		roster,
	);
	assert.deepEqual(views.map((view) => view.summary?.id), ["sub:a", "sub:b"], "each call its own record; the earlier turn's is left alone");
});

test("a resume finds the sub-agent by its id, full or short", () => {
	const roster = [summary({ id: "sub:1a2b3c4d", description: "旧活", status: "running", agent: "explore" })];
	for (const resume of ["sub:1a2b3c4d", "1a2b3c4d"]) {
		const [view] = joinDispatches([call("r", { description: "接着跑", resume }, { status: "running", startedAt: 5000 })], roster);
		assert.equal(view.summary?.id, "sub:1a2b3c4d", resume);
		assert.equal(view.agent, "explore", "whoever it was dispatched as, not whatever this call says");
	}
});

test("renamed agents are called by their new names, and a record the roster no longer has falls back to the call", () => {
	const [renamed] = joinDispatches([call("f", { description: "快", subagent_type: "fast" }, { status: "done" })], []);
	assert.equal(renamed.agent, "simple");
	assert.equal(renamed.state, "done", "finished and cleared from the roster: it was done");
	const [broken] = joinDispatches([call("e", { description: "坏了" }, { status: "error" })], []);
	assert.equal(broken.state, "failed");
	const [unknown] = joinDispatches([call("h", { prompt: "从历史里读回来的，没有运行记录也没有描述" })], []);
	assert.equal(unknown.state, "done");
	assert.equal(unknown.agent, "general");
	assert.ok(unknown.description.startsWith("从历史里"), "no description: the start of the prompt stands in");
});

test("a face's state reads the record: an unfinished `done` is resting, not finished", () => {
	assert.equal(stateOf({ status: "running" }), "working");
	assert.equal(stateOf({ status: "done" }), "done");
	assert.equal(stateOf({ status: "done", incomplete: true }), "stopped");
	assert.equal(stateOf({ status: "failed" }), "failed");
	assert.equal(stateOf({ status: "aborted" }), "stopped");
});
