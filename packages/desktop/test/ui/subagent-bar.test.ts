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
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [], settled: {} });
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

test("整批的合计不在这条线上——那笔钱已经进了这一轮的总数", async () => {
	/*
	 * 这条曾经反着断言：条上要挂一个「本次编排合计」，作为铺开子代理的刹车。刹车装错了地方——
	 * 子代理烧的 token 现在直接进运行指示器那个数（见 `store/apply-event.ts`），同一笔钱在屏幕上
	 * 写两遍，口径但凡差一点就没人知道该信哪个。
	 *
	 * 留着反过来守，是因为「再加回去」是个太自然的念头。
	 */
	const view = await mount(h(SubAgentBar, { onOpen: () => {} }));
	await roster([summary({ id: "a", status: "done", endedAt: Date.now(), tokens: 2480, cost: 0.0087 }), summary({ id: "b", status: "done", endedAt: Date.now(), tokens: 520, cost: 0.0018 })]);
	assert.match(view.text(), /2 个子 Agent 已结束/);
	assert.equal(view.all("[data-sub-total]").length, 0, "条上不该再有整批合计");
	assert.ok(!view.text().includes("$0.01"), `也不该有它的钱数：${view.text()}`);
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
	const tip = view.find("[data-ly-subagent-bar]").getAttribute("data-ly-tip") ?? "";
	// 只有一个的时候，这一行本身就是它：条上直接写着它在等什么。
	const line = view.find("[data-ly-subagent-bar]").textContent ?? "";

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
	assert.ok(line.includes("47") && line.includes("服务商返回了空回答"), `条上也说清在等什么：${line}`);
	assert.ok(!line.includes("读取文件"), `条上也别挂着那句：${line}`);
});

test("派出去四个、闸门只放了一个：条上四张脸叠成一摞，另外三个说在排队", async () => {
	/*
	 * 排着的三个从派出去那一刻就在名单上（`queued`）——从前要等轮到它们才登记，界面只好从对话里的
	 * 工具调用倒推，而那条推算在人插话、主智能体不再等它们之后就断了。
	 */
	let opened = 0;
	const view = await mount(h(SubAgentBar, { onOpen: () => void (opened += 1) }));
	const started = Date.now() - 2000;
	const four = [
		summary({ id: "sub:1", description: "找登录入口", startedAt: started + 50 }),
		summary({ id: "sub:2", description: "审一遍鉴权", agent: "simple", status: "queued", startedAt: started + 60 }),
		summary({ id: "sub:3", description: "规划迁移", agent: "reason", status: "queued", startedAt: started + 70 }),
		summary({ id: "sub:4", description: "整理文档", agent: "plan", status: "queued", startedAt: started + 80 }),
	];
	try {
		await roster(four);
		opened = 0;
		const moods = view.all<HTMLElement>("[data-pile-face] .ly-avatar").map((face) => face.dataset.mood);
		assert.deepEqual(moods, ["working", "waiting", "waiting", "waiting"], "在跑的在前，排着的三个跟在后面");
		assert.match(view.find("[data-ly-subagent-bar]").textContent ?? "", /找登录入口\s*· 3 个排队中/);
		assert.equal(view.all('[aria-label="清掉已结束的子 Agent 记录"]').length, 0, "没有那颗叉了：说完了它自己收起来");
		// 不止一个：点这一行是一张单子——谁在干什么、谁在排队——点在跑的那一行，面板翻到它那一页。
		const bar = view.find<HTMLButtonElement>("[data-ly-subagent-bar]");
		assert.equal(bar.getAttribute("aria-haspopup"), "menu");
		await act(async () => {
			bar.click();
		});
		const menu = document.querySelector("[data-sub-menu]");
		assert.ok(menu, "单子开了");
		assert.equal(menu.querySelectorAll("[data-sub-row]").length, 4, "排着的也在名单上");
		assert.equal(menu.querySelectorAll("[data-sub-queued]").length, 3);
		await act(async () => {
			(menu.querySelector('[data-sub-row="sub:1"] [role=menuitem]') as HTMLButtonElement).click();
		});
		assert.equal(useSubAgents.getState().focused, "sub:1");
		assert.equal(opened, 1, "选中之后面板打开");
		assert.ok(!document.querySelector("[data-sub-menu]"), "单子收起来");
	} finally {
		await roster(four.map((one) => ({ ...one, status: "done" as const, endedAt: Date.now() })));
		await view.unmount();
	}
});

test("都结束了、主智能体也把结果用上了（这一轮收尾），这一行自己收起来；记录还在", async () => {
	const { useApp } = await import("../../src/store/index.ts");
	useApp.setState({ activeSessionId: "s1" });
	const view = await mount(h(SubAgentBar, { onOpen: () => {} }));
	try {
		await act(async () => {
			useSubAgents.getState().sync([summary({ id: "a" })], "s1");
		});
		const shell = () => view.find<HTMLElement>(".ly-reveal");
		assert.equal(shell().dataset.open, "true");

		await act(async () => {
			useSubAgents.getState().sync([summary({ id: "a", status: "done", endedAt: Date.now() - 10 })], "s1");
		});
		assert.equal(shell().dataset.open, "true", "结束了，但主智能体还没用上它的结果——这一行还得说");

		await act(async () => {
			useSubAgents.getState().settle("s1");
		});
		assert.equal(shell().dataset.open, "false", "这一轮收尾了，这一行收起来");
		assert.equal(useSubAgents.getState().agents.length, 1, "记录没丢：对话里的派发卡片一点，面板照样翻到它");

		// 后台跑完、结果刚送回去的那个，主智能体还在用——在收尾之后结束的，这一行重新说它。
		await act(async () => {
			useSubAgents.getState().sync([summary({ id: "a", status: "done", endedAt: Date.now() - 10 }), summary({ id: "b", status: "done", endedAt: Date.now() + 5 })], "s1");
		});
		assert.equal(shell().dataset.open, "true");
		assert.match(view.find("[data-ly-subagent-bar]").textContent ?? "", /b/);
	} finally {
		await view.unmount();
		useSubAgents.setState({ settled: {} });
	}
});
