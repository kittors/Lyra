/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 图片查看器按下「标注」的那一刻，画面动没动。
 *
 * 报告说的是「点编辑图片会位移」。这种事只能量：查看器里是一个 `<img>`，标注模式换成一个
 * `<canvas>`，两者各自算自己的尺寸——差一个像素，中间那层 `transform: translate` 就把整张图挪了。
 * 所以按下前后各读一次矩形，比的是同一件东西的两个状态。
 *
 * 图片从输入框的附件缩略图进查看器，那是这条路真实的走法，也免了造一份带图的会话日志。
 *
 * 用法：node --experimental-strip-types e2e/viewer-edit-shift-probe.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-图片标注位移");
const PORT = 9499;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
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
			sync: { enabled: false, port: 4527, token: null },
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

interface Rect {
	tag: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 舞台上那一张，不管它现在是 img 还是 canvas。 */
const stage = () =>
	app.evaluate<Rect | null>(`(() => {
		const el = document.querySelector('[role="dialog"] canvas') ?? document.querySelector('[role="dialog"] img:not([aria-hidden="true"])');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { tag: el.tagName, x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
	})()`);

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(2400);

	/*
	 * 一张 1600×1000 的图，比 86vh 高、比 86vw 窄。
	 *
	 * 挑成这个形状是为了让「高度先撞上限、宽度再由比例算出来」——img 与 canvas 在这一步的算法
	 * 若有分歧，正是这种形状会把它放大。纯色加一道斜边，肉眼也能看出有没有挪。
	 */
	const injected = await app.evaluate<string>(`(async () => {
		const c = document.createElement("canvas");
		c.width = 1600; c.height = 1000;
		const g = c.getContext("2d");
		g.fillStyle = "#2f6df6"; g.fillRect(0, 0, 1600, 1000);
		g.fillStyle = "#ffd166"; g.beginPath(); g.moveTo(0, 1000); g.lineTo(1600, 0); g.lineTo(1600, 1000); g.closePath(); g.fill();
		const blob = await new Promise((r) => c.toBlob(r, "image/png"));
		const input = document.querySelector('main input[type="file"]');
		if (!input) return "没有找到附件输入框";
		const dt = new DataTransfer();
		dt.items.add(new File([blob], "probe.png", { type: "image/png" }));
		input.files = dt.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return "已投喂";
	})()`);
	console.log(`\n附件：${injected}`);
	await pause(1200);

	const opened = await app.evaluate<string>(`(() => {
		const thumb = [...document.querySelectorAll("main button")].find((b) => b.querySelector('img[src^="data:image"]'));
		if (!thumb) return "没有找到缩略图";
		thumb.click();
		return "已打开";
	})()`);
	console.log(`查看器：${opened}`);
	// 等它飞完，并且过了 `decodable` 那个定时器——那之后标注画布才是热的。
	await pause(1800);

	const before = await stage();
	await shot("01-查看中.png");

	/*
	 * 按下标注，然后逐帧读。
	 *
	 * 只读「按完之后」一次是不够的：位移可能只存在一两帧（画布挂上来时还没拿到尺寸），等它稳下来
	 * 再量就什么都看不见，而人眼看见的正是那一两帧。所以按 rAF 连读若干帧，取其中偏得最多的那一帧。
	 */
	const frames = await app.evaluate<Rect[]>(`(async () => {
		const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.querySelector("svg.lucide-pencil, svg[class*='pencil']"));
		if (!btn) return [];
		const read = () => {
			const el = document.querySelector('[role="dialog"] canvas') ?? document.querySelector('[role="dialog"] img:not([aria-hidden="true"])');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { tag: el.tagName, x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
		};
		btn.click();
		const out = [];
		for (let i = 0; i < 40; i++) {
			await new Promise((r) => requestAnimationFrame(r));
			const one = read();
			if (one) out.push(one);
		}
		return out;
	})()`);
	await pause(600);
	const after = await stage();
	await shot("02-标注中.png");

