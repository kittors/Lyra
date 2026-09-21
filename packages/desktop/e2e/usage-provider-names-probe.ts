/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 用量页上那几个「不知道是啥」的供应商，在真窗口里现在长什么样。
 *
 * 账按 `providerId` 记，名字只活在 `settings.providers` 里——删掉一个供应商，它花过的钱一分不少
 * 地留在日志里，页面上却只剩 `provider-mttnetnn` 这么一串。这个探针把那一屏照原样造出来：三个
 * 已经删掉的供应商（一个有档案、两个没有）、一个还配着的、一个查不到价的。
 *
 * 量的是画出来的结果，不是传进去的值：供应商那一栏的文字从 DOM 上读回来，命名之后再读一次
 * `settings.json`，确认那个名字真的落了盘——页面上改对了而没写进去，下次打开还是那串 id。
 *
 * Run: LYRA_E2E_ARTIFACTS=~/Desktop/供应商名字测试 node --experimental-strip-types e2e/usage-provider-names-probe.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9433;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PROJECT_ID = "bbbbbbbbbbbbbbbb";
const DAY = 86_400_000;

/**
 * 五个供应商，覆盖「认得出是谁」的每一种情况。
 *
 * `priced` 为 false 的那个是关键的一个：它查不到价，于是按费用排的榜把它压到最后一位——本机上
 * 真有这么一个，2.2M token、$0.00、在只显示前三名的卡片上等于不存在。
 */
const SPEND = [
	{ provider: "provider-mttnetnn", model: "gemini-3.8-flash-high", replies: 40, perCost: 0.6, priced: true },
	{ provider: "provider-live", model: "claude-opus-4-6-thinking", replies: 20, perCost: 0.5, priced: true },
	{ provider: "provider-mszq0hpb", model: "grok-4.6", replies: 16, perCost: 0.3, priced: true },
	{ provider: "relay", model: "gemini-3.7-flash-high", replies: 10, perCost: 0.1, priced: true },
	{ provider: "provider-mtvmtyj6", model: "deepseek-flash", replies: 30, perCost: 0, priced: false },
];

let settingsPath = "";

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		settingsPath = join(home, "settings.json");
		const project = join(home, "demo-project");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "readme.md"), "# demo\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 940, x: 0, y: 0 }));
		await mkdir(join(home, "sessions", PROJECT_ID), { recursive: true });

		const now = Date.now();
		const lines: string[] = [];
		let seq = 0;
		const meta = {
			id: "spend", title: "用量页固件", cwd: project, projectId: PROJECT_ID, projectName: "demo-project",
			createdAt: now - 20 * DAY, updatedAt: now, modelId: "provider-live/claude-opus-4-6-thinking",
			messageCount: 0, seq: 1,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
		lines.push(JSON.stringify({ seq: ++seq, ts: now - 20 * DAY, type: "meta", meta }));

		for (const spend of SPEND) {
			for (let i = 0; i < spend.replies; i++) {
				// 摊到最近十天上，好让每日趋势那张图有几条真的曲线。
				const at = now - ((i % 10) * DAY) - 3_600_000;
				const input = spend.priced ? 40_000 : 73_000;
				/*
				 * 查不到价的那个连 `rates` 都没有——这正是它在真日志里的样子：`computeCost` 在模型
				 * 没有 pricing 时原样返回，于是费用是 0 且没有任何计价痕迹。
				 */
				const cost = spend.priced
					? { input: spend.perCost * 0.9, output: spend.perCost * 0.1, cacheRead: 0, cacheWrite: 0, total: spend.perCost, source: "catalog", catalogVersion: "2:89dfccad5490", rates: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 } }
					: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
				lines.push(JSON.stringify({
					seq: ++seq, ts: at, type: "message",
					message: {
						role: "assistant", content: [{ type: "text", text: "。" }], api: "openai-responses",
						provider: spend.provider, model: spend.model, stopReason: "stop", timestamp: at,
						usage: { input, output: 1_200, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: input + 1_200, cost },
					},
				}));
				lines.push(JSON.stringify({ seq: ++seq, ts: at, type: "message", message: { role: "user", content: [{ type: "text", text: "。" }], timestamp: at } }));
			}
		}
		await writeFile(join(home, "sessions", PROJECT_ID, "spend.jsonl"), lines.join("\n") + "\n");

		await writeFile(settingsPath, JSON.stringify({
			version: 1,
			providers: [
				{ id: "provider-live", name: "在用的中转", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "", enabled: true, models: [] },
			],
			// 档案里只有一个：删掉之后还认得出是谁的那一个。另外三个是 2026-09 之前删的，名字没了。
			providerNames: { "provider-mszq0hpb": "deerGpt" },
			mcpServers: [],
			projects: [{ id: "e2e", name: "demo-project", path: project, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
			alwaysAllow: [], sync: { enabled: false, port: 4521, token: null }, appearance: { theme: "light" },
		}));
	},
});

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
	console.log("  截图:", join(directory, name + ".png"));
}

