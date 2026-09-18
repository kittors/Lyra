/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 设置页换一章，内容是「进来」还是「跳一下」。
 *
 * 进场动画本来就要动——升起 6px 填入，那是设计。跳动是另一回事：内容先落在一个位置、再弹到
 * 另一个位置，或者滚动位置被悄悄改掉，读者的眼睛得重新找一遍。两者在录屏里像，在逐帧的数字
 * 里完全不像：前者是一条单调曲线，后者会掉头。
 *
 * 所以这里记每一帧的：内容块的 y、它的高度、滚动容器的 scrollTop，还有导航药丸的 y。然后问：
 *
 *   1. 内容的 y 是不是一路朝一个方向走完（单调），中间掉没掉头
 *   2. 最终停的位置，和这一章第一次画出来时差多少
 *   3. 换章时 scrollTop 有没有被动过
 *
 * 用法：node --experimental-strip-types e2e/settings-jump-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9701;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

const TRACK = `((wantView) => {
	const out = { frames: [], done: false, view: wantView };
	window.__sj = out;
	/*
	 * 只看**新**那一页，旧的那个不算。
	 *
	 * 每帧无条件读 [data-active="true"] 是错的：切换那一瞬读到的还是旧章节那个元素，两页各自的
	 * 位置被连成一条曲线，凭空多出一次「掉头」——第一版就这样把修好的样子报成了没修。传进来的是
	 * 点击前 active 的那个 view 名，见到它就当没读到。
	 *
	 * 这段注释里不写反引号：它整个还要在外层的模板串里活一遍，一个反引号就能把它截断。
	 */
	const read = () => {
		const page = [...document.querySelectorAll('.ly-settings-enter[data-active="true"]')].find((el) => el.getAttribute('data-view') !== wantView) || null;
		const scroller = page ? (page.querySelector('.ly-scroll-view') || page.closest('.ly-scroll-view')) : null;
		const pill = document.querySelector('.ly-settings-nav-pill');
		const first = page ? page.querySelector('h1, h2, [data-settings-title], p, div') : null;
		const fb = first ? first.getBoundingClientRect() : null;
		const pb = pill ? pill.getBoundingClientRect() : null;
		return {
			y: fb ? Math.round(fb.top * 10) / 10 : null,
			v: page ? page.getAttribute('data-view') : null,
			h: page ? Math.round(page.getBoundingClientRect().height) : null,
			top: scroller ? Math.round(scroller.scrollTop) : null,
			pillY: pb ? Math.round(pb.top * 10) / 10 : null,
		};
	};
	const tick = () => {
		out.frames.push(read());
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})(BEFORE_VIEW)`;

interface Frame {
	y: number | null;
	h: number | null;
	top: number | null;
	pillY: number | null;
	v: string | null;
}

function live(values: (number | null)[]): number[] {
	return values.filter((v): v is number => v !== null);
}

/** 掉头的次数：一条进场曲线应该一路朝一个方向走完，掉头就是跳。 */
function reversals(values: number[]): number {
	let turns = 0;
	let sign = 0;
	for (let i = 1; i < values.length; i++) {
		const delta = values[i]! - values[i - 1]!;
		if (Math.abs(delta) < 0.5) continue;
		const next = delta > 0 ? 1 : -1;
		if (sign !== 0 && next !== sign) turns++;
		sign = next;
	}
	return turns;
}

async function pick(labelPattern: string, label: string): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(labelPattern)}).test(el.innerText || ''));
		if (!b) return null;
		const r = b.getBoundingClientRect();
		if (r.width === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) {
		console.log(`\n### ${label}\n  左边找不到 /${labelPattern}/ 这一章`);
		return;
	}
	const before = await evaluate<string>(`(() => { const el = document.querySelector('.ly-settings-enter[data-active="true"]'); return el ? el.getAttribute('data-view') || '' : ''; })()`);
	await evaluate(TRACK.replace("BEFORE_VIEW", JSON.stringify(before)));
	await new Promise((r) => setTimeout(r, 100));
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await new Promise((r) => setTimeout(r, 1000));
	await evaluate(`(() => { if (window.__sj) window.__sj.done = true; return true; })()`);
	const shot = await evaluate<{ frames: Frame[] }>(`(() => ({ frames: window.__sj.frames }))()`);
	const ys = live(shot.frames.map((f) => f.y));
	const tops = live(shot.frames.map((f) => f.top));
	const pills = live(shot.frames.map((f) => f.pillY));
	if (!ys.length) {
		console.log(`\n### ${label}\n  没读到内容块`);
		return;
	}
	const travel = Math.max(...ys) - Math.min(...ys);
	const turns = reversals(ys);
	const scrolled = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
	console.log(`\n### ${label}`);
	console.log(`  记了 ${shot.frames.length} 帧`);
	console.log(`  内容走了 ${travel.toFixed(1)}px（${ys[0]} → ${ys[ys.length - 1]}），掉头 ${turns} 次`);
	console.log(`  药丸走了 ${pills.length ? (Math.max(...pills) - Math.min(...pills)).toFixed(1) : "-"}px`);
	console.log(`  scrollTop 变了 ${scrolled}px`);
	const seq = shot.frames.filter((f) => f.y !== null).slice(0, 6).map((f) => `${f.v}@${f.y}`);
	console.log(`  头几帧：${seq.join("  ")}`);
	if (turns === 0 && travel <= 12) console.log(`  判定：✅ 一路进来，没有掉头。`);
	else if (turns > 0) console.log(`  判定：❌ 中途掉头 ${turns} 次——内容先落在一处又弹到另一处，这就是「跳」。`);
	else console.log(`  判定：⚠️ 位移 ${travel.toFixed(1)}px，比一次进场该有的幅度大。`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		// 开设置：左下角那个齿轮。
		// 侧边栏最底下那一条（齿轮 + 供应商名），见 SidebarFoot。
		const opened = await evaluate<boolean>(`(() => {
			const foot = document.querySelector('.ly-sidebar-foot button');
			if (!foot) return false;
			foot.click();
			return true;
		})()`);
		if (!opened) {
			console.log("找不到打开设置的入口");
			return;
		}
		await until(`document.querySelector('.ly-settings-nav-pill') !== null`, 15000).catch(() => {});
		await new Promise((r) => setTimeout(r, 800));

		const chapters = await evaluate<string[]>(`[...document.querySelectorAll('.ly-settings-nav-pill ~ div button, [aria-current], nav button')].map((b) => (b.innerText || '').trim()).filter((t) => t && t.length < 12)`);
		console.log(`左边这些章：${chapters.slice(0, 14).join("、")}`);
		// 头两章，来回走一趟：第一次是「进来」，第三次是「回来」，两者该长得不一样。
		const [a, b] = [chapters[1], chapters[2]];
		if (!a || !b) { console.log("章节不够，走不了来回"); return; }
		for (const [name, label] of [[a, `第一次进「${a}」`], [b, `第一次进「${b}」`], [a, `回到「${a}」`]] as const) {
			await pick(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), label);
			await new Promise((r) => setTimeout(r, 400));
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
