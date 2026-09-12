/**
 * The bar announces delegated work by opening the pane — once per batch.
 *
 * The hook that does this was exported alongside the pane and called from nowhere: for a month
 * the first dispatch of a run put a line under the composer and nothing else. Mounted, so that
 * taking the call out again goes red — a hook nobody calls renders exactly like one that works.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { act, createElement as h } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { SubAgentBar } from "../../src/features/subagents/SubAgentBar.tsx";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { mount } from "../helpers/mount.ts";

function summary(over: Partial<SubAgentSummary> & { id: string; tokens?: number; cost?: number }): SubAgentSummary {
	const { tokens = 0, cost = 0, ...rest } = over;
	return {
		agent: "general",
		description: rest.id,
		status: "running",
		startedAt: Date.now() - 5000,
		toolCalls: 0,
		depth: 1,
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
		...rest,
	};
}

/** A roster event, as the main process would send one. */
async function roster(agents: SubAgentSummary[]): Promise<void> {
	await act(async () => {
		useSubAgents.getState().sync(agents);
	});
}

beforeEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
});

test("the first dispatch of a run opens the pane; the rest of the batch does not", async () => {
	let opened = 0;
	const view = await mount(h(SubAgentBar, { onOpen: () => void (opened += 1) }));
	assert.equal(view.text(), "", "nothing delegated, nothing to say");

	await roster([summary({ id: "a" })]);
	assert.equal(opened, 1, "work was delegated: the pane opens");

	// The roster is re-broadcast on every tool call of every sub-agent.
	await roster([summary({ id: "a", toolCalls: 3, lastActivity: "读取文件" })]);
	assert.equal(opened, 1, "a re-broadcast is not a new dispatch");

	await roster([summary({ id: "a", status: "done" })]);
	assert.equal(opened, 1, "finishing is not a dispatch either");

	await roster([summary({ id: "a", status: "done" }), summary({ id: "b" })]);
	assert.equal(opened, 2, "a later batch opens it again — the first was put away long ago");
	await view.unmount();
});

test("the bar carries the orchestration total, priced or not", async () => {
	const view = await mount(h(SubAgentBar, { onOpen: () => {} }));
	await roster([summary({ id: "a", status: "done", tokens: 2480, cost: 0.0087 }), summary({ id: "b", status: "done", tokens: 520, cost: 0.0018 })]);
	assert.match(view.text(), /2 个子 Agent 已结束/);
	assert.match(view.find("[data-sub-total]").textContent ?? "", /^3\.0k · \$0\.01$/, "the whole batch, added up");

	await roster([summary({ id: "a", status: "done", tokens: 2480 })]);
	const total = view.find("[data-sub-total]").textContent ?? "";
	assert.ok(!total.includes("$"), `no pricing, no dollar figure: ${total}`);
	await view.unmount();
});

test("卡在重连上的那个，条上说的是它在等什么", async () => {
	/*
	 * 之前这里只会显示最后一次工具调用。一个重连了 47 次的子代理，条上写的仍是半小时前那次读文件
	 * ——看的人据此判断「它在干活」，而它其实一直在等。整条链是 core 的 `retrying` 一路传到这里，
	 * 中间任何一段断掉都会让它退回那个样子，所以这里认的是文案，不是字段。
	 */
	const view = await mount(h(SubAgentBar, { onOpen: () => {} }));
	await roster([summary({ id: "审代码", toolCalls: 3, lastActivity: "读取文件", retrying: { attempt: 47, reason: "服务商返回了空回答" } })]);
	const tip = view.find("[data-ly-tip]").getAttribute("data-ly-tip") ?? "";

	/*
	 * 先把它收成 `done`，再断言。
	 *
	 * 这条线上只要还有 running 的，组件就开着一个每秒一跳的计时器；留着它退出测试，进程不会结束
	 * ——而这个文件跑的是 `--test-timeout=0`，于是不是红，是永远挂着。上面那条测试以 `done` 收尾
	 * 是同一个道理，只是没写出来。
	 */
	await roster([summary({ id: "审代码", status: "done" })]);

	assert.ok(tip.includes("47"), `说清等到第几次了：${tip}`);
	assert.ok(tip.includes("服务商返回了空回答"), `也说清在等什么：${tip}`);
	assert.ok(!tip.includes("读取文件"), `此刻它没在读文件，别再挂着那句：${tip}`);
});
