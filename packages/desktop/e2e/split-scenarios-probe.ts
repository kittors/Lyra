/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 分屏 × 多窗口 × 浮动面板：把场景矩阵逐条跑一遍。
 *
 * 场景编号对应 `docs/architecture/split-window-conflicts.md` 那张表。每条只回答一个问题，
 * 而且判据都取自 DOM 或主进程的窗口列表，不问 store——store 说的是「我们以为放哪了」。
 *
 * 入口是 `split-entries-probe` 摸出来的：
 *   拖动把手    [data-dock-grip="<kind>"]
 *   分隔线      [role="separator"][aria-orientation]
 *   面板头按钮  aria-label 「在新窗口中打开」「全屏：X」「关闭X」
 *   tile 头按钮 aria-label 「终端 ⌃`」「浏览器 ⌘T」「Git ⌘⇧R」「面板」「关闭此屏」
 *   分屏/新窗口 右键会话行 →「打开方式」→「分屏」/「新窗口」
 *
 * 用法：node --experimental-strip-types e2e/split-scenarios-probe.ts [场景前缀]
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9711;
const ONLY = process.argv[2] ?? "";
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

// ---------------------------------------------------------------------------
// 读状态
// ---------------------------------------------------------------------------

interface Snap {
	/** 可见的 dock 面板：kind → 「落在哪」+ 尺寸。 */
	panes: Record<string, { at: string; w: number; h: number; x: number; y: number }>;
	tiles: string[];
	keys: string[];
}

const SNAP = `(() => {
	const panes = {};
	for (const el of document.querySelectorAll('[data-dock-pane]')) {
		const kind = el.dataset.dockPane;
		if (!kind) continue;
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
		const tile = el.closest('[data-ly-split-pane]');
		const r = el.getBoundingClientRect();
		panes[kind] = {
			at: tile ? 'tile:' + (tile.dataset.lySplitPane || '?').slice(0, 8) : 'window',
			w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
		};
	}
	const tiles = [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => (el.dataset.lySplitPane || '?').slice(0, 8));
	const keys = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k && (k.startsWith('dw:dock') || k.startsWith('ly:split') || k.indexOf('panedock') >= 0)) keys.push(k.slice(0, 24));
	}
	return { panes: panes, tiles: tiles, keys: keys.sort() };
})()`;

const snap = (): Promise<Snap> => evaluate<Snap>(SNAP);

/** 主进程眼里现在开着哪些窗口。 */
async function windows(): Promise<{ sessions: string[]; panels: { kind: string; scope: string }[] }> {
	return evaluate(`(async () => {
		if (!window.lyra?.windows?.list) return { sessions: [], panels: [] };
		const r = await window.lyra.windows.list();
		return { sessions: (r.sessions || []).map((s) => String(s).slice(0, 8)), panels: r.panels || [] };
	})()`);
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

async function clickLabel(re: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(re)}).test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

/** tile 标题栏上的按钮：第 n 屏的那一颗。 */
async function clickTileButton(tileIndex: number, re: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const tile = document.querySelectorAll('[data-ly-split-pane]')[${tileIndex}];
		if (!tile) return false;
		const b = [...tile.querySelectorAll('header button')].find((el) => new RegExp(${JSON.stringify(re)}).test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

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
 * 把一个面板从它的把手拖到某一点。
 *
 * 多步移动而不是一步跳过去：拖拽要越过阈值才开始，落点区域每次移动重算一遍——一步到位两样
 * 都测不到。`buttons: 1` 少了会被当成 hover。
 */
async function dragPane(kind: string, to: { x: number; y: number }): Promise<boolean> {
	return evaluate<boolean>(`(async () => {
		const grip = document.querySelector('[data-dock-grip="${kind}"]');
		if (!grip) return false;
		const box = grip.getBoundingClientRect();
		const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		const send = (type, x, y) => grip.dispatchEvent(new PointerEvent(type, {
			pointerId: 1, isPrimary: true, bubbles: true, cancelable: true,
			clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
		}));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		send('pointerdown', from.x, from.y);
		await frame();
		for (let i = 1; i <= 8; i++) {
			send('pointermove', from.x + (${to.x} - from.x) * i / 8, from.y + (${to.y} - from.y) * i / 8);
			await frame();
		}
		send('pointerup', ${to.x}, ${to.y});
		await frame();
		return true;
	})()`);
}

/** 拖某条分隔线，用来把相邻面板压到底线。 */
async function dragSplitter(index: number, dx: number, dy: number): Promise<boolean> {
	return evaluate<boolean>(`(async () => {
		const bar = document.querySelectorAll('[role="separator"]')[${index}];
		if (!bar) return false;
		const box = bar.getBoundingClientRect();
		const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		const send = (type, x, y) => bar.dispatchEvent(new PointerEvent(type, {
			pointerId: 2, isPrimary: true, bubbles: true, cancelable: true,
			clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
		}));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		send('pointerdown', from.x, from.y);
		await frame();
		for (let i = 1; i <= 10; i++) { send('pointermove', from.x + ${dx} * i / 10, from.y + ${dy} * i / 10); await frame(); }
		send('pointerup', from.x + ${dx}, from.y + ${dy});
		await frame();
		return true;
	})()`);
}

async function reload(): Promise<void> {
	await evaluate(`(() => { location.reload(); return true; })()`);
	await wait(4000);
	await until(`document.querySelector('[data-ly-split-pane]') !== null`, 25000).catch(() => {});
	await wait(1500);
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const results: { id: string; title: string; verdict: "ok" | "bad" | "skip"; note: string }[] = [];

function record(id: string, title: string, verdict: "ok" | "bad" | "skip", note: string): void {
	results.push({ id, title, verdict, note });
	const mark = verdict === "ok" ? "✅" : verdict === "bad" ? "❌" : "⏭️";
	console.log(`${mark} ${id} ${title}\n     ${note}`);
}

const wanted = (id: string): boolean => !ONLY || id.startsWith(ONLY);

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

/** 组 A：单屏 + 窗口 dock，先立基线——这些在分屏出现之前就该是对的。 */
async function groupA(): Promise<void> {
	if (wanted("S4")) {
		await clickLabel("浏览器");
		await wait(900);
		const before = await snap();
		const box = before.panes["browser"];
		if (!box) { record("S4", "拖动窗口 dock 里的面板换位", "skip", "浏览器面板没开出来"); }
		else {
			// 往转录的左半边拖，期望它换到左边去
			const target = { x: Math.round(before.panes["conversation"]!.x + 80), y: Math.round(before.panes["conversation"]!.y + 300) };
			await dragPane("browser", target);
			await wait(900);
			const after = await snap();
			const moved = after.panes["browser"] && Math.abs(after.panes["browser"].x - box.x) > 20;
			record("S4", "拖动窗口 dock 里的面板换位", moved ? "ok" : "bad",
				moved ? `浏览器从 x=${box.x} 挪到 x=${after.panes["browser"]!.x}` : `拖完没动（x 还是 ${after.panes["browser"]?.x}）`);
		}
	}

	if (wanted("S6")) {
		const before = await snap();
		await dragSplitter(0, -600, 0);
		await wait(700);
		const after = await snap();
		const b0 = before.panes["browser"], b1 = after.panes["browser"];
		const c1 = after.panes["conversation"];
		const floored = b1 && c1 && c1.w >= 200 && b1.w >= 200;
		record("S6", "窗口 dock 里把分隔线拖到底", floored ? "ok" : "bad",
			b1 ? `浏览器 ${b0?.w}→${b1.w}px，转录 ${c1?.w}px${floored ? "（两边都没被压穿）" : "（有一边低于 200px 的底线）"}` : "面板没了");
	}

	if (wanted("S8") || wanted("S10")) {
		const opened = await clickLabel("在新窗口中打开");
		await wait(1800);
		const w = await windows();
		const popped = w.panels.some((p) => p.kind === "browser");
		const gone = !(await snap()).panes["browser"];
		if (wanted("S8")) record("S8", "把窗口 dock 的面板弹成独立窗口", opened && popped && gone ? "ok" : "bad",
			`点到按钮=${opened}，主进程看到 panel 窗口=${JSON.stringify(w.panels)}，原位已腾空=${gone}`);
		if (wanted("S10")) {
			// 收回：主窗口这边没有按钮，靠 panel 窗口自己点。这里只能验「它还在不在」。
			record("S10", "从 panel 窗口收回", "skip", "收回按钮在 panel 窗口里，这个探针够不到它的 DOM");
		}
	}

	if (wanted("S12")) {
		const w = await windows();
		record("S12", "关掉 panel 窗口之后，面板回不回树里", "skip",
			`需要关掉另一个窗口才测得到；当前 panels=${JSON.stringify(w.panels)}`);
	}
}

/** 组 B：分屏之后，tile 自己的 dock。 */
async function groupB(): Promise<void> {
	console.log(`
