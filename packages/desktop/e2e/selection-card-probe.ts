/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 选区卡片在真窗口里长什么样。
 *
 * 单测能证明那块地方确实是 `ComposerShell`、回车确实提交，但证明不了它「看着对不对」——卡片本身
 * 也有描边和内边距，外壳再套一层就成了套盒。所以走一遍真实路径：开浏览器、检查元素、在页面上点
 * 一下，然后把卡片拍下来，顺带量一量它跟主输入框是不是同一副长相。
 *
 * 用法：node --experimental-strip-types e2e/selection-card-probe.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-选区卡片");
const PORT = 9502;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
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
			sync: { enabled: false, port: 4533, token: null },
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

async function clickAt(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
	await pause(120);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
	await pause(60);
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(2400);

	await app.evaluate(`(() => {
		const btn = [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-globe"));
		if (btn) btn.click();
	})()`);
	await pause(900);
	await app.evaluate(`(() => {
		const field = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes("\\u7f51") || (i.placeholder ?? "").includes("\\u641c"));
		if (!field) return;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(field, "data:text/html,<body style='margin:0;font:16px system-ui'><section style='margin:40px;padding:32px;background:%23f1f5f9'><h1>Pricing</h1><p>Three plans.</p></section></body>");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	await pause(2500);

	// 「检查元素」藏在浏览器面板的「…」里。
	await app.evaluate(`(() => {
		const btn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "\\u6d4f\\u89c8\\u5668\\u83dc\\u5355");
		if (btn) btn.click();
	})()`);
	await pause(600);
	const entered = await app.evaluate<string>(`(() => {
		const item = [...document.querySelectorAll('[role="menuitem"], button')].find((b) => (b.textContent ?? "").includes("\\u68c0\\u67e5\\u5143\\u7d20"));
		if (!item) return "没有找到「检查元素」";
		item.click();
		return "已进入检查";
	})()`);
	console.log(`\n${entered}`);
	await pause(1200);

	// 在 webview 中间点一下：合成的鼠标事件会被 Chromium 路由进那个独立进程的页面。
	const page = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("webview");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 3) };
	})()`);
	if (!page) throw new Error("没有找到 webview");
	await clickAt(page.x, page.y);
	await pause(1800);

	const card = await app.evaluate<{ found: boolean; shell: boolean; radius: string; border: string; height: number } | null>(`(() => {
		const box = document.querySelector("[data-browser-selection]");
		if (!box) return { found: false, shell: false, radius: "", border: "", height: 0 };
		const shell = box.querySelector(".ly-composer");
		const s = shell ? getComputedStyle(shell) : null;
		return {
			found: true,
			shell: Boolean(shell),
			radius: s ? s.borderRadius : "",
			border: s ? s.borderColor : "",
			height: Math.round(box.getBoundingClientRect().height),
		};
	})()`);
	console.log(`选区卡片：${card?.found ? "出现了" : "没出现"}`);
	if (card?.found) {
		console.log(`  用的是主输入框外壳：${card.shell ? "是" : "否 ✗"}`);
		console.log(`  外壳圆角=${card.radius} 描边=${card.border} 卡片高=${card.height}px`);
	}
	await shot("01-选区卡片.png");

	// 主输入框那副外壳的同一批数值，用来比对。
	const main = await app.evaluate<{ radius: string; border: string }>(`(() => {
		const shell = document.querySelector("main textarea")?.closest(".ly-composer");
		const s = shell ? getComputedStyle(shell) : null;
		return { radius: s ? s.borderRadius : "(没找到)", border: s ? s.borderColor : "" };
	})()`);
	console.log(`  主输入框：圆角=${main.radius} 描边=${main.border}`);
	console.log("");
} finally {
	await app.stop();
}
