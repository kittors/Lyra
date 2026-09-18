/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一个会话里有一百多张图的时候，点开它到底在等什么。
 *
 * `session-switch-perf` 量的是文字第一帧：转录里出现了几条 run、开头一百来个字换了没有。
 * 图片不在那个判据里——缩略图还在转圈，它也算「画出来了」。而用户说的卡就是图片那一段。
 *
 * 这里量三样，都按画出来的结果算：
 *
 *   1. **每张缩略图从挂上去到 `decode()` 兑现**，也就是这张图真的可以画了
 *   2. **主进程这段时间还答不答话**：渲染进程每 50ms 打一次 IPC，记最长的一次往返。
 *      缩略图是 `nativeImage.createFromBuffer(...).resize(...).toPNG()`——同步的，跑在主进程上。
 *      一百张图就是一百次同步解码，主进程被占住的那几百毫秒里，整个应用一句话都不答。
 *   3. **冷读**：跑之前把 `.display.json` 删掉，否则量到的是上一次跑热的缓存。
 *
 * 第 2 条是判据。图片自己慢是「图片慢」，主进程跟着哑掉是「整个应用卡死」，而后者才是人说的那个卡。
 *
 * 用法：node --experimental-strip-types e2e/image-load-probe.ts
 */

import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9698;

/** 图最多的那几个会话，按 jsonl 里大 base64 的条数数。 */
const WANTED = [
	"对话窗口回弹跳动问题总结",
	"记录会话交互与输入框问题",
	"切换会话Item跳动问题",
	"整理图片需求到文档",
];

let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/** 把整个 profile 里的显示缓存清掉，让每一次点击都是冷读。 */
async function dropDisplayCaches(home: string): Promise<number> {
	const root = join(home, "sessions");
	let dropped = 0;
	for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!dir.isDirectory()) continue;
		for (const name of await readdir(join(root, dir.name)).catch(() => [])) {
			if (!name.endsWith(".display.json")) continue;
			await rm(join(root, dir.name, name), { force: true });
			dropped++;
		}
	}
	return dropped;
}

/*
 * 挂在点击之前：记下这一刻之后出现的每一张 ly-media 缩略图，等它 decode 兑现。
 *
 * `onload` 不够——它只说字节到了，解码还在后面，而解码正是主线程上那一段。`decode()` 兑现
 * 才是「这张图可以画了」。
 *
 * 同时每 50ms 往主进程打一次 ping。IPC 排在主进程的消息队列里，缩略图的同步解码也排在那里，
 * 所以 ping 的往返时间就是主进程被占住多久——量的是别人的等待，不是图片自己的耗时。
 */
const WATCH = `(() => {
	const out = { start: performance.now(), images: [], pings: [], longestFrame: 0, done: false };
	window.__img = out;
	const seen = new WeakSet();
	const sweep = () => {
		for (const el of document.querySelectorAll('img')) {
			if (seen.has(el)) continue;
			const src = el.currentSrc || el.src || '';
			if (src.indexOf('ly-media:') !== 0) continue;
			seen.add(el);
			const at = performance.now();
			const record = { src: src.slice(0, 70), at: Math.round(at - out.start), ready: null, err: '', w: 0, box: 0 };
			out.images.push(record);
			record.box = Math.round(el.getBoundingClientRect().width);
			el.decode().then(
				() => { record.ready = Math.round(performance.now() - out.start); record.w = el.naturalWidth; },
				(e) => { record.ready = -1; record.err = String(e && e.message || e).slice(0, 80); },
			);
		}
	};
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		const gap = now - last;
		if (gap > out.longestFrame) out.longestFrame = gap;
		last = now;
		sweep();
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	const ping = async () => {
		while (!out.done) {
			const at = performance.now();
			try { await window.lyra.sessions.running('probe-ping'); } catch (e) { /* 存不存在都行，量的是往返 */ }
			out.pings.push(Math.round(performance.now() - at));
			await new Promise((r) => setTimeout(r, 50));
		}
	};
	ping();
	return true;
})()`;

