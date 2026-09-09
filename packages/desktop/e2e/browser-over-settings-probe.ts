/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 打开设置之后，浏览器那一页还在不在画。
 *
 * 报告说的是「进浏览器再进设置页，浏览器的画面出现在设置页里」。这件事只有真窗口能验：`<webview>`
 * 是独立进程的画面，jsdom 里根本没有它，而问题恰恰出在一条只对它成立的 CSS 规则上——
 * `visibility` 是继承的，后代显式写 `visible` 就能从祖先的 `hidden` 里重新露出来。
 *
 * 所以量的是 `checkVisibility({ visibilityProperty: true })`：浏览器自己算出来的「这东西现在画不画」。
 *
 * 用法：node --experimental-strip-types e2e/browser-over-settings-probe.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-浏览器盖设置");
const PORT = 9500;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 0,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4529, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: PORT, seed });

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

/** 浏览器自己算的可见性，外加那块画面此刻的矩形。 */
const painted = () =>
	app.evaluate<{ found: boolean; visible: boolean; rect: string }>(`(() => {
		const page = document.querySelector("webview");
		if (!page) return { found: false, visible: false, rect: "" };
		const r = page.getBoundingClientRect();
		return {
			found: true,
			visible: page.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true, opacityProperty: true }),
			rect: r.width > 0 ? \`\${Math.round(r.x)},\${Math.round(r.y)} \${Math.round(r.width)}×\${Math.round(r.height)}\` : "0×0",
		};
	})()`);

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(2400);

	const opened = await app.evaluate<string>(`(() => {
		const btn = [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-globe"));
		if (!btn) return "没有找到浏览器按钮";
		btn.click();
		return "已打开面板";
	})()`);
	console.log(`\n浏览器面板：${opened}`);
	await pause(1000);

	/*
	 * 一个 `data:` 页面，不出网。
	 *
	 * 要的只是「有一块 webview 在画东西」，颜色挑得刺眼是为了在截图里一眼认出它有没有越界。
	 */
	const navigated = await app.evaluate<string>(`(() => {
		const field = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes("\\u7f51") || (i.placeholder ?? "").includes("URL") || (i.placeholder ?? "").includes("\\u641c"));
		if (!field) return "没有找到地址栏";
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(field, "data:text/html,<body style='margin:0;background:%23e11d48'><h1 style='color:white;font:700 64px sans-serif;padding:40px'>BROWSER</h1></body>");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return "已导航";
	})()`);
	console.log(`地址栏：${navigated}`);
	await pause(2500);

	const inWorkspace = await painted();
	await shot("01-工作区里的浏览器.png");
	console.log(`\n工作区里：webview ${inWorkspace.found ? "在" : "不在"}，画着=${inWorkspace.visible}，矩形=${inWorkspace.rect}`);

	await app.evaluate(`(() => { const e = document.querySelector(".ly-sidebar-foot button"); if (e) e.click(); })()`);
	await pause(1600);

	const inSettings = await painted();
	await shot("02-设置页.png");
	console.log(`设置页里：webview ${inSettings.found ? "在" : "不在"}，画着=${inSettings.visible}，矩形=${inSettings.rect}`);

	/*
	 * 把旧写法按回去，看它是不是真的会漏出来。
	 *
	 * 对照实验：修好之后再跑，只能看到「现在是好的」，看不到「原来是坏的、坏在哪」。这里直接给
	 * 那层容器写回 `visibility: visible`——正是改掉的那一行做的事——如果画面因此回来了，根因就
	 * 钉死在这条继承规则上，而不是别的什么恰好一起变了。
	 */
	await app.evaluate(`(() => {
		const page = document.querySelector("webview");
		if (page?.parentElement) page.parentElement.style.visibility = "visible";
	})()`);
	await pause(500);
	const regressed = await painted();
	await shot("03-把旧写法按回去.png");
	console.log(`按回旧写法：画着=${regressed.visible}，矩形=${regressed.rect}`);

	console.log(
		`\n结论：${inSettings.visible ? "✗ 浏览器仍然画在设置页上" : "✓ 打开设置后浏览器不再画"}` +
			`（工作区里它应当画着：${inWorkspace.visible ? "是" : "否——那这条探针没测到东西"}；` +
			`按回旧写法后：${regressed.visible ? "又漏出来了，根因坐实" : "没漏——根因另有其人"}）\n`,
	);
} finally {
	await app.stop();
}
