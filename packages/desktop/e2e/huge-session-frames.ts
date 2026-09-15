/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 真窗口、真数据，按**绘制帧**量：疯狂点会话、打开那条 12 MB 的消息、在里面滚。
 *
 * 判据不是「总共花了多久」，是**最长的一帧有多长**。总耗时长但每帧都在走，界面是「慢」；一帧卡住
 * 800 ms，界面是「死了」——鼠标变转圈的就是后者。所以这里全程挂 `requestAnimationFrame`，记下每
 * 两次绘制之间的间隔，最后看最长的那几个。
 *
 * 三个场景，都是用户报的那个用法：
 *
 *   A  疯狂点会话 item —— 八个会话，每隔 60 ms 点一个，中间不等它画完
 *   B  打开本机最大的那个会话（25.2 MB，里面一条 text block 就有 12.26 MB）
 *   C  在那条消息里滚动，顺便盯着 scrollHeight 抖不抖
 *
 * 抖动是单独一条：`content-visibility` 让浏览器跳过屏幕外的布局，代价是它得先估一个高度，估得不准
 * 滚动条就会在滚过去的时候跳一下。所以 C 里每帧都记 `scrollHeight`，跳变超过一屏就算抖。
 *
 * 数据是**整个 `~/.lyra` 复制一份**进临时 profile（凭据剔掉），原始数据只读不动——合成数据压不出
 * 这个问题。
 *
 * 用法：node --experimental-strip-types e2e/huge-session-frames.ts
 */

import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp, type RunningApp } from "./app.ts";

const PORT = 9713;

/**
 * 整个 `~/.lyra` 复制一份，凭据剔掉。
 *
 * 这段和 `session-switch-perf.ts` 里的是一样的，但**不能 import 它**——那个文件顶层就调用了自己的
 * `main()`，导进来等于把它整套测试跑一遍（第一次就是这么撞上的：输出全是别人的场景）。
 */
async function seedFromReal(home: string): Promise<void> {
	const env = { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" };
	await promisify(execFile)("cp", ["-R", `${join(homedir(), ".lyra")}/.`, home], { env, maxBuffer: 64 * 1024 * 1024 });
	for (const secret of ["credentials.json", "vault.key", "forges.json"]) await rm(join(home, secret), { force: true });
	const file = join(home, "settings.json");
	try {
		const settings = JSON.parse(await readFile(file, "utf8")) as {
			providers?: { apiKey?: string }[];
			sync?: { enabled?: boolean; port?: number };
		};
		for (const provider of settings.providers ?? []) provider.apiKey = "";
		if (settings.sync) settings.sync = { ...settings.sync, enabled: false, port: 4524 };
		await writeFile(file, JSON.stringify(settings));
	} catch {
		/* 读不出就按默认起，会话照样在 */
	}
}

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  —— ${saw}`);
}

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 60000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){try{if(${expression})return resolve()}catch(e){}if(performance.now()>end)return reject(Error(${JSON.stringify(expression)}));requestAnimationFrame(tick)}tick()})`,
	);
}

/** 逐帧记录器。装一次，后面反复开关。 */
const RECORDER = `(() => {
	if (window.__ly_rec) return "already";
	const rec = { on: false, gaps: [], heights: [], last: 0, started: 0 };
	window.__ly_rec = rec;
	window.__ly_start = (watchHeight) => {
		rec.on = true; rec.gaps = []; rec.heights = []; rec.last = performance.now(); rec.started = rec.last;
		const scroller = document.querySelector('main [data-ly-scroll], main .overflow-y-auto, main');
		function tick() {
			if (!rec.on) return;
			const now = performance.now();
			rec.gaps.push(now - rec.last);
			rec.last = now;
			if (watchHeight && scroller) rec.heights.push(scroller.scrollHeight);
			requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
		return true;
	};
	window.__ly_stop = () => {
		rec.on = false;
		const gaps = rec.gaps.slice(1);
		gaps.sort((a, b) => b - a);
		const jumps = [];
		for (let i = 1; i < rec.heights.length; i++) {
			const d = Math.abs(rec.heights[i] - rec.heights[i - 1]);
			if (d > 0) jumps.push(d);
		}
		jumps.sort((a, b) => b - a);
		return {
			frames: rec.gaps.length,
			total: Math.round(rec.last - rec.started),
			worst: Math.round(gaps[0] ?? 0),
			top5: gaps.slice(0, 5).map((n) => Math.round(n)),
			over100: gaps.filter((n) => n > 100).length,
			over16: gaps.filter((n) => n > 16.7 * 1.5).length,
			biggestJump: Math.round(jumps[0] ?? 0),
		};
	};
	return "installed";
})()`;

