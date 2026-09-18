/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一张缩略图要主进程付多少钱，以及付过的钱下次还付不付。
 *
 * `serveParkedMedia` 收到 `?thumb=128` 就地做三件事：`createFromBuffer` 解码整张原图、
 * `resize` 缩到 128、`toPNG` 再编码回去。三件都是同步的，都跑在主进程上。这个探针问的是：
 *
 *   1. 一张要多久，几十张一起要多久
 *   2. 这段时间主进程还答不答话（每 25ms 打一次最便宜的 IPC，记最长往返）
 *   3. 同一个地址再请求一次，是走缓存还是从头再算一遍
 *
 * 第 3 条决定了修法。要是每次都从头算，那么向上翻页让几十张图同时进视口时，主进程就会被
 * 占住几百毫秒——那期间整个应用一句话都不答，而这正是「图片一多就卡」的形状。
 *
 * 用法：node --experimental-strip-types e2e/thumb-cost-probe.ts
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9699;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

/*
 * 一轮：把这些地址挂成 img，等它们全部 complete，同时每 25ms 打一次 IPC。
 *
 * 判据是 `naturalWidth > 0`，不是 `onload` 也不是 `decode()`——前者是浏览器记的账，后两个
 * 在这个页面上试过，一个不够准一个根本不兑现。
 */
const ROUND = `(async (urls, tag) => {
	const out = { tag: tag, pings: [], start: performance.now(), done: 0, failed: 0 };
	let stop = false;
	const ping = async () => {
		while (!stop) {
			const at = performance.now();
			try { await window.lyra.sessions.running('probe-ping'); } catch (e) {}
			out.pings.push(Math.round(performance.now() - at));
			await new Promise((r) => setTimeout(r, 25));
		}
	};
	ping();
	const host = document.createElement('div');
	host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden';
	document.body.appendChild(host);
	await Promise.all(urls.map((url) => new Promise((resolve) => {
		const img = new Image();
		img.onload = () => { out.done++; resolve(null); };
		img.onerror = () => { out.failed++; resolve(null); };
		img.src = url;
		host.appendChild(img);
	})));
	out.elapsed = Math.round(performance.now() - out.start);
	stop = true;
	await new Promise((r) => setTimeout(r, 60));
	host.remove();
	return out;
})(URLS, TAG)`;

interface Round {
	tag: string;
	pings: number[];
	elapsed: number;
	done: number;
	failed: number;
}

async function round(urls: string[], tag: string): Promise<Round> {
	return evaluate<Round>(ROUND.replace("URLS", JSON.stringify(urls)).replace("TAG", JSON.stringify(tag)));
}

function report(r: Round, note = ""): void {
	const pings = [...r.pings].sort((a, b) => a - b);
	const worst = pings[pings.length - 1] ?? 0;
	console.log(
		`  ${r.tag.padEnd(22)} ${String(r.elapsed).padStart(5)}ms  画出 ${r.done}/${r.done + r.failed}` +
			`   主进程 ping 中位 ${pings[Math.floor(pings.length / 2)] ?? 0}ms 最慢 ${String(worst).padStart(4)}ms ${worst > 200 ? "← 哑了" : ""} ${note}`,
	);
}

async function main(): Promise<void> {
	const media = join(homedir(), ".lyra", "session-media");
	const names = (await readdir(media).catch(() => [])).filter((n) => /\.(png|jpg|webp)$/.test(n));
	if (names.length === 0) {
		console.log("session-media 里没有图，先打开一个带图的会话让它外置出来");
		return;
	}
	console.log(`session-media 里有 ${names.length} 张图\n`);

	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await evaluate(`new Promise((r) => { const t = () => document.querySelector('[data-ly-row]') ? r() : requestAnimationFrame(t); t(); })`);

		const thumb = (n: string, salt = "") => `ly-media://m/${n}?thumb=128${salt}`;
		const full = (n: string) => `ly-media://m/${n}`;

		// 一张，看单价。
		report(await round([thumb(names[0]!, "&r=1")], "1 张缩略图"));

		// 全部，冷的。每张都带不同的盐，保证没有一张能命中缓存。
		const cold = names.map((n, i) => thumb(n, `&r=cold${i}`));
		report(await round(cold, `${names.length} 张（全冷）`));

		// 同一批地址再来一次，看缓存。
		report(await round(cold, `${names.length} 张（同地址重来）`), "地址一样");

		// 同一批图，换盐——字节一样，但地址变了。
		const resalted = names.map((n, i) => thumb(n, `&r=warm${i}`));
		report(await round(resalted, `${names.length} 张（换个地址）`), "同样的图，新地址");

		// 不缩略，直接取原图：量的是「不解码不缩放」那条路。
		report(await round(names.map(full), `${names.length} 张原图`), "不走 resize");

		/*
		 * 缓存到底落没落盘——这一条决定它跨不跨重启。
		 *
		 * 上面那几轮就算全是 0ms，也可能只是 Chromium 在内存里记着；只有盘上有文件，下次开应用
		 * 才不用重付。
		 */
		const thumbs = join(app.home, "session-media", "thumbs");
		const written = await readdir(thumbs).catch(() => []);
		console.log(`\n  盘上的缩略图：${written.length} 个  ${thumbs}`);
		if (written.length) console.log(`    例如 ${written.slice(0, 2).join("、")}`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
