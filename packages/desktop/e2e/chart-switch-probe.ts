/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 两处「切过去应该是滑过去的」，逐帧量它到底滑没滑。
 *
 *   1. 使用统计的每日趋势，在「费用」和「Token」之间切换。代码里是有补间的（`useMorphedY`），
 *      所以问题不可能靠读源码判断——要么那段没跑到，要么跑了但屏幕上看不出来。
 *   2. 设置页的开关。它的圆点靠 `left` 过渡，而 `left` 能不能动画取决于它有没有定位上下文。
 *
 * 两处都按**绘制帧**取，不按时间采样：rAF 里逐帧读 computed 值，才能分清「滑过去」和「跳过去」
 * ——两头的读数在这两种情况下一模一样，区别只在中间那几帧存不存在。
 *
 * 图要有数据才画得出来，所以固件是从真实的 ~/.lyra 里复制一个会话目录进来的：合成的用量压不出
 * 多供应商、跨月份的那条曲线，而那正是这张图的样子。
 *
 * 跑：node --experimental-strip-types e2e/chart-switch-probe.ts
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9483;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "chart-switch");
const WINDOW = { width: 1440, height: 900 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 真实 profile 里最大的那个会话目录——用量图要有跨天的记录才画得出趋势。 */
async function biggestSessionDir(): Promise<string | null> {
	const root = join(homedir(), ".lyra", "sessions");
	try {
		const names = await readdir(root);
		let best: { path: string; size: number } | null = null;
		for (const name of names) {
			const path = join(root, name);
			const files = await readdir(path).catch(() => []);
			let size = 0;
			for (const file of files) size += (await stat(join(path, file)).catch(() => ({ size: 0 }))).size;
			if (!best || size > best.size) best = { path, size };
		}
		return best?.path ?? null;
	} catch {
		return null;
	}
}

const source = await biggestSessionDir();
console.log(source ? `固件会话：${source}` : "没找到真实会话，图可能是空的");

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ ...WINDOW, x: 0, y: 0 }));
		if (source) {
			await mkdir(join(home, "sessions"), { recursive: true });
			await cp(source, join(home, "sessions", "probe"), { recursive: true });
		}
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4519, token: null },
				appearance: { theme: "dark" },
			}),
		);
	},
});

const FRAMES = join(OUT, "frames");
let frame = 0;
let recorder: ReturnType<typeof setInterval> | null = null;
const stamps: number[] = [];

