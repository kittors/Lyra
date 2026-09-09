/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 打开设置之后，工作区里还有什么在画。
 *
 * `BrowserPage` 的 `<webview>` 是这么漏出来的，但它未必是唯一一个：设置是**盖**在工作区上的，
 * 工作区靠 `visibility: hidden` 退场（`display: none` 会丢掉聊天记录的滚动位置），而
 * `visibility` 有两个能被绕过的口子——
 *
 *   1. 它是继承的，后代显式写 `visible` 就能重新露出来；
 *   2. 用 portal 挂到 `document.body` 上的东西根本不在工作区子树里，隐藏管不着它。
 *
 * 独立合成的元素（webview、iframe、embed、video、canvas）尤其值得单独确认：它们各自有渲染
 * 通道，「CSS 说隐藏」和「那条通道真的停了」不总是同一件事。所以这里把它们一个个塞进工作区，
 * 然后问浏览器自己：现在还画不画。
 *
 * 用法：node --experimental-strip-types e2e/settings-overlap-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9501;
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
			sync: { enabled: false, port: 4531, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: PORT, seed });

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(2400);

	// 真的开一个浏览器面板，好让 `<webview>` 这条真实的路也在场。
	await app.evaluate(`(() => {
		const btn = [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-globe"));
		if (btn) btn.click();
	})()`);
	await pause(900);
	await app.evaluate(`(() => {
		const field = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes("\\u7f51") || (i.placeholder ?? "").includes("\\u641c"));
		if (!field) return;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(field, "data:text/html,<body style='background:%23e11d48'></body>");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	await pause(2200);

	/*
	 * 其余几种独立合成的元素，直接塞进工作区。
	 *
	 * 走真实界面把 PDF、文档预览一个个打开要备一堆夹具，而这里要问的不是「那个功能对不对」，
	 * 是「这类元素在祖先被 hidden 之后还画不画」——祖先链一样，答案就一样。挂在聊天壳子里面，
	 * 拿到的正是那条链。
	 */
	const planted = await app.evaluate<string[]>(`(() => {
		const host = document.querySelector("[data-browser-panel]")?.closest("div[class]")?.parentElement ?? document.querySelector("main")?.parentElement;
		if (!host) return [];
		const made = [];
		const add = (el, name) => { el.setAttribute("data-probe-plant", name); el.style.position = "absolute"; el.style.left = "8px"; el.style.top = "8px"; el.style.width = "80px"; el.style.height = "60px"; host.appendChild(el); made.push(name); };
		const frame = document.createElement("iframe");
		frame.src = "data:text/html,<body style='background:teal'></body>";
		add(frame, "iframe");
		const pdf = document.createElement("embed");
		pdf.type = "application/pdf";
		add(pdf, "embed");
		const clip = document.createElement("video");
		clip.autoplay = true; clip.muted = true; clip.loop = true;
		add(clip, "video");
		const paint = document.createElement("canvas");
		paint.width = 80; paint.height = 60;
		const g = paint.getContext("2d"); g.fillStyle = "#0f0"; g.fillRect(0, 0, 80, 60);
		add(paint, "canvas");
		return made;
	})()`);
	console.log(`\n除了 webview，另外塞进工作区的：${planted.join("、") || "(一个也没塞进去)"}`);

	/*
	 * 开着一个浮层再进设置。
	 *
	 * 五种浮层（对话框、气泡、悬停卡、吐司、图片查看器）都 portal 到 `document.body`，压根不在
	 * 工作区那棵子树里——把工作区隐藏起来这件事管不着它们。所以要单独问一句：切走的时候它自己
	 * 收不收摊。真实路径就是这样：点开一个气泡，然后去点设置。
	 */
	const popped = await app.evaluate<string>(`(() => {
		const btn = [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-ellipsis"));
		if (!btn) return "没有找到能开气泡的按钮";
		btn.click();
		return "已打开气泡";
	})()`);
	await pause(700);
	const beforeSwitch = await app.evaluate<number>(`document.body.children.length`);
	console.log(`\n浮层：${popped}，此刻 body 有 ${beforeSwitch} 个直属孩子`);

	/*
	 * 用真鼠标去点设置，不是 `.click()`。
	 *
	 * 「点到别处就收起来」听的是 pointerdown，而 `.click()` 只派发一个 click——用它去点，气泡
	 * 会留在屏上，那是探针自己造出来的假象，不是用户会遇到的事。真实的按下与抬起才问得出这一条
	 * 关不关得掉。
	 */
	const aim = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const e = document.querySelector(".ly-sidebar-foot button");
		if (!e) return null;
		const r = e.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (aim) {
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", { type, x: aim.x, y: aim.y, button: "left", clickCount: 1 });
		}
	}
	await pause(1800);

	/*
	 * 设置开着的时候，把整棵树问一遍。
	 *
	 * 工作区那半边应该一个都不画；`document.body` 的直属孩子里，除了设置自己那一支，画着的
	 * 就是 portal 挂上去的浮层——它们不在工作区子树里，隐藏本来就管不着，所以要单独看一眼。
	 */
	const audit = await app.evaluate<{ workspace: string[]; plants: string[]; roots: string[] }>(`(() => {
		const hidden = document.querySelector(".invisible.absolute.inset-0");
		const name = (el) => el.tagName.toLowerCase() + (el.dataset.probePlant ? \`[\${el.dataset.probePlant}]\` : el.className ? "." + String(el.className).split(/\\s+/).slice(0, 2).join(".") : "");
		const paints = (el) => el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true, opacityProperty: true });
		return {
			workspace: hidden ? [...hidden.querySelectorAll("*")].filter(paints).slice(0, 12).map(name) : ["(没有找到被隐藏的工作区容器)"],
			plants: [...document.querySelectorAll("[data-probe-plant]")].map((el) => \`\${el.dataset.probePlant}=\${paints(el) ? "还在画" : "停了"}\`),
			roots: [...document.body.children].map((el) => \`\${name(el)}=\${paints(el) ? "在画" : "停了"}\`),
		};
	})()`);

	console.log(`\n设置开着时，工作区子树里还在画的元素：${audit.workspace.length === 0 ? "没有 ✓" : "✗ " + audit.workspace.join("、")}`);
	console.log(`塞进去的那几个：${audit.plants.join("、")}`);
	console.log(`body 的直属孩子（portal 挂上去的不受工作区隐藏管辖）：`);
	for (const one of audit.roots) console.log(`  ${one}`);
	console.log("");
} finally {
	await app.stop();
}
