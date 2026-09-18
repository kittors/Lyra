/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 缓存命中到底能省多少——这一条决定要不要做悬停预取。
 *
 * 首帧中位 39ms。预取能省掉的只有「磁盘 + IPC」那一段，省不掉渲染。两者各占多少，看同一批
 * 会话走两遍：第一遍全是冷的（要读盘、要过 IPC、要建 `toolRuns`、要解析 markdown），第二遍
 * 全在 `sessionCache` 里（只剩渲染）。差值就是预取的上限。
 *
 * 差值小的话，预取是拿额外的磁盘 IO 去换一个量不出来的收益，不做才是对的。
 *
 * 用法：node --experimental-strip-types e2e/warm-vs-cold-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9708;
const HOW_MANY = 8;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/* 转录此刻的样子——换掉了就是新会话画出来了。 */
const SIG = `(() => {
	const runs = document.querySelectorAll('[data-ly-run]');
	const pane = document.querySelector('[data-dock-pane="conversation"]');
	return runs.length + '|' + ((pane && pane.innerText) || '').slice(0, 120);
})()`;

const WATCH = `((was) => {
	const out = { start: performance.now(), firstPaint: null, done: false };
	window.__wc = out;
	const tick = () => {
		if (out.firstPaint === null && ${SIG} !== was) out.firstPaint = Math.round(performance.now() - out.start);
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})(WAS)`;

async function switchTo(title: string): Promise<number | null> {
	const was = await evaluate<string>(SIG);
	await evaluate(WATCH.replace("WAS", JSON.stringify(was)));
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const rows = [...document.querySelectorAll('[data-ly-row]')];
		const row = rows.find((r) => (r.innerText || '').split('\\n')[0].trim() === ${JSON.stringify(title)});
		if (!row) return null;
		row.scrollIntoView({ block: "center" });
		const r = row.getBoundingClientRect();
		if (r.width === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return null;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`${SIG} !== ${JSON.stringify(was)}`, 20000).catch(() => {});
	await new Promise((r) => setTimeout(r, 450));
	await evaluate(`(() => { if (window.__wc) window.__wc.done = true; return true; })()`);
	return evaluate<number | null>(`(() => window.__wc.firstPaint)()`);
}

function stat(xs: number[]): string {
	if (!xs.length) return "-";
	const s = [...xs].sort((a, b) => a - b);
	return `中位 ${s[Math.floor(s.length / 2)]}ms，最慢 ${s[s.length - 1]}ms`;
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		for (let i = 0; i < 10; i++) {
			const more = await evaluate<boolean>(`(() => {
				const b = [...document.querySelectorAll("button")].find((el) => /展开显示|Show \\d+ more/.test(el.innerText || ""));
				if (!b) return false;
				b.click();
				return true;
			})()`);
			if (!more) break;
			await new Promise((r) => setTimeout(r, 200));
		}
		const titles = await evaluate<string[]>(
			`[...document.querySelectorAll('[data-ly-row]')].map((r) => (r.innerText || '').split('\\n')[0].trim()).filter(Boolean)`,
		);
		const pick = titles.slice(0, HOW_MANY);
		console.log(`量 ${pick.length} 个会话，各走两遍\n`);

		const cold: number[] = [];
		for (const t of pick) {
			const ms = await switchTo(t);
			if (ms != null) cold.push(ms);
		}
		// 第二遍：这些会话现在都在 sessionCache 里了，读盘和 IPC 都省掉，只剩渲染。
		const warm: number[] = [];
		for (const t of pick) {
			const ms = await switchTo(t);
			if (ms != null) warm.push(ms);
		}

		console.log(`第一遍（冷，要读盘 + 过 IPC + 建 toolRuns + 解析）  ${stat(cold)}   n=${cold.length}`);
		console.log(`第二遍（热，全在 sessionCache 里，只剩渲染）        ${stat(warm)}   n=${warm.length}`);
		const cm = [...cold].sort((a, b) => a - b)[Math.floor(cold.length / 2)] ?? 0;
		const wm = [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)] ?? 0;
		console.log(`\n差值 ${cm - wm}ms —— 这就是悬停预取能省的上限；剩下 ${wm}ms 是渲染，预取碰不到。`);
		console.log(`判定：${cm - wm >= 16 ? "值得做预取（省得下至少一帧）" : "不值得——省下的还不到一帧，代价是鼠标扫过列表就读盘"}`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
