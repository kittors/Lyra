/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * S5 的显微镜：把 tile 里的面板拖到另一屏，面板是**哪一帧**没的。
 *
 * `split-scenarios-probe` 只能说「拖完就不见了」。要修得知道它消失在拖拽的哪一步——按下那一
 * 刻（`preview(rest, …, null)` 会先把它摘掉）、越过屏边界那一刻，还是松手那一刻（`endDrag`
 * 该用 `before` 复原却没复原）。三种对应三个完全不同的改法。
 *
 * 所以逐帧记：终端面板在不在、在哪一屏、两屏各自的 pane dock 容器还在不在。指针位置一起记，
 * 这样能把消失的那一帧和指针越界的那一帧对上。
 *
 * 用法：node --experimental-strip-types e2e/pane-drag-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9712;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 20000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openFirstRow(): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const row = document.querySelector('[data-ly-row]');
		if (!row) return null;
		row.scrollIntoView({ block: 'center' });
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`document.querySelector('[data-dock-pane="conversation"]') !== null`).catch(() => {});
	await wait(900);
}

async function rowMenu(index: number, item: string): Promise<string> {
	return evaluate<string>(`(async () => {
		const row = document.querySelectorAll('[data-ly-row]')[${index}];
		if (!row) return 'no row';
		const r = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
		await new Promise((res) => setTimeout(res, 400));
		const open = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式/.test(el.innerText || ''));
		if (!open) return 'no submenu';
		open.click();
		await new Promise((res) => setTimeout(res, 400));
		const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(item)});
		if (!hit) return 'no item';
		hit.click();
		return 'clicked';
	})()`);
}

/**
 * 拖拽，但每一步都记一帧。
 *
 * 指针事件派给把手（拖拽是它起的头），坐标按整屏算——落点判定读的是 clientX/Y，不是相对把手
 * 的偏移。步子走得细一点，好让「越过屏边界」自己占到一帧。
 */
const DRAG_AND_WATCH = `(async (toX, toY, steps) => {
	const log = [];
	const look = (tag, px, py) => {
		const el = document.querySelector('[data-dock-pane="terminal"]');
		const tile = el ? el.closest('[data-ly-split-pane]') : null;
		const docks = [...document.querySelectorAll('[data-ly-pane-dock]')].map((d) => (d.dataset.lyPaneDock || '').slice(0, 8));
		log.push({
			tag: tag,
			p: Math.round(px) + "," + Math.round(py),
			terminal: el ? (tile ? 'tile:' + (tile.dataset.lySplitPane || '?').slice(0, 8) : 'window') : null,
			docks: docks.join("|"),
		});
	};
	const grip = document.querySelector('[data-dock-grip="terminal"]');
	if (!grip) return { error: "没有终端的拖动把手" };
	const box = grip.getBoundingClientRect();
	const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	/*
	 * 按下派给把手，移动和松手派给 window。
	 *
	 * 监听本来就挂在 window 上。而拖拽一起头，面板就被从树里摘掉了，把手那个元素跟着从 DOM
	 * 消失——继续往它身上派事件等于派给一个游离节点，冒泡到不了 window，收尾那一步永远不跑。
	 *
	 * 这段注释里一个反引号都不能有：它整个还要在外层模板串里活一遍。
	 * 第一版就是这样，量出一个「面板永久消失」的假象。真实的拖拽里 Chromium 会在捕获目标消失
	 * 时隐式释放捕获，把后续事件照常送到 window。
	 */
	const send = (type, x, y) => (type === 'pointerdown' ? grip : window).dispatchEvent(new PointerEvent(type, {
		pointerId: 1, isPrimary: true, bubbles: true, cancelable: true,
		clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
	}));
	const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

	look("按下前", from.x, from.y);
	send('pointerdown', from.x, from.y);
	await frame();
	look("按下后", from.x, from.y);
	for (let i = 1; i <= steps; i++) {
		const x = from.x + (toX - from.x) * i / steps;
		const y = from.y + (toY - from.y) * i / steps;
		send('pointermove', x, y);
		await frame();
		look("移动" + i, x, y);
	}
	send('pointerup', toX, toY);
	await frame();
	look("松手", toX, toY);
	await new Promise((r) => setTimeout(r, 500));
	look("松手后 0.5s", toX, toY);
	return { log: log, from: Math.round(from.x) + "," + Math.round(from.y) };
})(TO_X, TO_Y, 10)`;

interface Step { tag: string; p: string; terminal: string | null; docks: string }

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await wait(600);
		await openFirstRow();
		console.log(`分屏：${await rowMenu(1, "分屏")}`);
		await wait(1600);

		// 第一屏开终端
		const opened = await evaluate<boolean>(`(() => {
			const tile = document.querySelectorAll('[data-ly-split-pane]')[0];
			if (!tile) return false;
			const b = [...tile.querySelectorAll('header button')].find((el) => /终端/.test(el.getAttribute('aria-label') || ''));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		await wait(1400);
		console.log(`第一屏开终端：${opened}`);
		// 把 store 里那几行临时日志接过来，和逐帧的 DOM 对照着看
		await evaluate(`(() => {
			if (window.__hooked) return true;
			window.__hooked = true;
			window.__logs = [];
			const orig = console.log.bind(console);
			console.log = (...args) => {
				const first = String(args[0] ?? "");
				if (first.indexOf("[probe]") === 0) window.__logs.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
				orig(...args);
			};
			return true;
		})()`);

		const tiles = await evaluate<{ i: number; x: number; y: number; w: number; h: number }[]>(
			`[...document.querySelectorAll('[data-ly-split-pane]')].map((el, i) => { const r = el.getBoundingClientRect(); return { i: i, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })`,
		);
		console.log(`两屏：${tiles.map((t) => `#${t.i} ${t.w}x${t.h} @${t.x},${t.y}`).join("   ")}`);
		if (tiles.length < 2) { console.log("没分成两屏"); return; }

		/*
		 * 在**同一屏内部**拖，这才是人说的那个动作。
		 *
		 * 拖到另一屏本来就该被拒（那是别人的地盘），测它只能测出「拒绝得对不对」。要问的是
		 * 「在自己这一屏里换个位置行不行」——往这一屏的上四分之一拖，期望终端从下半屏挪到上半屏。
		 */
		const target = tiles[0]!;
		const to = { x: target.x + Math.round(target.w / 2), y: target.y + Math.round(target.h / 4) };
		console.log(`\n在第一屏内部把终端往上拖 (${to.x},${to.y})：\n`);
		const result = await evaluate<{ log?: Step[]; from?: string; error?: string }>(
			DRAG_AND_WATCH.replace("TO_X", String(to.x)).replace("TO_Y", String(to.y)),
		);
		if (result.error) { console.log(result.error); return; }
		console.log(`  起点 ${result.from}`);
		let last: string | null | undefined = undefined;
		for (const s of result.log ?? []) {
			const changed = s.terminal !== last;
			console.log(`  ${s.tag.padEnd(10)} 指针 ${s.p.padEnd(10)} 终端 ${String(s.terminal ?? "不存在").padEnd(16)} pane-dock=[${s.docks}] ${changed ? "  ← 变了" : ""}`);
			last = s.terminal;
		}
		const logs = await evaluate<string[]>(`window.__logs || []`);
		console.log(`\n  store 那边发生了什么：`);
		for (const l of logs) console.log(`    ${l}`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
