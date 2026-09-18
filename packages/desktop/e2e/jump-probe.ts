/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 「点一下就感觉在跳」——跳的到底是什么。
 *
 * 同一句抱怨底下有两种完全不同的病，修法相反：
 *
 *   1. **点中的那个东西自己跑了**。展开区在按钮上方，一展开就把按钮往下推，手指还停在原处，
 *      按钮已经不在那儿了。这是布局顺序的问题。
 *   2. **整页在动**。展开让内容变高，滚动容器跟着调 `scrollTop`，读者正在看的那一段平移了。
 *      这是滚动锚定的问题。
 *
 * 分不开这两样就会修错边。所以这里按绘制帧记：每一帧都读按钮的 y、滚动容器的 scrollTop，以及
 * 按钮上方某个参照物的 y。三条曲线各自动没动，答案就出来了。
 *
 * 用法：node --experimental-strip-types e2e/jump-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9700;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/*
 * 逐帧记三条：目标自己的 y、滚动容器的 scrollTop、参照物的 y。
 *
 * 参照物取目标上方最近的那个块级元素——它不该动。它动了就说明整页在平移，而不是目标被推走。
 */
const TRACK = `((selectorText) => {
	const pick = () => [...document.querySelectorAll('button')].find((el) => new RegExp(selectorText).test(el.innerText || ''));
	const target = pick();
	if (!target) return false;
	const scroller = target.closest('.ly-scroll-view');
	const anchor = target.closest('section') || target.parentElement;
	const out = { frames: [], done: false, label: (target.innerText || '').slice(0, 20) };
	window.__jump = out;
	/*
	 * 抓住按下的那一个元素，不要每帧按文案重新找。
	 *
	 * 展开之后按钮上的字会从「再显示 1 个文件」变成「收起」，正则当场失配，于是量出来的是
	 * null——第一版就这样，把「按钮好好待在原地」印成了「按钮不见了」。要跟的是那个 DOM 节点。
	 */
	const read = () => {
		const now = target.isConnected ? target : pick();
		const box = now ? now.getBoundingClientRect() : null;
		const ab = anchor ? anchor.getBoundingClientRect() : null;
		return {
			y: box ? Math.round(box.top) : null,
			h: box ? Math.round(box.height) : null,
			top: scroller ? Math.round(scroller.scrollTop) : null,
			anchorY: ab ? Math.round(ab.top) : null,
			anchorH: scroller ? Math.round(scroller.scrollHeight) : null,
			open: now ? now.getAttribute('aria-expanded') : null,
		};
	};
	const tick = () => {
		out.frames.push(read());
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})(SELECTOR)`;

interface Frame {
	y: number | null;
	h: number | null;
	top: number | null;
	anchorY: number | null;
	anchorH: number | null;
	open: string | null;
}

/* `null` 才是「这一帧没读到」。y 本来就可以是负数（元素在视口上方），拿 <0 当哨兵会把真实位移滤没。 */
function spread(values: (number | null)[]): number {
	const live = values.filter((v): v is number => v !== null);
	if (live.length < 2) return 0;
	return Math.max(...live) - Math.min(...live);
}

/*
 * 先把它收回去，再量展开。
 *
 * 折叠状态会跨用例留着：上一条点开的，下一条点下去就是收起，而收起不长高——`scrollTop` 自然
 * 一动不动，探针把「什么也没发生」印成了绿。测的必须是展开那一下。
 */
