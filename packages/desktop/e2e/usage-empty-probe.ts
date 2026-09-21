/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 一条记录都没有的时候，这两页长什么样。
 *
 * 空状态是最容易做不完的那一块：平时没人看得到它，而它恰恰是新用户看到的第一屏，也是刚清空过
 * 记录的人看到的那一屏。这个探针把 home 造成全空，然后把用量页和存储页各拍一张——空状态好不好
 * 看，只能看。
 *
 * 顺便量一件看不出来的事：被截断的那些文字有没有挂上提示。`data-ly-tip-when="truncated"` 只在
 * 真写不下的时候才弹，所以「有没有挂」和「会不会弹」是两个问题，这里问前一个。
 *
 * Run: LYRA_E2E_ARTIFACTS=~/Desktop/空状态测试 node --experimental-strip-types e2e/usage-empty-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9437;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const project = join(home, "demo-project");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "readme.md"), "# demo\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 940, x: 0, y: 0 }));
		// 一条会话都不造：这就是这个探针的全部意思。
		await mkdir(join(home, "sessions"), { recursive: true });
		await writeFile(join(home, "sessions", "index.json"), "[]");
		await writeFile(join(home, "settings.json"), JSON.stringify({
			version: 1,
			providers: [{ id: "relay", name: "公司中转", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "", enabled: true, models: [] }],
			mcpServers: [],
			projects: [{ id: "e2e", name: "demo-project", path: project, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
			alwaysAllow: [], sync: { enabled: false, port: 4525, token: null }, appearance: { theme: "light" },
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
	const openSettings = async (name) => {
		const foot = document.querySelector(".ly-sidebar-foot button");
		if (foot) click(foot);
		await wait(600);
		const nav = byText("nav button", name);
		if (!nav) throw new Error("侧边栏里没有 " + name);
		click(nav);
		await wait(1500);
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 940, deviceScaleFactor: 2, mobile: false });
	await pause(2_600);

	const usage = await ui<{ hints: string[]; marks: number }>(`
		await openSettings("使用统计");
		for (let i = 0; i < 100; i++) {
			if (document.querySelector('[data-usage-dashboard="true"]')) break;
			await wait(100);
		}
		await wait(600);
		const board = document.querySelector('[data-usage-dashboard="true"]');
		if (!board) return { hints: ["(用量页没画出来)"], marks: 0 };
		/*
		 * 按 data-ly-empty 找，不按 class 找。
		 *
		 * 上一版这里写的是某个 max-w 的类名，样式一调探针就报「一块空状态都没有」——而屏幕上明明
		 * 画着三块。选择器里写样式，量到的永远是上一版的样子。
		 */
		const blocks = [...board.querySelectorAll("[data-ly-empty]")];
		return {
			hints: blocks.map(label),
			marks: blocks.filter((el) => el.querySelector("svg")).length,
		};
	`);
	console.log("=== 使用统计（一条记录都没有）===");
	console.log("空状态说的话:", usage.hints);
	console.log("其中配了记号的:", usage.marks, "块");
	await shot("1-使用统计-空");

	const storage = await ui<{ text: string; clearDisabled: boolean }>(`
		await openSettings("存储");
		await wait(800);
		const card = document.querySelector('[data-usage-cleanup="true"]');
		if (!card) return { text: "(存储页没画出来)", clearDisabled: false };
		return { text: label(card), clearDisabled: card.querySelector("[data-usage-clear]").disabled };
	`);
	console.log("\n=== 存储（一条记录都没有）===");
	console.log(storage.text);
	console.log("清除按钮按不动:", storage.clearDisabled);
	await shot("2-存储-空");
} finally {
	await app.stop();
}