const UI = `
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const label = (element) => (element.innerText || "").replace(/\\s+/g, " ").trim();
	const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.checkVisibility({ visibilityProperty: true }) && label(el) === text);
	const openUsage = async () => {
		click(document.querySelector(".ly-sidebar-foot button"));
		await wait(600);
		const nav = byText("nav button", "使用统计");
		if (!nav) throw new Error("侧边栏里没有「使用统计」");
		return nav;
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 940, deviceScaleFactor: 2, mobile: false });
	await pause(2_600);

	const landed = await ui<boolean>(`
		click(await openUsage());
		for (let i = 0; i < 120; i++) {
			if (document.querySelector('[data-usage-dashboard="true"]')) return true;
			await wait(100);
		}
		return false;
	`);
	console.log("用量页打开:", landed);
	if (!landed) throw new Error("用量页没画出来");
	await pause(900);

	/**
	 * 供应商那一栏画出来的字，逐行读回来。
	 *
	 * 按 `data-usage-spend` 找，不按位置或 class 找：主列一窄这张卡片的类名就变，而「第几个
	 * `.truncate`」这种问法量到的从来不是想量的东西。
	 */
	const readSpend = () => ui<{ rows: string[]; rest: string; breakdownMarks: number; breakdownRows: string[] }>(`
		const card = document.querySelector('[data-usage-dashboard="true"]');
		const rest = card.querySelector('[data-usage-rest="true"]');
		const table = card.querySelector('[data-usage-breakdown]');
		return {
			rows: [...card.querySelectorAll('[data-usage-spend]')].map(label),
			rest: rest ? label(rest) : "(没有这一行)",
			breakdownMarks: table ? table.querySelectorAll('svg').length : -1,
			breakdownRows: table ? [...table.querySelectorAll('.truncate.text-ink')].map(label).slice(0, 6) : [],
		};
	`);

	const before = await readSpend();
	console.log("\n=== 命名之前 ===");
	console.log("供应商行:", before.rows);
	console.log("榜外那一行:", before.rest);
	console.log("明细表厂牌数:", before.breakdownMarks, "行:", before.breakdownRows);
	await shot("1-命名之前");

	// 点开那个认不出的，就地给它起个名字。
	const named = await ui<{ opened: boolean; saved: boolean }>(`
		const target = document.querySelector('[data-usage-provider="provider-mttnetnn"]');
		if (!target) return { opened: false, saved: false };
		click(target);
		await wait(300);
		const input = document.querySelector('[data-usage-dashboard="true"] input');
		if (!input) return { opened: false, saved: false };
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
		setter.call(input, "公司老中转");
		input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "公司老中转" }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await wait(800);
		return { opened: true, saved: !document.querySelector('[data-usage-dashboard="true"] input') };
	`);
	console.log("\n=== 命名之后 ===");
	console.log("打开输入框:", named.opened, " 提交并收起:", named.saved);

	const after = await readSpend();
	console.log("供应商行:", after.rows);
	await shot("2-命名之后");

	// 落盘那一份才算数：页面上改对了而没写进去，下次打开还是那串 id。
	const onDisk = JSON.parse(await readFile(settingsPath, "utf8")) as { providerNames?: Record<string, string>; providers: { id: string }[] };
	console.log("\n=== settings.json ===");
	console.log("providerNames:", onDisk.providerNames);
	console.log("providers 仍然只有:", onDisk.providers.map((p) => p.id));
} finally {
	await app.stop();
}
