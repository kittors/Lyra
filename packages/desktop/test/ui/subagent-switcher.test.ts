/**
 * 子智能体面板顶上的切换器，和它打开的那张单子。
 *
 * 从前面板顶上是一排 tab、有了第二层派生就换成一棵树，下面再压一行挤成一团的读数。现在一个人
 * 一行半；不止一个时脸叠成一摞、点开是一张单子。挂起来测，因为验收的就是画出来的东西：一个的
 * 时候没有下拉、不止一个时正在看的那张脸在最上面、单子按派生树缩进、上级那一行记整枝的账、排队
 * 的点不进去。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createElement as h } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { SubAgentHeader } from "../../src/features/subagents/SubAgentHeader.tsx";
import { SubAgentMenu } from "../../src/features/subagents/SubAgentMenu.tsx";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { click, mount, press } from "../helpers/mount.ts";

function summary(over: Partial<SubAgentSummary> & { id: string; tokens?: number; cost?: number }): SubAgentSummary {
	const { tokens = 0, cost = 0, ...rest } = over;
	return {
		agent: "general",
		description: rest.id,
		status: "done",
		startedAt: 1000,
		endedAt: 2000,
		toolCalls: 0,
		depth: 1,
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
		...rest,
	};
}

const noop = () => {};

beforeEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
});

test("单子按派生树排：上级在前、下级缩进，上级那一行记的是整枝的账", async () => {
	const picked: string[] = [];
	const view = await mount(
		h(SubAgentMenu, {
			agents: [
				summary({ id: "other", tokens: 200, cost: 0.02, startedAt: 1800 }),
				summary({ id: "boss", agent: "orchestrator", tokens: 1000, cost: 0.1 }),
				summary({ id: "leaf", agent: "explore", parentId: "boss", depth: 2, tokens: 500, cost: 0.05, startedAt: 1500 }),
			],
			current: "leaf",
			sessionId: null,
			onPick: (id: string) => picked.push(id),
		}),
	);
	try {
		const rows = view.all<HTMLElement>("[data-sub-row]");
		assert.deepEqual(
			rows.map((row) => [row.dataset.subRow, row.dataset.subLevel]),
			[
				["boss", "1"],
				["leaf", "2"],
				["other", "1"],
			],
			"上级在它派出去的那几个前面，层级说的是谁派的",
		);
		const indent = (row: HTMLElement) => Number.parseFloat(row.style.paddingLeft || "0");
		assert.ok(indent(rows[1]) > indent(rows[0]), `下级往里缩：${indent(rows[1])} vs ${indent(rows[0])}`);
		assert.equal(indent(rows[2]), indent(rows[0]), "第二个根和第一个齐平");

		// 上级那一行是整枝的——派它出去一共花了多少——不是它自己那一份。
		assert.match(rows[0].querySelector("[data-sub-figures]")?.textContent ?? "", /1\.5k · \$0\.15/);
		assert.match(rows[0].querySelector("[data-sub-figures]")?.getAttribute("data-ly-tip") ?? "", /1\.0k · \$0\.10/, "它自己那一份放在提示里");
		assert.match(rows[1].querySelector("[data-sub-figures]")?.textContent ?? "", /500 · \$0\.05$/);
		assert.equal(view.all("[data-sub-total]").length, 0, "整批的合计不在这里——那笔钱进了这一轮的总数");

		assert.equal(rows[1].dataset.selected, "true");
		assert.equal(rows[1].querySelector("[role=menuitem]")?.getAttribute("aria-current"), "true");
		assert.equal(view.all("button[aria-label^='关闭'], button[aria-label^='停止并关闭']").length, 0, "不知道是哪个会话，就不画 ×");

		await click(rows[2].querySelector("[role=menuitem]") as HTMLElement);
		assert.deepEqual(picked, ["other"]);
	} finally {
		await view.unmount();
	}
});

test("不足一分钱写 <$0.01，没有价钱的只写 token——便宜不是免费，不知道也不是", async () => {
	const view = await mount(
		h(SubAgentMenu, {
			agents: [
				summary({ id: "a", tokens: 3000, cost: 0.02 }),
				summary({ id: "a1", parentId: "a", depth: 2, tokens: 520, cost: 0.0018 }),
				summary({ id: "b", tokens: 4000 }),
			],
			current: null,
			sessionId: null,
			onPick: noop,
		}),
	);
	try {
		const figures = view.all<HTMLElement>("[data-sub-row]").map((row) => row.querySelector("[data-sub-figures]")?.textContent ?? "");
		assert.match(figures[1], /520 · <\$0\.01$/);
		assert.match(figures[2], /4\.0k$/);
		assert.ok(!figures[2].includes("$"), `没有价钱就不编一个：${figures[2]}`);
	} finally {
		await view.unmount();
	}
});

test("排队的排在在跑的后面：灰着、说在排队、停得下；排队时底下一行说出闸门多宽，旁边就是去调它的地方", async () => {
	const { useApp } = await import("../../src/store/index.ts");
	const { DEFAULT_SETTINGS } = await import("@lyra/core");
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, maxConcurrentSubAgents: 1 } as never, meta: null });
	const view = await mount(
		h(SubAgentMenu, {
			agents: [summary({ id: "规划迁移", agent: "plan", status: "queued", startedAt: Date.now() - 1000 }), summary({ id: "找入口", status: "running", startedAt: Date.now() - 3000 })],
			current: "找入口",
			sessionId: "s",
			onPick: noop,
		}),
	);
	try {
		assert.match(view.find("[data-sub-menu-heading]").textContent ?? "", /2 个子 Agent · 1 个在跑 · 1 个排队中$/);
		assert.match(view.find("[data-sub-menu-cap]").textContent ?? "", /同时最多跑 1 个，排着的会依次开跑\s*调整/);
		assert.ok(view.find("[data-sub-menu-cap] [data-sub-menu-adjust]"), "旁边就是去调它的地方");
		const rows = view.all<HTMLElement>("[data-sub-row]");
		assert.deepEqual(rows.map((row) => row.dataset.subRow), ["找入口", "规划迁移"], "在跑的在前，排着的在后");
		const last = rows[1];
		assert.equal(last.dataset.subQueued, "true");
		assert.match(last.textContent ?? "", /规划迁移.*排队中.*@plan/);
		assert.equal(last.querySelector(".ly-avatar")?.getAttribute("data-mood"), "waiting");
		// 排着的也停得下：它已经在名单上了，× 拉的是同一根绳子。
		assert.equal(view.all("button[aria-label='停止并关闭 规划迁移']").length, 1);
		assert.equal(view.all("button[aria-label='停止并关闭 找入口']").length, 1);
	} finally {
		await view.unmount();
		useApp.setState({ settings: null });
	}
});

test("打开时焦点落在正在看的那一行，上下键在行之间走", async () => {
	const view = await mount(
		h(SubAgentMenu, {
			agents: [summary({ id: "一" }), summary({ id: "二", startedAt: 1100 }), summary({ id: "三", startedAt: 1200 })],
			current: "二",
			sessionId: null,
			onPick: noop,
		}),
	);
	try {
		const focused = () => (document.activeElement?.closest("[data-sub-row]") as HTMLElement | null)?.dataset.subRow;
		assert.equal(focused(), "二");
		await press(document.activeElement as HTMLElement, "ArrowDown");
		assert.equal(focused(), "三");
		await press(document.activeElement as HTMLElement, "ArrowDown");
		assert.equal(focused(), "一", "走到底再往下，回到第一行");
		await press(document.activeElement as HTMLElement, "ArrowUp");
		assert.equal(focused(), "三");
		await press(document.activeElement as HTMLElement, "Home");
		assert.equal(focused(), "一");
	} finally {
		await view.unmount();
	}
});

test("只有一个的时候：顶上不是按钮、没有下拉，读数一行写全", async () => {
	const one = summary({ id: "sub:1", description: "检查项目质量与工程规范", agent: "review", toolCalls: 12, tokens: 12_300, cost: 0.04 });
	const view = await mount(h(SubAgentHeader, { agent: one, agents: [one], sessionId: "s" }));
	try {
		assert.equal(view.all("[data-sub-switch]").length, 0, "没什么可选的");
		assert.equal(view.all("[data-avatar-pile]").length, 0);
		assert.equal(view.all("[aria-haspopup]").length, 0);
		assert.equal(view.find("[data-sub-title]").textContent, "检查项目质量与工程规范");
		const meta = view.find("[data-sub-meta]").textContent ?? "";
		assert.match(meta, /@review/);
		assert.match(meta, /已完成 · 1s/);
		assert.match(meta, /12 次调用/);
		assert.match(meta, /12\.3k · \$0\.04/);
		assert.equal(view.all("button[aria-label='停止这个子 Agent']").length, 0, "跑完的没什么可停的");
	} finally {
		await view.unmount();
	}
});

test("不止一个：脸叠成一摞、正在看的在最上面，点开单子换人", async () => {
	const agents = [summary({ id: "a", agent: "explore" }), summary({ id: "b", agent: "review", startedAt: 1100 }), summary({ id: "c", agent: "plan", startedAt: 1200 })];
	useSubAgents.setState({ focused: "b" });
	const view = await mount(h(SubAgentHeader, { agent: agents[1], agents, sessionId: "s" }));
	try {
		const faces = view.all<HTMLElement>("[data-pile-face]");
		// 后一张压在前一张上面：正在看的那张排在最后，压在最上面，紧挨着标题。
		assert.equal(faces.at(-1)?.dataset.pileFace, "b", "正在看的那张放在最后");
		const layers = faces.map((face) => Number(face.style.zIndex));
		assert.deepEqual(layers, [...layers].sort((x, y) => x - y), `一张压一张，层级依次升高：${layers}`);
		assert.ok(new Set(layers).size === layers.length, "没有两张在同一层");

		const trigger = view.find<HTMLButtonElement>("[data-sub-switch]");
		assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
		await click(trigger);
		assert.equal(trigger.getAttribute("aria-expanded"), "true");
		const menu = document.querySelector("[data-sub-menu]");
		assert.ok(menu, "单子开了");
		assert.equal(menu.querySelectorAll("[data-sub-row]").length, 3);

		await click(menu.querySelector("[data-sub-row='c'] [role=menuitem]") as HTMLElement);
		assert.equal(useSubAgents.getState().focused, "c", "点一行，面板翻到它那一页");
		assert.ok(!document.querySelector("[data-sub-menu]"), "换完人单子自己收起来");
	} finally {
		await view.unmount();
	}
});

test("在跑的：读数说它此刻在做什么，旁边有停止", async () => {
	const one = summary({ id: "sub:2", agent: "explore", status: "running", endedAt: undefined, startedAt: Date.now() - 5000, lastActivity: "读取 src/app.ts" });
	const view = await mount(h(SubAgentHeader, { agent: one, agents: [one], sessionId: "s" }));
	try {
		assert.match(view.find("[data-sub-doing]").textContent ?? "", /读取 src\/app\.ts/);
		assert.ok(!(view.find("[data-sub-meta]").textContent ?? "").includes("已完成"));
		assert.equal(view.all("button[aria-label='停止这个子 Agent']").length, 1);
	} finally {
		// 在跑的时候组件开着一个每秒一跳的钟，收成 done 再卸，免得这个文件挂着不退出。
		await view.rerender(h(SubAgentHeader, { agent: { ...one, status: "done", endedAt: Date.now() }, agents: [one], sessionId: "s" }));
		await view.unmount();
	}
});

test("一摞脸的层级：后一张压前一张，放不下时「+N」在最上面、正在看的那张一定露出来", async () => {
	const { AvatarPile } = await import("../../src/ui/avatar/AvatarPile.tsx");
	const face = (key: string) => ({ key, avatar: { shape: "circle" as const, color: "blue" as const }, seed: key });
	const view = await mount(h(AvatarPile, { faces: ["a", "b", "c", "d", "e"].map(face), max: 3, focus: "d" }));
	try {
		const coins = view.all<HTMLElement>("[data-pile-face], [data-pile-more]");
		assert.deepEqual(
			coins.map((coin) => coin.dataset.pileFace ?? coin.textContent),
			["a", "d", "+3"],
			"放不下五张：先让出别人的位置，正在看的 d 在，最后一格是 +3",
		);
		const layers = coins.map((coin) => Number(coin.style.zIndex));
		assert.deepEqual(layers, [1, 2, 3], "从左到右一张压一张，+3 在最上面——不会被盖成「-3」");
	} finally {
		await view.unmount();
	}
});
