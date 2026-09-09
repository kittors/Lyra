/** Real Electron verification for the usage dashboard and offline model catalogue controls. */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { catalogModelFor } from "@lyra/core/model-catalog";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

interface ReplyFixture {
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total: number; source?: "provider" };
}

function reply(seq: number, at: number, fixture: ReplyFixture): string {
	const usage = {
		input: fixture.input,
		output: fixture.output,
		cacheRead: fixture.cacheRead,
		cacheWrite: fixture.cacheWrite,
		reasoning: fixture.reasoning,
		total: fixture.input + fixture.output + fixture.cacheRead + fixture.cacheWrite,
		cost: fixture.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const message = {
		role: "assistant",
		content: [{ type: "text", text: "usage fixture" }],
		api: "openai-responses",
		provider: fixture.provider,
		model: fixture.model,
		usage,
		stopReason: "stop",
		timestamp: at,
	};
	return `${JSON.stringify({ seq, ts: at, type: "message", message })}\n`;
}

function configuredModel(providerId: string, modelId: string, name: string) {
	return {
		id: `${providerId}/${modelId}`,
		providerId,
		modelId,
		name,
		contextWindow: 200_000,
		maxOutputTokens: 16_384,
		supportsThinking: true,
		supportsImages: true,
		supportsTools: true,
		pricing: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375, source: "manual" },
	};
}

function fixtureFor(index: number, tokens: number): ReplyFixture {
	const output = Math.round(tokens * 0.08);
	const cacheRead = Math.round(tokens * 0.68);
	const cacheWrite = Math.round(tokens * 0.06);
	const input = tokens - output - cacheRead - cacheWrite;
	switch (index % 5) {
		case 0:
			return { provider: "relay", model: "gemini-3-0", input, output, cacheRead, cacheWrite, reasoning: Math.round(output / 3) };
		case 1:
			return {
				provider: "house",
				model: "claude-0",
				input,
				output,
				cacheRead,
				cacheWrite,
				reasoning: Math.round(output / 4),
				cost: { input: 0.003, output: 0.004, cacheRead: 0.001, cacheWrite: 0.002, total: 0.01, source: "provider" },
			};
		case 2:
			return { provider: "openai", model: "gpt-5.2", input, output, cacheRead, cacheWrite, reasoning: Math.round(output / 2) };
		case 3:
			return { provider: "legacy", model: "retired-model", input, output, cacheRead, cacheWrite, reasoning: 0, cost: { total: 0.006 } };
		default:
			return { provider: "unknown", model: "unpriced-model", input, output, cacheRead, cacheWrite, reasoning: 0 };
	}
}

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
	const day = 24 * 60 * 60 * 1000;
	for (let session = 0; session < 40; session++) {
		const projectId = `usage${session}`.padEnd(16, "0");
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines: string[] = [];
		for (let daysAgo = 29; daysAgo >= 10; daysAgo--) {
			const at = Date.now() - daysAgo * day;
			for (let turn = 0; turn < 90; turn++) {
				const tokens = 4_000 + ((daysAgo * 7_919 + session * 104_729 + turn * 31) % 46_000);
				lines.push(reply(lines.length + 1, at, fixtureFor(daysAgo + session + turn, tokens)));
			}
		}
		await writeFile(join(home, "sessions", projectId, `session-${session}.jsonl`), lines.join(""));
	}
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [
			{ id: "relay", name: "Relay", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "x", enabled: true, models: [configuredModel("relay", "gemini-3-0", "Gemini 3")] },
			{ id: "house", name: "Claude Team", baseUrl: "https://relay.example/v1", api: "anthropic-messages", apiKey: "y", enabled: true, models: [configuredModel("house", "claude-0", "Claude") ] },
			{ id: "openai", name: "OpenAI 官方", baseUrl: "https://api.openai.com/v1", api: "openai-responses", apiKey: "z", enabled: true, models: [] },
		],
		mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: "relay/gemini-3-0",
		permissionMode: "auto",
		thinking: "medium",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
		sync: { enabled: false, port: 4517, token: null },
	}));
}