async function collapseFirst(pattern: string): Promise<boolean> {
	const wasOpen = await evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(pattern)}).test(el.innerText || ''));
		if (!b) return false;
		if (b.getAttribute('aria-expanded') !== 'true') return false;
		b.click();
		return true;
	})()`);
	if (wasOpen) await new Promise((r) => setTimeout(r, 700));
	return wasOpen;
}

async function clickAndTrack(pattern: string, label: string): Promise<void> {
	await collapseFirst(pattern);
	/*
	 * 先把按钮滚进视野，等它停稳，**然后**才挂逐帧记录。
	 *
	 * 反过来的话，`scrollIntoView` 自己那一下会被记成「点击引起的位移」——第一版就是这样量出
	 * 1916px 的假跳动，而那 1916px 是探针自己滚的。
	 */
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(pattern)}).test(el.innerText || ''));
		if (!b) return null;
		b.scrollIntoView({ block: "center" });
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) {
		console.log(`\n### ${label}\n  页面上没有匹配 /${pattern}/ 的按钮`);
		return;
	}
	await new Promise((r) => setTimeout(r, 500));
	const armed = await evaluate<boolean>(TRACK.replace("SELECTOR", JSON.stringify(pattern)));
	if (!armed) {
		console.log(`\n### ${label}\n  挂记录时按钮不见了`);
		return;
	}
	await new Promise((r) => setTimeout(r, 120));
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await new Promise((r) => setTimeout(r, 900));
	await evaluate(`(() => { if (window.__jump) window.__jump.done = true; return true; })()`);
	const shot = await evaluate<{ frames: Frame[]; label: string }>(
		`(() => ({ frames: window.__jump.frames, label: window.__jump.label }))()`,
	);
	const f = shot.frames;
	if (!f.length) return;
	const moved = spread(f.map((x) => x.y));
	const scrolled = spread(f.map((x) => x.top));
	const grew = spread(f.map((x) => x.anchorH));
	console.log(`\n### ${label}  「${shot.label.replace(/\n/g, " ")}」`);
	console.log(`  记了 ${f.length} 帧，转录长高 ${grew}px，aria-expanded ${f[0]?.open} → ${f[f.length - 1]?.open}`);
	console.log(`  点中的东西走了 ${moved}px   (${f[0]?.y} → ${f[f.length - 1]?.y})`);
	console.log(`  scrollTop 变了 ${scrolled}px`);
	/*
	 * 判据只有一条：手指底下那个东西动没动。
	 *
	 * 周围的内容当然要动——展开区就在按钮上方，它撑开多少，上面那截就得让出多少，`scrollTop`
	 * 跟着补偿同样的量，这正是锚定在工作。拿「参照物动了」当病症会把修好的样子报成没修。
	 */
	if (moved <= 4) {
		console.log(`  判定：✅ 点中的东西留在原处${scrolled > 4 ? `（scrollTop 补了 ${scrolled}px 抵掉长高）` : ""}。`);
	} else {
		console.log(`  判定：❌ 点中的东西跑了 ${moved}px，手指还停在原处。`);
	}
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		// 开一个带「已编辑 N 个文件」卡片的会话。
		const opened = await evaluate<string>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-row]')];
			const row = rows.find((r) => /整理图片需求到文档/.test(r.innerText || '')) || rows[0];
			if (!row) return '';
			row.scrollIntoView({ block: 'center' });
			return (row.innerText || '').split('\\n')[0];
		})()`);
		const at = await evaluate<{ x: number; y: number } | null>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-row]')];
			const row = rows.find((r) => /整理图片需求到文档/.test(r.innerText || '')) || rows[0];
			if (!row) return null;
			const r = row.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (at) {
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
			}
		}
		console.log(`开了「${opened}」`);
		await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 25000).catch(() => {});
		await new Promise((r) => setTimeout(r, 900));

		await clickAndTrack("再显示 \\d+ 个文件|Show \\d+ more files", "在底部展开文件列表");
		await clickAndTrack("调用工具|使用了工具|Used \\d+ tool", "在底部展开工具组");

		/*
		 * 真正要命的那一种：读者停在历史里，点开手边的一个折叠区。
		 *
		 * 在底部时「跟随底部」和「锚定」碰巧一个效果，谁坏了都看不出来。往回滚一段再点，跟随
		 * 底部就会把人一路甩到转录末尾——修好没修好，这一条才分得开。
		 */
		await evaluate(`(() => {
			const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
			if (el) { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight * 3); el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true })); }
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 500));
		await clickAndTrack("调用工具|使用了工具|Used \\d+ tool", "停在历史里展开工具组");
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