	console.log("\n按下「标注」前后：");
	console.log(`  前：${before ? `${before.tag} x=${before.x} y=${before.y} w=${before.w} h=${before.h}` : "(读不到)"}`);
	console.log(`  后：${after ? `${after.tag} x=${after.x} y=${after.y} w=${after.w} h=${after.h}` : "(读不到)"}`);

	if (before && after) {
		console.log(`  稳定后偏移：dx=${(after.x - before.x).toFixed(2)} dy=${(after.y - before.y).toFixed(2)} dw=${(after.w - before.w).toFixed(2)} dh=${(after.h - before.h).toFixed(2)}`);
	}

	/*
	 * 工具栏到底浮着还是排在队里。
	 *
	 * 它的类里 `fixed` 与 `relative` 同时写着，而 position 只能有一个——谁赢由 Tailwind 输出的
	 * 先后决定，不是类名的书写顺序。赢的是 `relative` 的话，它就是 flex 容器里的第二个成员，
	 * 图片被它挤到一边，正是这条探针量到的那 203px。
	 */
	const members = await app.evaluate<{ tag: string; position: string; x: number; w: number; cls: string }[]>(`(() => {
		const dialog = document.querySelector('[role="dialog"]');
		return [...dialog.children].map((el) => {
			const r = el.getBoundingClientRect();
			return { tag: el.tagName, position: getComputedStyle(el).position, x: +r.x.toFixed(2), w: +r.width.toFixed(2), cls: (el.className ?? "").toString().slice(0, 50) };
		});
	})()`);
	console.log("\n对话框的直接子元素（position 不是 fixed/absolute 的那些才排队占地方）：");
	for (const one of members) console.log(`  ${one.tag.padEnd(6)} ${one.position.padEnd(9)} x=${String(one.x).padStart(8)} w=${String(one.w).padStart(8)} ${one.cls}`);

	// 哪一层宽了，就是哪一层的错——从舞台上那张图一路量到对话框。
	const chain = await app.evaluate<{ tag: string; cls: string; w: number; x: number; display: string }[]>(`(() => {
		let node = document.querySelector('[role="dialog"] canvas') ?? document.querySelector('[role="dialog"] img:not([aria-hidden="true"])');
		const out = [];
		while (node && out.length < 6) {
			const r = node.getBoundingClientRect();
			out.push({ tag: node.tagName, cls: (node.className ?? "").toString().slice(0, 60), w: +r.width.toFixed(2), x: +r.x.toFixed(2), display: getComputedStyle(node).display });
			node = node.parentElement;
		}
		return out;
	})()`);
	console.log("\n标注模式下这条 DOM 链的宽度：");
	for (const one of chain) console.log(`  ${one.tag.padEnd(7)} x=${String(one.x).padStart(8)} w=${String(one.w).padStart(8)} ${one.display.padEnd(6)} ${one.cls}`);

	if (before && frames.length > 0) {
		let worst = frames[0];
		let worstBy = -1;
		for (const frame of frames) {
			const by = Math.max(Math.abs(frame.x - before.x), Math.abs(frame.y - before.y), Math.abs(frame.w - before.w), Math.abs(frame.h - before.h));
			if (by > worstBy) {
				worstBy = by;
				worst = frame;
			}
		}
		console.log(`\n中途最偏的一帧（共读了 ${frames.length} 帧）：`);
		console.log(`  ${worst.tag} x=${worst.x} y=${worst.y} w=${worst.w} h=${worst.h}  偏 ${worstBy.toFixed(2)}px`);
		const distinct = [...new Set(frames.map((f) => `${f.tag} ${f.x},${f.y} ${f.w}×${f.h}`))];
		console.log(`  逐帧出现过的形态（${distinct.length} 种）：`);
		for (const one of distinct) console.log(`    ${one}`);
	}
	console.log("");
} finally {
	await app.stop();
}