interface Shot {
	images: { src: string; at: number; ready: number | null; err: string; w: number; box: number }[];
	pings: number[];
	longestFrame: number;
	live: { src: string; complete: boolean; w: number; box: number; lazy: string }[];
	timed: { src: string; dur: number; size: number }[];
}

/** 侧边栏默认只铺开一部分，剩下的藏在「展开显示 N」后面。 */
async function expandShown(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		const clicked = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll("button")].find((el) => /展开显示|Show \\d+ more/.test(el.innerText || ""));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		if (!clicked) break;
		await new Promise((r) => setTimeout(r, 200));
	}
}

async function openAndWatch(title: string): Promise<Shot | null> {
	await evaluate(WATCH);
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const want = ${JSON.stringify(title)};
		const rows = [...document.querySelectorAll('[data-ly-row]')];
		const row = rows.find((r) => (r.innerText || '').includes(want));
		if (!row) return null;
		row.scrollIntoView({ block: "center" });
		const r = row.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return null;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	// 滚到底，把整段转录都走一遍——图片是懒加载的，不滚过去就不会有人请求它。
	await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 25000).catch(() => {});
	await new Promise((r) => setTimeout(r, 400));
	/*
	 * 先确认滚的是转录那一条，不是侧边栏。
	 *
	 * `.ly-scroll-view` 在这一页上不止一个；滚错了容器，图片当然一张都不会被请求，而探针会把
	 * 「我没滚到」报成「图片加载不出来」。
	 */
	const scroller = await evaluate<{ found: number; picked: number; height: number } | null>(`(() => {
		const all = [...document.querySelectorAll('.ly-scroll-view')];
		const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
		if (!el) return { found: all.length, picked: -1, height: 0 };
		return { found: all.length, picked: all.indexOf(el), height: Math.round(el.scrollHeight) };
	})()`);
	console.log(`  [滚动] 页面上 ${scroller?.found ?? 0} 个滚动容器，转录是第 ${scroller?.picked ?? -1} 个，内容高 ${scroller?.height ?? 0}px`);
	await evaluate(`(() => {
		const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
		if (el) el.scrollTop = 0;
		return true;
	})()`);
	for (let i = 0; i < 14; i++) {
		const at = await evaluate<number>(`(() => {
			const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
			if (!el) return -1;
			el.scrollTop = el.scrollTop + el.clientHeight * 0.85;
			el.dispatchEvent(new Event('scroll', { bubbles: true }));
			return Math.round(el.scrollTop);
		})()`);
		if (at < 0) break;
		await new Promise((r) => setTimeout(r, 280));
	}
	await new Promise((r) => setTimeout(r, 1200));
	await evaluate(`(() => { if (window.__img) window.__img.done = true; return true; })()`);
	/*
	 * 收尾时问的是浏览器自己的记账，不是我挂上去的回调。
	 *
	 * `decode()` 的 promise 在这里一个都没兑现过，而 `naturalWidth` 和资源计时是同步事实：
	 * 前者说这张图解出来多宽，后者说这次请求在网络栈里走了多久。挂钩子量出来的 0，和浏览器
	 * 记的账对不上时，该信的是账。
	 */
	return evaluate<Shot>(`(() => {
		const live = [...document.querySelectorAll('img')]
			.filter((el) => (el.currentSrc || el.src || '').indexOf('ly-media:') === 0)
			.map((el) => ({ src: (el.currentSrc || el.src).slice(0, 70), complete: el.complete, w: el.naturalWidth, box: Math.round(el.getBoundingClientRect().width), lazy: el.loading || '' }));
		const timed = performance.getEntriesByType('resource')
			.filter((e) => e.name.indexOf('ly-media:') === 0)
			.map((e) => ({ src: e.name.slice(0, 70), dur: Math.round(e.duration), size: e.encodedBodySize || 0 }));
		return { images: window.__img.images, pings: window.__img.pings, longestFrame: Math.round(window.__img.longestFrame), live: live, timed: timed };
	})()`);
}