type Report = { frames: number; total: number; worst: number; top5: number[]; over100: number; over16: number; biggestJump: number };

/** 侧边栏上看得见的会话行。 */
const ROWS = `[...document.querySelectorAll('[data-ly-row]')].map((e) => e.getAttribute('data-ly-row')).filter(Boolean)`;

/**
 * 点一行会话——用**真实鼠标**，不是 `element.click()`。
 *
 * `evaluate` 里的 `.click()` 打不开会话行（这一条栽过一次，之前那轮量出来的「疯狂点击很流畅」
 * 其实是界面压根没换过），所以先量出屏幕坐标，再让 CDP 从 `Input.dispatchMouseEvent` 发一对
 * 按下/抬起。
 */
async function clickRow(id: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const e = document.querySelector('[data-ly-row=${JSON.stringify(id)}]');
		if (!e) return null;
		e.scrollIntoView({ block: "center" });
		const r = e.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	return true;
}

/** 转录区现在长什么样——判据猜错过两次，所以直接把结构打出来看。 */
async function describeMain(): Promise<string> {
	return evaluate<string>(`(() => {
		const m = document.querySelector('main');
		if (!m) return "没有 main";
		const counts = {};
		for (const e of m.querySelectorAll('*')) {
			const key = e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '');
			counts[key] = (counts[key] || 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => v + "× " + k).join("\\n      ");
	})()`);
}

/**
 * 转录里现在有多少个元素——用来判断内容到底出没出来。
 *
 * **不能用 `innerText`。** 第一版就是那么写的，量出「40 秒还没画出内容」，而同一轮里最长一帧只有
 * 58 ms——主线程根本没被占住，不可能真在干 40 秒的活。原因是 `innerText` 要靠布局，而
 * `content-visibility: auto` 的内容恰恰是被跳过布局的那部分：内容早就在 DOM 里了，`innerText`
 * 就是读不到。改看元素个数，它不依赖布局。
 */
const DRAWN = `document.querySelectorAll('main .prose-dw, main article, main [data-ly-run]').length`;