分屏：${await rowMenu(1, "分屏")}`);
	await wait(1600);
	const two = await snap();
	if (two.tiles.length < 2) { record("S*", "分屏", "skip", `只有 ${two.tiles.length} 屏，组 B 全部跳过`); return; }

	if (wanted("S2")) {
		await clickTileButton(0, "终端");
		await wait(1200);
		const s = await snap();
		const at = s.panes["terminal"]?.at ?? "（没开出来）";
		const right = at.startsWith("tile:");
		record("S2", "从第一屏的标题栏开终端", right ? "ok" : "bad", `终端落在 ${at}，期望落在某个 tile 里`);
	}

	if (wanted("S5")) {
		const before = await snap();
		const t = before.panes["terminal"];
		const tiles = await evaluate<{ x: number; y: number }[]>(`[...document.querySelectorAll('[data-ly-split-pane]')].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })`);
		if (!t || tiles.length < 2) record("S5", "把 tile 里的面板拖到另一屏", "skip", "没有终端面板或不足两屏");
		else {
			await dragPane("terminal", tiles[1]!);
			await wait(1000);
			const after = await snap();
			const now = after.panes["terminal"]?.at ?? "（不见了）";
			const changed = now !== t.at;
			/*
			 * 不见了的话，再点一次那一屏的「终端」：
			 * 开出来 = 树里真的没有它了（被删）；关掉 = 树里还在，只是没画出来。
			 * 两种的修法完全不同，不分开就只能猜。
			 */
			let why = "";
			if (!after.panes["terminal"]) {
				await clickTileButton(0, "终端");
				await wait(900);
				const back = await snap();
				why = back.panes["terminal"] ? "（再点一次又开出来了 → 树里已经没有它，是被删掉的）" : "（再点一次还是没有 → 树里可能还留着一份画不出来的）";
				if (back.panes["terminal"]) { await clickTileButton(0, "终端"); await wait(600); }
			}
			record("S5", "把 tile 里的面板拖到另一屏", after.panes["terminal"] ? (changed ? "ok" : "bad") : "bad",
				`从 ${t.at} 拖到第二屏之后：${now}${after.panes["terminal"] ? "" : " ← 面板消失了 " + why}`);
		}
	}

	if (wanted("S7")) {
		const before = await snap();
		const bars = await evaluate<number>(`document.querySelectorAll('[role="separator"]').length`);
		await dragSplitter(Math.max(0, bars - 1), 0, -600);
		await wait(700);
		const after = await snap();
		const small = Object.entries(after.panes).filter(([, v]) => v.h < 120 || v.w < 120);
		record("S7", "分屏里把面板压到底线", small.length === 0 ? "ok" : "bad",
			small.length ? `有面板被压穿：${small.map(([k, v]) => `${k} ${v.w}x${v.h}`).join("，")}` : `${bars} 条分隔线，拖完没有面板低于底线（${Object.entries(after.panes).map(([k, v]) => `${k} ${v.w}x${v.h}`).join("，")}）`);
		void before;
	}

	if (wanted("S13")) {
		const before = await snap();
		const had = Object.keys(before.panes).filter((k) => k !== "conversation");
		await clickTileButton(0, "关闭此屏");
		await wait(1400);
		const after = await snap();
		const left = Object.keys(after.panes).filter((k) => k !== "conversation");
		record("S13", "关掉分屏里的一屏，它的面板怎么办",
			after.tiles.length < before.tiles.length ? "ok" : "bad",
			`屏 ${before.tiles.length}→${after.tiles.length}，面板 [${had.join(",")}]→[${left.join(",")}]`);
	}

	if (wanted("S17")) {
		/*
		 * 自己把场子摆好，不吃前面几条留下的状态。
		 *
		 * S13 刚关掉一屏，直接往下跑就是在单屏上测「分屏刷新」，量出来的「没开成」是场景没
		 * 布置好，不是 bug。同一个窗口里跑一串场景，每条都得自己负责前置条件。
		 */
		let tries = 0;
		while ((await snap()).tiles.length < 2 && tries++ < 3) {
			await rowMenu(1 + tries, "分屏");
			await wait(1600);
		}
		const ready = await snap();
		if (ready.tiles.length < 2) { record("S17", "分屏里 tile 的面板，刷新后恢复吗", "skip", `摆不出两屏（${ready.tiles.length} 屏）`); return; }
		const opened = await clickTileButton(0, "终端");
		await wait(1400);
		const before = await snap();
		if (!before.panes["terminal"]) { record("S17", "分屏里 tile 的面板，刷新后恢复吗", "skip", `终端没开成（点到按钮=${opened}）`); return; }
		const had = before.panes["terminal"]?.at;
		await reload();
		const after = await snap();
		const back = after.panes["terminal"]?.at;
		record("S17", "分屏里 tile 的面板，刷新后恢复吗", back ? "ok" : "bad",
			`刷新前终端在 ${had ?? "（没开成）"}，刷新后 ${back ?? "不见了"}；屏数 ${before.tiles.length}→${after.tiles.length}`);
	}
}

/** 组 C：会话开到新窗口。 */
async function groupC(): Promise<void> {
	if (!wanted("S15")) return;
	const before = await snap();
	const w0 = await windows();
	console.log(`
新窗口：${await rowMenu(2, "新窗口")}`);
	await wait(2200);
	const w1 = await windows();
	const after = await snap();
	const opened = w1.sessions.length > w0.sessions.length;
	record("S15", "把会话开到新窗口", opened ? "ok" : "bad",
		`主进程里的会话窗口 ${w0.sessions.length}→${w1.sessions.length}（${w1.sessions.join(",")}），主窗口屏数 ${before.tiles.length}→${after.tiles.length}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await wait(600);
		await openFirstRow();
		await groupA();
		await groupB();
		await groupC();
	} finally {
		console.log(`\n════ 汇总 ════`);
		const bad = results.filter((r) => r.verdict === "bad");
		console.log(`跑了 ${results.length} 条：${results.filter((r) => r.verdict === "ok").length} 正常，${bad.length} 有问题，${results.filter((r) => r.verdict === "skip").length} 没跑成`);
		for (const r of bad) console.log(`  ❌ ${r.id} ${r.title} —— ${r.note}`);
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
