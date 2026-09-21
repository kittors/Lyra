/**
 * 用量页上，一笔账是谁花的。
 *
 * 账按 `providerId` 记，名字只活在 `settings.providers` 里。删掉一个供应商，它花过的钱一分不少
 * 地留在日志里，页面上却只剩 `provider-mttnetnn` 这么一串——用户的原话是「这些不知道是啥」。
 *
 * 这里验三件在页面上才看得出来的事：认不出的 id 印成什么、被费用排序埋掉的用量还在不在、以及
 * 明细表里模型名旁边有没有厂牌。三件都属于「逻辑对、页面不对」那一类：聚合函数返回的数字全对，
 * 而屏幕上什么都读不出来。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import type { UsageBucket, UsageScan } from "../../electron/usage-scan.ts";
import { UsageSettings } from "../../src/features/settings/UsageSettings.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount, press, type Mounted } from "../helpers/mount.ts";

const TODAY = new Date();
const DAY = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

function bucket(provider: string, model: string, over: Partial<UsageBucket> = {}): UsageBucket {
	return {
		day: DAY,
		key: `${provider}/${model}`,
		provider,
		model,
		input: 1000,
		output: 100,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		cost: 1,
		inputCost: 0.9,
		outputCost: 0.1,
		cacheReadCost: 0,
		cacheWriteCost: 0,
		rawCost: 1,
		cacheSavings: 0,
		providerPricedTokens: 0,
		catalogPricedTokens: 1100,
		manualPricedTokens: 0,
		recordedPricedTokens: 0,
		unpricedTokens: 0,
		replies: 1,
		...over,
	};
}

/** 一个没有价格、却烧了不少 token 的供应商——本机上真有这么一个。 */
function unpriced(provider: string, model: string): UsageBucket {
	return bucket(provider, model, { cost: 0, inputCost: 0, outputCost: 0, rawCost: 0, catalogPricedTokens: 0, unpricedTokens: 1100, input: 2_200_000, output: 0 });
}

function scanOf(buckets: UsageBucket[]): UsageScan {
	return { days: [{ day: DAY, sessions: 1, messages: 2 }], buckets, scanned: 1, cached: 0, tookMs: 1 };
}

async function open(buckets: UsageBucket[], over: Partial<Settings> = {}): Promise<{ view: Mounted; saved: Settings[] }> {
	const saved: Settings[] = [];
	const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
	useApp.setState({ activeSessionId: "qa", meta: null, settings, capabilities: null });
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			usage: {
				scan: async () => scanOf(buckets),
				// 这一页底下还挂着「数据与存储」。它读不到会自己收起来，但不给的话这些测试会在
				// 别处炸出一句 unhandledRejection，跟它们问的事毫无关系。
				storage: async () => ({ bytes: 0, sessions: 0, earliest: null, latest: null, days: [] }),
			},
			settings: {
				save: async (next: Settings) => {
					saved.push(next);
					// 主进程会把保存后的设置发回来；不回灌的话页面永远显示旧名字。
					useApp.setState({ settings: next });
					return next;
				},
			},
		},
	});
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(UsageSettings) }));
	return { view, saved };
}

test("认不出的供应商印成短 id，而不是一串 `provider-` 开头的东西", async () => {
	// `provider-` 是每个自动生成的 id 都一样的六个字母，在一栏几十像素宽的位置上它挤掉的正是
	// 能区分两个供应商的那八位。
	const { view } = await open([bucket("provider-mttnetnn", "gemini-3.8-flash-high")]);
	try {
		const text = view.text();
		assert.match(text, /mttnetnn/, "认不出是谁的时候，id 也好过一片空白");
		assert.doesNotMatch(text, /provider-mttnetnn/, "前缀是噪音，不该占掉名字的位置");
		/*
		 * **不标「已删除」。**
		 *
		 * 那个标记说的是「这个供应商不在设置里了」，而看这一页的人不关心这件事：账是历史，
		 * 「供应商A 花了两百块」在它被删掉之后仍然是同一句话。区别只体现在字色上——一串 id 用
		 * 正文色印出来，读的人会以为那就是它的名字。
		 */
		assert.doesNotMatch(text, /已删除/);
	} finally {
		await view.unmount();
	}
});

test("档案里记着的名字，供应商删了也还印在账上", async () => {
	const { view } = await open([bucket("provider-mttnetnn", "gemini-3.8-flash-high")], {
		providerNames: { "provider-mttnetnn": "公司中转" },
	});
	try {
		assert.match(view.text(), /公司中转/);
		assert.doesNotMatch(view.text(), /mttnetnn/, "有名字了就不该再把 id 摆出来");
	} finally {
		await view.unmount();
	}
});

test("还配着的供应商用它现在的名字，而且不标已删除", async () => {
	const { view } = await open([bucket("provider-live", "gemini-3.8-flash-high")], {
		providers: [{ id: "provider-live", name: "在用的中转", baseUrl: "https://x.invalid", api: "openai-responses", apiKey: "", enabled: true, models: [] }],
	});
	try {
		assert.match(view.text(), /在用的中转/);
		assert.doesNotMatch(view.text(), /已删除/);
	} finally {
		await view.unmount();
	}
});

test("给认不出的供应商起个名字，写进档案而不碰供应商列表", async () => {
	const { view, saved } = await open([bucket("provider-mttnetnn", "gemini-3.8-flash-high")]);
	try {
		await click(view.find("[data-usage-provider='provider-mttnetnn']"));
		const input = view.find<HTMLInputElement>("input[aria-label]");
		// 用原生 setter 赋值，否则 React 的受控输入读不到这次改动。
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		setter?.call(input, "公司中转");
		await fire(input, new Event("input", { bubbles: true }));
		await press(input, "Enter");

		assert.equal(saved.length, 1, "起个名字要落盘，否则下次打开又回到那串 id");
		assert.deepEqual(saved[0].providerNames, { "provider-mttnetnn": "公司中转" });
		assert.deepEqual(saved[0].providers, [], "起名字动的是档案，不是把一个删掉的供应商加回配置里");
	} finally {
		await view.unmount();
	}
});

test("没有价格的供应商被排到榜外，用量仍然留在卡片上", async () => {
	/*
	 * 这张榜按费用排，所以一个查不到价的供应商永远垫底——哪怕它烧掉两百多万 token。卡片只显示
	 * 前三名，于是它在页面上等于不存在：用户看到的是「这个供应商一点用量都不显示」。
	 */
	const { view } = await open([
		bucket("p1", "m", { cost: 10 }),
		bucket("p2", "m", { cost: 8 }),
		bucket("p3", "m", { cost: 6 }),
		unpriced("provider-mtvmtyj6", "deepseek-flash"),
	]);
	try {
		const text = view.text();
		assert.match(text, /其余 1 个供应商/, "被截掉的那些至少要留下一行");
		assert.match(text, /2\.2M token/, "留下的这一行要说清它用掉了多少，而不只是说有东西被藏起来了");
	} finally {
		await view.unmount();
	}
});

test("明细表里，模型名左边有厂牌", async () => {
	// 一列长得几乎一样的字符串，而且窄到要截断——别处的模型名旁边一直有厂牌，唯独这张表没有。
	const { view } = await open([bucket("provider-mttnetnn", "gemini-3.8-flash-high")]);
	try {
		const marks = view.all("[data-usage-breakdown] svg");
		assert.ok(marks.length > 0, "gemini 有官方厂牌，这一行该画出来");
	} finally {
		await view.unmount();
	}
});