/** 逐帧落盘，JPEG——PNG 在这个尺寸下一帧要几百毫秒，录出来是一叠幻灯片。 */
const record = () => {
	let busy = false;
	recorder = setInterval(() => {
		if (busy) return;
		busy = true;
		const at = Date.now();
		app
			.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 62 })
			.then((s) => writeFile(join(FRAMES, `${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(s.data, "base64")))
			.then(() => void stamps.push(at))
			.catch(() => {})
			.finally(() => { busy = false; });
	}, 40);
};

const stopRecording = () => {
	if (recorder) clearInterval(recorder);
	recorder = null;
};

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
};

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

const click = async (x: number, y: number) => {
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

try {
	await mkdir(OUT, { recursive: true });
	await rm(FRAMES, { recursive: true, force: true });
	await mkdir(FRAMES, { recursive: true });
	await pause(3_500);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = document.querySelector('[data-project-row], [data-ly-project]');
		if (row) { row.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_500);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const gear = document.querySelector('[data-ly-open-settings]');
		if (gear) { gear.click(); await wait(1400); }
		return true;
	})()`);
	await pause(1_400);
	record();

	// ── 1. 每日趋势：费用 ↔ Token ────────────────────────────────────────────────────────────
	console.log("\n[1] 使用统计 → 每日趋势，切「费用 / Token」");
	const went = await app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const nav = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === '使用统计' && !b.closest('.ly-sidebar'));
		if (!nav) return false;
		nav.click();
		await wait(1600);
		return true;
	})()`);
	check(went, "走到了使用统计页");
	await pause(2_500);

	const chart = await app.evaluate<{ paths: number; segments: number; label: string } | string>(`(() => {
		/*
		 * 认 data-usage-trend，不认「第一个 path」。
		 *
		 * 这一页有 172 个 path，其中 170 个是图标——第一个恰好是某枚图标的轮廓，它当然不会跟着
		 * 切换而变。曲线自己带着供应商 id，那才是要量的东西。
		 */
		const lines = [...document.querySelectorAll('[data-usage-trend] path[d], path[data-usage-trend]')];
		if (lines.length === 0) return '这一页没画出趋势曲线';
		return {
			paths: lines.length,
			segments: (lines[0].getAttribute('d') || '').length,
			label: (document.body.innerText.match(/每日趋势/) || [''])[0],
		};
	})()`);
	console.log("   ", JSON.stringify(chart));
	check(typeof chart !== "string" && chart.paths > 0, `图画出来了（${typeof chart === "string" ? chart : chart.paths + " 条路径"}）`);
	await shot("01-cost");

	const token = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = [...document.querySelectorAll('[data-segment]')].find((b) => (b.textContent || '').trim() === 'Token');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!token) {
		check(false, "没找到「Token」那一格");
	} else {
		// 点下去，立刻开始逐帧录——录制本身跑在页面的 rAF 里，不会漏掉开头几帧。
		const frames = app.evaluate<string[]>(`(() => new Promise((resolve) => {
			const seen = [];
			let still = 0;
			const started = performance.now();
			const tick = () => {
				const el = document.querySelector('[data-usage-trend] path[d], path[data-usage-trend]');
				const value = el ? el.getAttribute('d') || '' : '';
				if (seen.length && value === seen[seen.length - 1]) still++;
				else { seen.push(value); still = 0; }
				if (still < 12 && performance.now() - started < 2000) requestAnimationFrame(tick);
				else resolve(seen);
			};
			requestAnimationFrame(tick);
		}))()`);
		await pause(30);
		await click(token.x, token.y);
		const shapes = await frames;
		console.log(`   切换时画了 ${shapes.length} 种形状`);
		check(
			shapes.length > 3,
			`曲线是形变过去的，不是换掉的（量到 ${shapes.length} 个中间形状；跳变只会有 2 个）`,
		);
		await pause(600);
		await shot("02-tokens");
	}

	// ── 1b. 这一页上另外两组 tab ─────────────────────────────────────────────────────────────
	/**
	 * 按一格，逐帧盯住一个读数，报它经过了多少个中间态。
	 *
	 * 「切换 tab 时是突然变化」这句话指的是哪一组 tab，从截图上看不出来——这一页有三组。所以三组
	 * 都按一遍，各自量各自最该动的那个东西：图量曲线，表量它第一行的文字，卡片量它的数字。
	 */
	const pressAndWatch = async (label: string, read: string, what: string) => {
		const spot = await app.evaluate<{ x: number; y: number } | null>(`(() => {
			const el = [...document.querySelectorAll('[data-segment], button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)} && !b.closest('nav, .ly-sidebar'));
			if (!el) return null;
			el.scrollIntoView({ block: "center" });
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!spot) {
			check(false, `没找到「${label}」`);
			return;
		}
		await pause(600);
		const frames = app.evaluate<string[]>(`(() => new Promise((resolve) => {
			const seen = [];
			let still = 0;
			const started = performance.now();
			const tick = () => {
				const value = String(${read});
				if (seen.length && value === seen[seen.length - 1]) still++;
				else { seen.push(value); still = 0; }
				if (still < 12 && performance.now() - started < 2500) requestAnimationFrame(tick);
				else resolve(seen);
			};
			requestAnimationFrame(tick);
		}))()`);
		await pause(30);
		await click(spot.x, spot.y);
		const seen = await frames;
		console.log(`   按「${label}」：${what} 经过 ${seen.length} 个中间态`);
		check(seen.length > 3, `按「${label}」时${what}是过渡过去的（${seen.length} 个中间态）`);
		await pause(700);
	};

	console.log("\n[1b] 另外两组 tab");
	const CURVE = `(document.querySelector('[data-usage-trend] path[d]') || {}).getAttribute ? document.querySelector('[data-usage-trend] path[d]').getAttribute('d') : ''`;
	/*
	 * 明细表量的是它的透明度，不是它的文字。
	 *
	 * 「模型」和「日期」下面的行没有一条对得上——12 个模型对 12 天——所以文字本来就是一下换掉的，
	 * 逐行补间只会得到一串没有意义的中间态。这一块的过渡是整块淡入（key 一变就重挂载，播一次
	 * ly-fade-up），所以要量的是那一块的 opacity 走没走过中间值。
	 */
	const TABLE = `(() => {
		const box = document.querySelector('[data-usage-breakdown] > div:last-child');
		return box ? getComputedStyle(box).opacity : '';
	})()`;
	await pressAndWatch("90 天", CURVE, "曲线");
	await pressAndWatch("30 天", CURVE, "曲线");
	await pressAndWatch("日期", TABLE, "明细表第一行");
	await pressAndWatch("模型", TABLE, "明细表第一行");
	await shot("01b-ranges");

	// ── 2. 开关的圆点 ────────────────────────────────────────────────────────────────────────
	console.log("\n[2] 设置里的开关，圆点滑不滑");
	await app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const nav = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === '常规' && !b.closest('.ly-sidebar'));
		if (nav) { nav.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_200);

	const toggle = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector('button[role="switch"]');
		if (!el) return null;
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!toggle) {
		check(false, "这一页没有开关");
	} else {
		await pause(500);
		const before = await app.evaluate<string>(`(() => {
			const knob = document.querySelector('button[role="switch"] span');
			return knob ? getComputedStyle(knob).transform + " | " + getComputedStyle(knob).transitionProperty : 'none';
		})()`);
		console.log(`   按之前：${before}`);

		const knobFrames = app.evaluate<string[]>(`(() => new Promise((resolve) => {
			const seen = [];
			let still = 0;
			const started = performance.now();
			const tick = () => {
				const knob = document.querySelector('button[role="switch"] span');
				const value = knob ? getComputedStyle(knob).transform : '';
				if (seen.length && value === seen[seen.length - 1]) still++;
				else { seen.push(value); still = 0; }
				if (still < 12 && performance.now() - started < 1500) requestAnimationFrame(tick);
				else resolve(seen);
			};
			requestAnimationFrame(tick);
		}))()`);
		await pause(30);
		await click(toggle.x, toggle.y);
		const positions = await knobFrames;
		console.log(`   圆点经过 ${positions.length} 个位置：${positions.slice(0, 5).join(" → ")}${positions.length > 5 ? " …" : ""}`);
		check(positions.length > 3, `圆点是滑过去的（量到 ${positions.length} 个位置；跳过去只有 2 个）`);
		await pause(500);
		await shot("03-toggle");
	}

	stopRecording();
	await writeFile(join(OUT, "frames.json"), JSON.stringify({ stamps }));
	console.log(`\n帧 ${frame} 张`);
	console.log(`\n截图写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过：\n- ${failures.join("\n- ")}`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	stopRecording();
	await app.stop();
}

if (failures.length > 0) process.exitCode = 1;