before(async () => {
	app = await startApp({ port: 9711, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});

after(async () => {
	await app?.stop();
});

afterEach(async (context) => {
	if (context.passed) return;
	await shot("usage-dashboard-failure");
	context.diagnostic(await app.evaluate<string>("document.body.innerText.slice(-5000)"));
});

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
}

const UI = `
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const label = (element) => element.innerText.replace(/\\s+/g, " ").trim();
	const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const byText = (selector, text) => [...document.querySelectorAll(selector)].find((element) => element.checkVisibility({ visibilityProperty: true }) && label(element) === text);
	const heatmap = () => {
		const scroller = [...document.querySelectorAll("div")].find((d) => d.className.includes("justify-content:safe_center"));
		if (!scroller) throw new Error("heatmap scroller not found");
		return scroller;
	};
	const heatmapBox = () => {
		const scroller = heatmap(), outer = scroller.getBoundingClientRect(), inner = scroller.firstElementChild.getBoundingClientRect();
		return { left: inner.left - outer.left, right: outer.right - inner.right, card: outer.width,
			grid: inner.width, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
			scrollLeft: scroller.scrollLeft, justify: getComputedStyle(scroller).justifyContent };
	};
	const typeValue = (input, value) => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
		setter.call(input, value);
		input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
	};
	const openUsage = async () => {
		click(document.querySelector(".ly-sidebar-foot button"));
		await wait(500);
		const nav = byText("nav button", "使用统计");
		if (!nav) throw new Error("no 使用统计 nav item");
		return nav;
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

test("the dashboard paints a skeleton, then shows priced, cached and unpriced usage", async () => {
	const seen = await ui<{ frames: number; sawSkeleton: boolean; landed: boolean; text: string; paths: number; overflow: number; chartHeight: number; metricColumns: number }>(`
		click(await openUsage());
		let frames = 0;
		let sawSkeleton = false;
		let landed = false;
		/*
		 * 等到它读完，按秒数算，不按帧数算。
		 *
		 * 这里原本是「五百帧还没画出来就算了」。五百帧读起来像很多，其实是八秒出头——而这一屏
		 * 要把四十个会话、七万二千条记录整个扫一遍才有读数，本机空着的时候正好是八秒半，刚刚
		 * 好落在外面。更糟的是帧数根本不等于时间：窗口被别的窗口盖住时 requestAnimationFrame
		 * 会降频，五百帧能拖上半分钟，于是同一份代码在同一台机器上时红时绿。
		 *
		 * 这条断言要的是「先骨架、后读数」，不是「八秒内读完」——性能是另一回事，不该在这里
		 * 借着一个凑出来的帧数上限偷偷断言。上限留三十秒：够慢的机器读完，也仍在 CDP 那一次
		 * 调用的四十秒之内。
		 */
		const deadline = performance.now() + 30_000;
		await new Promise((resolve) => {
			const step = () => {
				frames += 1;
				if (document.querySelector('[aria-busy="true"]')) sawSkeleton = true;
				landed = Boolean(document.querySelector('[data-usage-dashboard="true"]'));
				if (landed || performance.now() > deadline) resolve(); else requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
		const chart = document.querySelector('[data-usage-chart="cost"]');
		const metrics = document.querySelector('[aria-label="用量指标"]');
		const metricRows = new Set([...metrics.children].map((element) => Math.round(element.getBoundingClientRect().top)));
		return {
			frames,
			sawSkeleton,
			landed,
			text: document.querySelector('[data-usage-dashboard="true"]')?.innerText || "",
			// 一个供应商一条曲线。面积那条 path 没有 stroke，所以数出来的正好是线本身。
			paths: chart?.querySelectorAll("path[stroke]").length || 0,
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			chartHeight: Math.round(chart?.getBoundingClientRect().height || 0),
			metricColumns: Math.max(1, Math.ceil(metrics.children.length / metricRows.size)),
		};
	`);

	assert.ok(seen.landed, JSON.stringify(seen));
	assert.ok(seen.sawSkeleton, `no skeleton across ${seen.frames} painted frames`);
	assert.match(seen.text, /估算费用/);
	assert.match(seen.text, /缓存写入/);
	assert.match(seen.text, /推理/);
	assert.match(seen.text, /离线目录/);
	assert.match(seen.text, /未计价/);
	assert.ok(seen.paths >= 4, JSON.stringify(seen));
	assert.ok(seen.chartHeight >= 150, JSON.stringify(seen));
	assert.equal(seen.metricColumns, 5, JSON.stringify(seen));
	assert.ok(seen.overflow <= 0, JSON.stringify(seen));
	await shot("usage-dashboard-1440x900");
});

test("range, metric, breakdown and refresh controls update without blanking the page", async () => {
	const result = await ui<{ emptyText: string; tokenChart: boolean; dayRows: boolean; refreshed: boolean; remained: boolean }>(`
		/*
		 * 先等这一屏自己站住。
		 *
		 * 上一条把页面留在使用统计上，可留下的可能还是「正在读取会话日志」：区间那一排按钮在读
		 * 之前就画出来了，「费用／Token」和明细的切换却要等读完才有。这里从前一进来就点，于是
		 * 机器一忙，点的就是 undefined——报的错是 dispatchEvent 读不到，跟这条测的东西毫无
		 * 关系。等的是后面真要点的那个按钮本人。
		 */
		for (let index = 0; index < 400 && !byText("button", "Token"); index++) await wait(50);
		/*
		 * 换完区间等这一屏停下来，不是等一个写死的三百毫秒。
		 *
		 * 这些读数现在是走过去的，不是被换掉的——同一笔账换个时段问，中间那半秒的移动本身就在说
		 * 「这是同一个数，只是问的时段变了」。补间跑 520 毫秒（useCountUp 里的 TRAVEL_MS），而
		 * 且现在往下也走：换到 7 天，「已处理 Token」要从 623M 一路走回 0。等 300 毫秒读到的是
		 * 半路上的 3.1M，断言问的却是终点的 0——测的成了补间跑多快，不是这一屏答得对不对。
		 */
		const settled = async () => {
			let last = null;
			for (let index = 0; index < 80; index++) {
				await wait(50);
				const now = document.querySelector('[data-usage-dashboard="true"]')?.innerText || "";
				if (now === last) return now;
				last = now;
			}
			return last || "";
		};
		const seven = byText("button", "7 天");
		click(seven);
		const emptyText = await settled();
		click(byText("button", "30 天"));
		await settled();
		click(byText("button", "Token"));
		await wait(100);
		const tokenChart = Boolean(document.querySelector('[data-usage-chart="tokens"]'));
		click(byText("button", "日期"));
		await wait(100);
		const dayRows = /2026\\/\\d+\\/\\d+/.test(document.querySelector('[data-usage-dashboard="true"]')?.innerText || "");
		const refresh = document.querySelector('button[aria-label="刷新用量统计"]');
		click(refresh);
		for (let index = 0; index < 100 && refresh.disabled; index++) await wait(20);
		return {
			emptyText,
			tokenChart,
			dayRows,
			refreshed: !refresh.disabled,
			remained: Boolean(document.querySelector('[data-usage-dashboard="true"]')),
		};
	`);

	assert.match(result.emptyText, /暂无价格/);
	assert.match(result.emptyText, /已处理 Token\s*0/);
	assert.match(result.emptyText, /这个区间没有趋势数据/);
	assert.doesNotMatch(result.emptyText, /—/);
	assert.ok(result.tokenChart, JSON.stringify(result));
	assert.ok(result.dayRows, JSON.stringify(result));
	assert.ok(result.refreshed, JSON.stringify(result));
	assert.ok(result.remained, JSON.stringify(result));
});

/*
 * 曲线本身、图例那个开关，以及换口径时那条线是不是自己走过去的。
 *
 * 三件都是只能在真窗口里问的事。曲线画到哪里由浏览器的路径求值说了算——这里用 `getPointAtLength`
 * 让它自己报，而不是在测试里把我们算它的那套公式再写一遍；补间有没有跑，只有逐帧看那条 `d` 才
 * 知道，采样会漏掉、等一会儿再看则永远只看得到终点，而终点在有没有动画时是同一个。
 */
test("趋势图画的是曲线，图例是开关，换口径时那条线自己走过去", async (t) => {
	const seen = await ui<{
		curved: boolean;
		baseline: number;
		lowest: number;
		shapes: number;
		pressedBefore: string | null;
		pressedAfter: string | null;
		opacityAfter: number;
		axisMoved: boolean;
		railMoved: boolean;
	}>(`
		click(byText("button", "费用"));
		await wait(400);

		const svg = () => document.querySelector('[data-usage-chart] svg');
		const line = () => svg().querySelector('path[stroke]');

		// 折线全是直线段；三次贝塞尔是曲线独有的。
		const curved = /C/.test(line().getAttribute("d"));

		/*
		 * 曲线有没有跑到 0 底下。
		 *
		 * 最下面那条网格线就是 0，而用量不会是负的——一条平滑曲线在一个尖峰旁边冲下去，画出来
		 * 就是那一段钻到横轴底下，读出来是一天负的花费。
		 */
		const baseline = Math.max(...[...svg().querySelectorAll("line")].map((element) => Number(element.getAttribute("y1"))));
		let lowest = -Infinity;
		for (const path of svg().querySelectorAll('path[stroke]')) {
			const length = path.getTotalLength();
			for (let i = 0; i <= 120; i++) lowest = Math.max(lowest, path.getPointAtLength((length * i) / 120).y);
		}

		/*
		 * 图例：点一下关掉那条线，纵轴按剩下的重新分配。
		 *
		 * 在费用这一侧点，因为这批 fixture 里每个供应商的 token 都是 125M——关掉一个，token 的
		 * 最大值纹丝不动，纵轴当然也就不动，而那不能算这件事没做。费用差得很开（$645 对 $144），
		 * 关掉最大的那个，刻度必须跟着重画。
		 */
		const legend = document.querySelector("[data-usage-legend]");
		const id = legend.dataset.usageLegend;
		const pressedBefore = legend.getAttribute("aria-pressed");
		const axisBefore = [...svg().querySelectorAll("text")].map((element) => element.textContent).join("|");
		click(legend);
		await wait(500);
		const group = svg().querySelector('[data-usage-trend="' + id + '"]');
		const axisAfter = [...svg().querySelectorAll("text")].map((element) => element.textContent).join("|");
		const pressedAfter = legend.getAttribute("aria-pressed");
		const opacityAfter = Number(getComputedStyle(group).opacity);
		click(legend);
		await wait(400);

		// 换口径，逐帧记这条线：补间跑过就会留下一串互不相同的中间形状。
		const rail = () => byText("button", "Token").parentElement.querySelector("[data-segment-rail]");
		const railBefore = rail()?.style.transform ?? "";
		const shapes = [];
		click(byText("button", "Token"));
		await new Promise((resolve) => {
			let frames = 0;
			const step = () => {
				shapes.push(line().getAttribute("d"));
				if (++frames < 28) requestAnimationFrame(step);
				else resolve();
			};
			requestAnimationFrame(step);
		});
		await wait(300);
		const railAfter = rail()?.style.transform ?? "";

		/*
		 * 就停在 Token 上，因为进来的时候就是 Token。
		 *
		 * 这一串测试共用一个窗口，后面那条量窄屏的直接按 tokens 找那张图；把口径「还原」成费用，
		 * 它就拿到一个 null。开头切到费用是这条自己要的——关掉一个供应商能不能让纵轴动，只有在
		 * 费用那侧才问得出来——所以还的时候要还成借的样子。
		 */
		return {
			curved,
			baseline,
			lowest,
			shapes: new Set(shapes).size,
			pressedBefore,
			pressedAfter,
			opacityAfter,
			axisMoved: axisBefore !== axisAfter,
			railMoved: railBefore !== railAfter && railAfter !== "",
		};
	`);

	t.diagnostic(JSON.stringify(seen));
	assert.ok(seen.curved, `画的是曲线而不是折线：${JSON.stringify(seen)}`);
	assert.ok(seen.lowest <= seen.baseline + 0.5, `曲线钻到了 0 底下：${JSON.stringify(seen)}`);
	// 三个以上互不相同的中间形状：一帧到位的切换只会留下两种（切之前和切之后）。
	assert.ok(seen.shapes >= 3, `换口径时那条线是跳过去的，不是走过去的：${JSON.stringify(seen)}`);
	assert.equal(seen.pressedBefore, "true");
	assert.equal(seen.pressedAfter, "false", `点图例要真的关掉它：${JSON.stringify(seen)}`);
	assert.equal(seen.opacityAfter, 0, `关掉的那条线要从图上退掉：${JSON.stringify(seen)}`);
	assert.ok(seen.axisMoved, `关掉一个供应商之后纵轴要按剩下的重新分配：${JSON.stringify(seen)}`);
	assert.ok(seen.railMoved, `分段控件那块底要滑到新的位置：${JSON.stringify(seen)}`);
	await shot("usage-trend-curve");
});

test("the dashboard reflows in a narrow desktop window without horizontal overflow", async () => {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const geometry = await app.evaluate<{ overflow: number; dashboard: number; chart: number; metricColumns: number }>(`(() => {
		const dashboard = document.querySelector('[data-usage-dashboard="true"]');
		const chart = document.querySelector('[data-usage-chart="tokens"]');
		const metrics = document.querySelector('[aria-label="用量指标"]');
		const children = [...metrics.children];
		const tops = new Set(children.map((element) => Math.round(element.getBoundingClientRect().top)));
		return {
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			dashboard: Math.round(dashboard.getBoundingClientRect().width),
			chart: Math.round(chart.getBoundingClientRect().width),
			metricColumns: Math.max(1, Math.ceil(children.length / tops.size)),
		};
	})()`);
	assert.ok(geometry.overflow <= 0, JSON.stringify(geometry));
	assert.ok(geometry.dashboard > 300 && geometry.dashboard <= 760, JSON.stringify(geometry));
	assert.ok(geometry.chart > 280 && geometry.chart <= geometry.dashboard, JSON.stringify(geometry));
	assert.equal(geometry.metricColumns, 2, JSON.stringify(geometry));
	await shot("usage-dashboard-760x900");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});

interface HeatmapBox {
	left: number;
	right: number;
	card: number;
	grid: number;
	scrollWidth: number;
	clientWidth: number;
	scrollLeft: number;
	justify: string;
}

test("the heatmap centres when it fits and keeps both ends reachable when narrow", async (t) => {
	const viewport = await app.evaluate<{ width: number; height: number }>("({ width: innerWidth, height: innerHeight })");
	try {
		// A requested native window size can be clamped to the CI display; set the layout viewport.
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		const wide = await ui<HeatmapBox>(`
			const all = [...document.querySelectorAll("button")].find((b) => label(b) === "全部");
			click(all);
			await new Promise(requestAnimationFrame);
			heatmap().scrollIntoView({ block: "center" });
			return heatmapBox();
		`);
		assert.match(wide.justify, /safe center/);
		assert.ok(wide.card > wide.grid, `the wide card fits the grid: ${JSON.stringify(wide)}`);
		assert.ok(Math.abs(wide.left - wide.right) <= 2, `equal margins: ${JSON.stringify(wide)}`);
		assert.ok(wide.left > 0);
		await shot("heatmap-wide");

		await app.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
		const recent = await ui<HeatmapBox>(`
			heatmap().scrollLeft = 0;
			heatmap().scrollIntoView({ block: "center" });
			await new Promise(requestAnimationFrame);
			return heatmapBox();
		`);
		assert.ok(recent.scrollWidth > recent.clientWidth, `the narrow card scrolls: ${JSON.stringify(recent)}`);
		assert.ok(Math.abs(recent.right) <= 1 && recent.left < 0, `the recent end starts visible: ${JSON.stringify(recent)}`);
		await shot("heatmap-narrow-recent");

		const oldest = await ui<HeatmapBox>(`
			heatmap().scrollLeft = -heatmap().scrollWidth;
			await new Promise(requestAnimationFrame);
			return heatmapBox();
		`);
		assert.ok(oldest.scrollLeft < 0 && Math.abs(oldest.left) <= 1, `the oldest end remains reachable: ${JSON.stringify(oldest)}`);
		await shot("heatmap-narrow-oldest");
		t.diagnostic(JSON.stringify({ wide, recent, oldest }));
	} finally {
		await app.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
	}
});

interface Reading {
	shown: boolean;
	text: string;
	inBody: boolean;
	visible: boolean;
	zIndex: string;
	cursor: number;
	tip: { left: number; top: number; right: number; bottom: number };
	chart: { top: number; bottom: number };
	crosshair: number;
	viewport: { width: number; height: number };
	legacyTip: boolean;
	/** What the pointer actually landed on, so a miss says why rather than just "no bubble". */
	hit: string;
	at: [number, number];
}

/** Read the chart with a real mouse, at a fraction of the plot's width and height. */
async function hoverChart(share: number, height = 0.3): Promise<Reading> {
	const box = await app.evaluate<{ left: number; top: number; width: number; height: number }>(`(() => {
		const svg = document.querySelector('[data-usage-chart="cost"] svg');
		const r = svg.getBoundingClientRect();
		return { left: r.left, top: r.top, width: r.width, height: r.height };
	})()`);
	const x = Math.round(box.left + box.width * share);
	const y = Math.round(box.top + box.height * height);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" });
	// Two frames: one for the pointer's state update, one for the layout effect that places the bubble.
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const read = () => app.evaluate<Reading>(`(() => {
		const tip = document.querySelector('[data-chart-tip]');
		const line = document.querySelector('[data-chart-cursor] line');
		const rect = tip ? tip.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
		const svg = document.querySelector('[data-usage-chart="cost"] svg').getBoundingClientRect();
		const legacy = document.querySelector('.ly-tooltip');
		return {
			chart: { top: svg.top, bottom: svg.bottom },
			shown: Boolean(tip),
			text: tip ? tip.innerText.replace(/\\s+/g, " ").trim() : "",
			inBody: tip ? tip.parentElement === document.body : false,
			visible: tip ? tip.checkVisibility({ visibilityProperty: true }) : false,
			zIndex: tip ? getComputedStyle(tip).zIndex : "",
			cursor: document.querySelectorAll('[data-chart-cursor] circle').length,
			tip: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
			crosshair: line ? line.getBoundingClientRect().left : -1,
			viewport: { width: innerWidth, height: innerHeight },
			legacyTip: Boolean(legacy) && !legacy.hidden,
			hit: (document.elementFromPoint(${x}, ${y})?.tagName || "none") + " " + (document.elementFromPoint(${x}, ${y})?.className?.baseVal ?? document.elementFromPoint(${x}, ${y})?.className ?? "").toString().slice(0, 60),
			at: [${x}, ${y}],
		};
	})()`);

	const first = await read();
	if (first.shown) return first;
	/*
	 * One retry, because the window sits at the desktop's origin: a real hand moving a real mouse
	 * across it delivers its own pointermove, and the last one wins. A reading that is genuinely
	 * broken is broken twice.
	 */
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	return read();
}

function onScreen(reading: Reading): boolean {
	const { tip, viewport } = reading;
	return tip.left >= 0 && tip.top >= 0 && tip.right <= viewport.width && tip.bottom <= viewport.height && tip.right > tip.left && tip.bottom > tip.top;
}

/** The bubble annotates the crosshair; sitting on top of it hides the marks being read. */
function clearOfCrosshair(reading: Reading): boolean {
	return reading.tip.left >= reading.crosshair || reading.tip.right <= reading.crosshair;
}

/** Over the chart and nothing else: the legend and the 费用/Token switch sit just above it. */
function overThePlot(reading: Reading): boolean {
	return reading.tip.top >= reading.chart.top - 1 && reading.tip.bottom <= reading.chart.bottom + 1;
}

test("the trend chart answers a real pointer anywhere in the plot, and the reading escapes the card that clips it", async (t) => {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
	await ui(`
		if (!document.querySelector('[data-usage-chart]')) {
			click(await openUsage());
			await wait(800);
		}
		click(byText("button", "30 天"));
		await wait(400);
		click(byText("button", "费用"));
		await wait(200);
		const chart = document.querySelector('[data-usage-chart="cost"]');
		const pane = [...document.querySelectorAll("div")].find((el) => el.scrollHeight > el.clientHeight + 40 && el.contains(chart));
		if (pane) pane.scrollTop = 0;
		await wait(200);
	`);

	// Empty space in the upper half of the plot, nowhere near a line: this is the case that did nothing before.
	const middle = await hoverChart(0.5, 0.2);
	assert.ok(middle.shown, `hovering the plot must read the day: ${JSON.stringify(middle)}`);
	assert.match(middle.text, /\d{4}\/\d+\/\d+ 周./, JSON.stringify(middle));
	assert.match(middle.text, /Relay/, JSON.stringify(middle));
	assert.match(middle.text, /合计/, JSON.stringify(middle));
	assert.ok(middle.inBody, "the bubble must be portalled to the body, or the overflow-hidden card cuts it off");
	assert.ok(middle.visible, JSON.stringify(middle));
	assert.equal(middle.zIndex, "200", "the same layer as the app's own tooltips");
	assert.ok(middle.cursor > 0, `the crosshair marks the day being read: ${JSON.stringify(middle)}`);
	assert.ok(onScreen(middle), JSON.stringify(middle));
	assert.ok(overThePlot(middle), `pointing near the top must not push the bubble over the legend: ${JSON.stringify(middle)}`);
	assert.ok(!middle.legacyTip, "the old per-point tooltip must not fire as well");
	await shot("usage-trend-hover-middle");

	// The most recent day: hard against the card's right edge, which is where the window's edge is too.
	const last = await hoverChart(1, 0.5);
	assert.ok(last.shown, JSON.stringify(last));
	assert.ok(onScreen(last), `the bubble stays on screen at the right edge: ${JSON.stringify(last)}`);
	assert.ok(clearOfCrosshair(last), JSON.stringify(last));
	await shot("usage-trend-hover-last");

	// The oldest day, in the axis gutter, where there is room on the right.
	const first = await hoverChart(0, 0.8);
	assert.ok(first.shown && onScreen(first), JSON.stringify(first));
	assert.ok(first.tip.left > first.crosshair, `it stays clear of the line: ${JSON.stringify(first)}`);
	assert.ok(overThePlot(first), `pointing near the bottom must not hang the bubble below the card: ${JSON.stringify(first)}`);
	assert.notEqual(first.text, last.text, "different days must read differently");
	t.diagnostic(JSON.stringify({ middle: middle.text, last: last.text, first: first.text }));

	// Away from the chart, the reading goes.
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 20, buttons: 0, pointerType: "mouse" });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	assert.equal(await app.evaluate<boolean>("Boolean(document.querySelector('[data-chart-tip]'))"), false, "the bubble must leave with the pointer");

	// Ninety columns rather than thirty: a few pixels apart, and each still has to resolve to one day.
	await ui(`click(byText("button", "90 天")); await wait(500);`);
	const dense = await hoverChart(0.5, 0.5);
	assert.ok(dense.shown && onScreen(dense) && overThePlot(dense), `a dense range reads the same way: ${JSON.stringify(dense)}`);
	assert.match(dense.text, /\d{4}\/\d+\/\d+ 周./, JSON.stringify(dense));
	const along = await hoverChart(0.6, 0.5);
	assert.notEqual(along.text, dense.text, "moving across the plot must move through days, not stick on one");
	await ui(`click(byText("button", "30 天")); await wait(400);`);

	// TEMP light-theme look
	await app.evaluate(`(() => { document.documentElement.classList.remove("dark"); return true; })()`);
	await hoverChart(0.45, 0.4);
	await shot("usage-trend-hover-light");
	await app.evaluate(`(() => { document.documentElement.classList.add("dark"); return true; })()`);
});

test("the reading stays inside a narrow window and does not survive a scroll", async () => {
	try {
		await app.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 640, deviceScaleFactor: 1, mobile: false });
		await ui(`document.querySelector('[data-usage-chart="cost"]').scrollIntoView({ block: "end" }); await wait(200);`);

		let rightmost: Reading | null = null;
		for (const share of [0, 0.5, 1]) {
			const reading = await hoverChart(share, 0.9);
			assert.ok(reading.shown, `share ${share}: ${JSON.stringify(reading)}`);
			assert.ok(onScreen(reading), `share ${share} must stay within 760x640: ${JSON.stringify(reading)}`);
			assert.ok(clearOfCrosshair(reading), `share ${share} must not cover the line it annotates: ${JSON.stringify(reading)}`);
			rightmost = reading;
		}
		// At 760 the window ends where the card does, so the last day is the case that has to flip.
		assert.ok(rightmost && rightmost.tip.right <= rightmost.crosshair, `the bubble flips to the left when the right runs out: ${JSON.stringify(rightmost)}`);
		await shot("usage-trend-hover-narrow");

		const afterScroll = await app.evaluate<{ moved: boolean; shown: boolean }>(`(async () => {
			const chart = document.querySelector('[data-usage-chart="cost"]');
			const pane = [...document.querySelectorAll("div")].find((el) => el.scrollHeight > el.clientHeight + 40 && el.contains(chart)) ?? document.scrollingElement;
			const before = pane.scrollTop;
			pane.scrollTop += 60;
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return { moved: pane.scrollTop !== before, shown: Boolean(document.querySelector('[data-chart-tip]')) };
		})()`);
		assert.ok(afterScroll.moved, `the page must actually scroll for this to prove anything: ${JSON.stringify(afterScroll)}`);
		assert.equal(afterScroll.shown, false, "a bubble fixed to the window must not survive the chart scrolling away under it");
	} finally {
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
	}
});

test("the chart fills the height the spend list gives it, instead of leaving a band of empty card", async (t) => {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const layout = await app.evaluate<{ left: number; right: number; slackUnderChart: number; rows: number; chart: number }>(`(() => {
		const chart = document.querySelector('[data-usage-chart="cost"]');
		const right = chart.parentElement;
		const left = right.parentElement.firstElementChild;
		const svg = chart.querySelector('svg').getBoundingClientRect();
		const l = left.getBoundingClientRect(), r = right.getBoundingClientRect();
		return {
			left: Math.round(l.height),
			right: Math.round(r.height),
			slackUnderChart: Math.round(r.bottom - svg.bottom),
			rows: left.querySelectorAll('.space-y-3 > div').length,
			chart: Math.round(svg.height),
		};
	})()`);

	assert.equal(layout.rows, 3, `the spend list is the top three: ${JSON.stringify(layout)}`);
	assert.ok(Math.abs(layout.left - layout.right) <= 2, `the two cards share a row: ${JSON.stringify(layout)}`);
	assert.ok(layout.slackUnderChart <= 24, `the chart must reach the bottom of its card: ${JSON.stringify(layout)}`);
	assert.ok(layout.chart >= 220, `and take the height it was given: ${JSON.stringify(layout)}`);
	t.diagnostic(JSON.stringify(layout));
	await ui(`
		const chart = document.querySelector('[data-usage-chart="cost"]');
		const pane = [...document.querySelectorAll("div")].find((el) => el.scrollHeight > el.clientHeight + 40 && el.contains(chart));
		if (pane) pane.scrollTop = 0;
		await wait(150);
	`);
	await shot("usage-dashboard-top-three");
});

test("the model editor synchronises offline catalogue values and offers upstream references for relays", async () => {
	const expected = catalogModelFor({ id: "openai", baseUrl: "https://api.openai.com/v1" }, "gpt-5.2");
	assert.ok(expected);
	const values = await ui<{ context: string; output: string; input: string; outputPrice: string; cacheRead: string; cacheWrite: string; source: string; manualSource: string; relayMatched: boolean }>(`
		click(byText("nav button", "模型设置"));
		await wait(300);
		click(byText("button", "OpenAI 官方"));
		await wait(200);
		click(byText("button", "添加模型"));
		await wait(200);
		const field = (text) => [...document.querySelectorAll("label")].find((element) => label(element).startsWith(text));
		const modelInput = field("模型 ID").querySelector("input");
		typeValue(modelInput, "gpt-5.2");
		await wait(150);
		const matched = [...document.querySelectorAll("div")].some((element) => label(element).startsWith("离线模型目录已匹配"));
		if (!matched) throw new Error("catalogue did not match gpt-5.2");
		click(byText("button", "同步目录信息"));
		await wait(100);
		const read = (text) => field(text).querySelector("input").value;
		const result = {
			context: read("上下文窗口"),
			output: read("最大输出"),
			input: read("输入价格"),
			outputPrice: read("输出价格"),
			cacheRead: read("缓存命中价格"),
			cacheWrite: read("缓存写入价格"),
			source: [...document.querySelectorAll("p")].find((element) => label(element).includes("价格来自 models.dev"))?.innerText || "",
		};
		typeValue(field("输入价格").querySelector("input"), "9.9");
		await wait(100);
		const manualSource = [...document.querySelectorAll("p")].find((element) => label(element).includes("当前使用手动价格"))?.innerText || "";
		click(byText("button", "取消"));
		await wait(150);
		click(byText("button", "Relay"));
		await wait(150);
		click(byText("button", "添加模型"));
		await wait(150);
		const relayInput = field("模型 ID").querySelector("input");
		typeValue(relayInput, "gpt-5.2");
		await wait(100);
		return { ...result, manualSource, relayMatched: [...document.querySelectorAll("div")].some((element) => label(element).startsWith("离线模型目录已匹配")) };
	`);

	assert.equal(values.context, String(expected.model.contextWindow));
	assert.equal(values.output, String(expected.model.maxOutputTokens));
	assert.equal(values.input, String(expected.model.inputPrice));
	assert.equal(values.outputPrice, String(expected.model.outputPrice));
	assert.equal(values.cacheRead, expected.model.cacheReadPrice === undefined ? "" : String(expected.model.cacheReadPrice));
	assert.equal(values.cacheWrite, expected.model.cacheWritePrice === undefined ? "" : String(expected.model.cacheWritePrice));
	assert.match(values.source, /models\.dev/);
	assert.match(values.manualSource, /手动价格/);
	assert.equal(values.relayMatched, true);
});