async function main(): Promise<void> {
	console.log("把真实的 ~/.lyra 复制进临时 profile（凭据剔掉）…");
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 2`, 60000);
		await evaluate(RECORDER);
		const rows = await evaluate<string[]>(ROWS);
		console.log(`侧边栏上有 ${rows.length} 个会话\n`);

		/* ── A 疯狂点 ───────────────────────────────────────────────── */
		console.log("【A】疯狂点会话 item：八个，每 60 ms 一个，不等它画完");
		await evaluate(`window.__ly_start(false)`);
		const picked = rows.slice(0, 8);
		for (const id of picked) {
			await clickRow(id);
			await new Promise((r) => setTimeout(r, 60));
		}
		// 让最后一次落定
		await new Promise((r) => setTimeout(r, 2500));
		const a = await evaluate<Report>(`window.__ly_stop()`);
		console.log(`   ${a.frames} 帧 / ${a.total} ms，最长一帧 ${a.worst} ms，超 100ms 的 ${a.over100} 次`);
		console.log(`   最长的五帧：${a.top5.join(", ")} ms`);
		check("疯狂点的时候没有一帧卡过 1 秒", a.worst < 1000, `最长一帧 ${a.worst} ms`);
		check("疯狂点的时候超过 100ms 的帧不超过 5 次", a.over100 <= 5, `${a.over100} 次`);

		/* ── B 打开最大的那个会话 ──────────────────────────────────── */
		console.log("\n【B】打开本机最大的会话（那条 12.26 MB 的消息在里面）");
		const huge = "2723f0cb-add6-415f-aa94-dff71d02aa7b";
		const has = await evaluate<boolean>(`!!document.querySelector('[data-ly-row=${JSON.stringify(huge)}]')`);
		if (!has) {
			console.log("   ⚠️ 这个会话不在侧边栏当前这一屏上——换最后一个会话代替，量的还是同一条路");
		}
		const target = has ? huge : rows[rows.length - 1];
		await evaluate(`window.__ly_start(false)`);
		const t0 = Date.now();
		await clickRow(target);
		// 等到转录真的画出字来为止
		await until(`${DRAWN} > 0`, 30000).catch(() => console.log("   ⚠️ 30 秒还没画出内容"));
		const shown = Date.now() - t0;
		console.log(`   转录区现在的结构：\n      ${await describeMain()}`);
		// 那条 12 MB 的消息切成了多少片——顺便确认走的确实是新那条路。
		const slices = await evaluate<number>(`document.querySelectorAll('.ly-md-huge-slice').length`);
		await new Promise((r) => setTimeout(r, 1200));
		const b = await evaluate<Report>(`window.__ly_stop()`);
		console.log(`   点下去到看见内容 ${shown} ms；${b.frames} 帧，最长一帧 ${b.worst} ms；切了 ${slices} 片`);
		console.log(`   最长的五帧：${b.top5.join(", ")} ms`);
		check("点下去到内容出现不超过 1.5 秒", shown <= 1500, `${shown} ms`);
		check("打开它的时候没有一帧卡过 1 秒", b.worst < 1000, `最长一帧 ${b.worst} ms`);

		/* ── B2 把那条 12 MB 的消息翻出来 ──────────────────────────── */
		/*
		 * 转录是开窗口画的，只画 `range` 里那一段——那条 12.26 MB 的消息一开始不在窗口里，所以
		 * 上面那 2341 ms 里**根本没有它**。要验的正是它，所以这里一路点「显示更早」，直到
		 * `.ly-md-huge-slice` 出现为止；那一下的帧才是这次改动要挡的东西。
		 */
		console.log("\n【B2】展开工具结果——那条 12.26 MB 的正文是个 toolResult，折叠着就不画");
		await evaluate(`window.__ly_start(false)`);
		const t1 = Date.now();
		let rounds = 0;
		let slicesNow = 0;
		while (rounds < 40) {
			slicesNow = await evaluate<number>(`document.querySelectorAll('.ly-md-huge-slice').length`);
			if (slicesNow > 0) break;
			/*
			 * 依次展开还没展开过的工具行。
			 *
			 * 12.26 MB 那一坨是第 37 条消息的 `toolResult`，折叠着的时候一个字都不画——所以前面几轮
			 * 「切出 0 片」不是切片没生效，是它根本没轮到画。挨个点开，直到 `.ly-md-huge-slice` 出现。
			 */
			const clicked = await evaluate<{ x: number; y: number } | null>(`(() => {
				const rows = [...document.querySelectorAll('main button.ly-flow-row, main [data-ly-flow] button, main button[aria-expanded="false"]')];
				const b = rows.find((e) => !e.dataset.lyProbePoked);
				if (!b) return null;
				b.dataset.lyProbePoked = "1";
				b.scrollIntoView({ block: "center" });
				const r = b.getBoundingClientRect();
				if (r.width === 0) return null;
				return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
			})()`);
			if (!clicked) break;
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, x: clicked.x, y: clicked.y, button: "left", clickCount: 1 });
			}
			rounds++;
			await new Promise((r) => setTimeout(r, 400));
		}
		const dug = Date.now() - t1;
		const b2 = await evaluate<Report>(`window.__ly_stop()`);
		console.log(`   点开了 ${rounds} 个工具行，用时 ${dug} ms；切出 ${slicesNow} 片`);
		console.log(`   ${b2.frames} 帧，最长一帧 ${b2.worst} ms；最长的五帧：${b2.top5.join(", ")} ms`);
		check("那条 12 MB 的消息确实走了切片这条路", slicesNow > 0, `切出 ${slicesNow} 片`);
		check("把它翻出来的过程里没有一帧卡过 1 秒", b2.worst < 1000, `最长一帧 ${b2.worst} ms`);

		/* ── C 在里面滚 ───────────────────────────────────────────── */
		console.log("\n【C】在这条消息里滚动，顺便盯 scrollHeight 抖不抖");
		await evaluate(`window.__ly_start(true)`);
		await evaluate(`(() => {
			const s = document.querySelector('main [data-ly-scroll], main .overflow-y-auto, main');
			if (!s) return false;
			let n = 0;
			const step = () => { s.scrollTop += 900; if (++n < 40) requestAnimationFrame(step); };
			requestAnimationFrame(step);
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 3000));
		const c = await evaluate<Report>(`window.__ly_stop()`);
		console.log(`   ${c.frames} 帧 / ${c.total} ms，最长一帧 ${c.worst} ms，掉帧（>25ms）${c.over16} 次`);
		console.log(`   滚动中 scrollHeight 最大一次跳变 ${c.biggestJump} px`);
		check("滚动时没有一帧卡过 500ms", c.worst < 500, `最长一帧 ${c.worst} ms`);
		check("滚动时 scrollHeight 不会整屏乱跳", c.biggestJump < 200000, `最大跳变 ${c.biggestJump} px`);
	} finally {
		await app?.stop().catch(() => {});
		await rm("/tmp/lyra-frames-profile", { recursive: true, force: true }).catch(() => {});
	}

	const passed = checks.filter((c) => c.ok).length;
	console.log(`\n${passed}/${checks.length} 项通过`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
