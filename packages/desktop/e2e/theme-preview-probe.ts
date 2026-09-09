/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 「系统」那张主题预览，到底看着像不像一半一半。
 *
 * 面积各半是算得出来的，看着像什么不是。竖着从中间切的那一版，量出来两边一样大，可浅色那半的宽
 * 度大多花在灰色侧栏上（`bar`，x<40），深色那半却是通体的深；而卡片——眼睛真正落上去的那个形
 * ——横跨接缝，中心在 x=78，落在深色一侧。于是它读起来就是「一张深色缩略图，左边带一条浅边」，
 * 摆在「系统」两个字上面，被当成了深色选项。
 *
 * 所以这里不量面积，量**眼睛看到的**：把那张 SVG 光栅化，数一数亮像素和暗像素各占多少。两边都
 * 不该压倒对方——真正一半一半的图，谁也占不到七成。
 *
 * 用法：node --experimental-strip-types e2e/theme-preview-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9497;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 980, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			// 浅色，好让「系统」那张不是靠整体背景取胜。
			appearance: { theme: "light" },
		}),
	);
}

const app = await startApp({ port: PORT, seed });

try {
	await pause(2600);
	await app.evaluate(`(() => { const e = document.querySelector(".ly-sidebar-foot button"); if (e) e.click(); })()`);
	await pause(1400);
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => /外观|Appearance/.test(b.innerText));
		if (nav) nav.click();
	})()`);
	await pause(900);

	/*
	 * 把三张预览各自光栅化，数亮暗。
	 *
	 * 走 canvas 而不是读 SVG 源码：要问的是「画出来是什么样」，而这中间还隔着 clipPath、圆角和
	 * 叠放次序——它们正是上一版看走眼的地方。
	 */
	const readings = await app.evaluate<{ label: string; light: number; dark: number }[]>(`(async () => {
		const cards = [...document.querySelectorAll("button")].filter((b) => {
			const svg = b.querySelector("svg");
			return svg && svg.getAttribute("viewBox") === "0 0 120 80";
		});
		const out = [];
		for (const card of cards.slice(0, 3)) {
			const svg = card.querySelector("svg");
			const label = card.innerText.trim();
			const source = new XMLSerializer().serializeToString(svg);
			const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(source)));
			const image = new Image();
			await new Promise((done, fail) => { image.onload = done; image.onerror = fail; image.src = url; });
			const canvas = document.createElement("canvas");
			canvas.width = 120;
			canvas.height = 80;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0, 120, 80);
			const { data } = ctx.getImageData(0, 0, 120, 80);
			let light = 0;
			let dark = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] < 8) continue;
				// 亮度按人眼的加权，不是三通道平均：同样的数值，绿比蓝显得亮得多。
				const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
				if (luma > 140) light++;
				else if (luma < 90) dark++;
			}
			out.push({ label, light, dark });
		}
		return out;
	})()`);

	console.log("");
	let bad = 0;
	for (const { label, light, dark } of readings) {
		const total = light + dark;
		const lightShare = total > 0 ? Math.round((light / total) * 100) : 0;
		console.log(`  ${label.padEnd(6)} 亮 ${String(lightShare).padStart(3)}%  暗 ${String(100 - lightShare).padStart(3)}%`);
		if (/系统|System/.test(label)) {
			// 一半一半的图，哪一边都不该到七成。
			if (lightShare < 30 || lightShare > 70) {
				console.log(`      ✗ 偏得太厉害，看着会被当成${lightShare < 30 ? "深色" : "浅色"}`);
				bad++;
			}
		}
	}
	console.log(bad === 0 ? "\n「系统」两边看着都不压倒对方\n" : `\n${bad} 处偏了\n`);
	process.exitCode = bad === 0 ? 0 : 1;
} finally {
	await app.stop();
}