function report(title: string, shot: Shot): void {
	const ready = shot.images.filter((i) => typeof i.ready === "number" && i.ready > 0);
	const failed = shot.images.filter((i) => i.ready === -1);
	const pending = shot.images.filter((i) => i.ready === null);
	const waits = ready.map((i) => (i.ready as number) - i.at).sort((a, b) => a - b);
	const pings = [...shot.pings].sort((a, b) => a - b);
	const worstPing = pings[pings.length - 1] ?? 0;
	const p50 = waits.length ? waits[Math.floor(waits.length / 2)] : 0;
	const p95 = waits.length ? waits[Math.floor(waits.length * 0.95)] : 0;
	console.log(`\n### ${title.slice(0, 32)}`);
	console.log(`  缩略图     挂上 ${shot.images.length} 张：画出来 ${ready.length}，失败 ${failed.length}，还在等 ${pending.length}`);
	if (ready.length) console.log(`  单张等待   中位 ${p50}ms，p95 ${p95}ms，最慢 ${waits[waits.length - 1] ?? 0}ms`);
	console.log(`  主进程     ping 中位 ${pings[Math.floor(pings.length / 2)] ?? 0}ms，最慢 ${worstPing}ms   ${worstPing > 300 ? "← 主进程这段时间是哑的" : ""}`);
	console.log(`  渲染进程   最长一帧 ${shot.longestFrame}ms`);
	const painted = shot.live.filter((i) => i.complete && i.w > 0);
	console.log(`  留在页上   ${shot.live.length} 张，其中解出来的 ${painted.length} 张${shot.live.some((i) => i.lazy === "lazy") ? "（有 loading=lazy）" : ""}`);
	if (shot.timed.length) {
		const durs = shot.timed.map((t) => t.dur).sort((a, b) => a - b);
		const bytes = shot.timed.reduce((sum, t) => sum + t.size, 0);
		console.log(`  实际请求   ${shot.timed.length} 次，耗时中位 ${durs[Math.floor(durs.length / 2)]}ms，最慢 ${durs[durs.length - 1]}ms，共 ${(bytes / 1048576).toFixed(1)} MB`);
		for (const slow of [...shot.timed].sort((a, b) => b.dur - a.dur).slice(0, 3)) {
			console.log(`    ${String(slow.dur).padStart(4)}ms  ${(slow.size / 1024).toFixed(0).padStart(5)} KB  ${slow.src}`);
		}
	} else {
		console.log(`  实际请求   0 次 ← 这些 img 根本没去取过`);
	}
	for (const one of shot.live.slice(0, 3)) {
		console.log(`    box=${one.box}px complete=${one.complete} natural=${one.w} loading=${one.lazy}  ${one.src.slice(0, 56)}`);
	}
}

async function main(): Promise<void> {
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedFromReal(home);
			const dropped = await dropDisplayCaches(home);
			console.log(`清掉 ${dropped} 份显示缓存，每次点击都是冷读`);
			const media = join(home, "session-media");
			const size = await stat(media).then(() => true).catch(() => false);
			console.log(`session-media ${size ? "在" : "不在"}`);
		},
	});
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await expandShown();
		for (const title of WANTED) {
			const shot = await openAndWatch(title);
			if (!shot) {
				console.log(`\n### ${title.slice(0, 32)}\n  侧边栏里没找到这一行`);
				continue;
			}
			report(title, shot);
			// 落盘单看：数字说图片没画出来，那就得亲眼确认屏幕上那一块是什么。
			const shot64 = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" }).catch(() => null);
			if (shot64?.data) {
				const file = join("/tmp", `lyra-img-${title.slice(0, 8).replace(/[^\w一-龥]/g, "")}.png`);
				await writeFile(file, Buffer.from(shot64.data, "base64"));
				console.log(`  截图       ${file}`);
			}
		}
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
