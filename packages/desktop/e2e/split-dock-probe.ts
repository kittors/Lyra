/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 分屏 × 浮动面板：交界处到底发生什么。
 *
 * 对着 `docs/architecture/split-window-conflicts.md` 那张场景矩阵跑。这一轮先摸底——分屏之后
 * 页面上真实存在哪些容器、哪些入口，以及「打开一个面板」到底落在窗口 dock 还是这一屏自己的
 * dock。清单里那几条都是读代码读出来的，没在真窗口里见过；见过之前不算数。
 *
 * 判据取自 DOM 而不是 store：`[data-dock-pane]` 是窗口 dock 画出来的，分屏那一层是
 * `[data-ly-split-pane]`，一个面板落在谁里面，用 `closest()` 问它自己最准——store 里读到的
 * 是「我们以为放哪了」，DOM 是「实际画在哪」。
 *
 * 用法：node --experimental-strip-types e2e/split-dock-probe.ts
 *
 * 这里说的「窗口 dock」已经没有了（ADR-0023）：面板只属于会话，单屏是只有一屏的分屏，每一屏
 * 一个 `DockView`，布局都在 `dw:panedock:<会话>`。这个探针留着当回归用——场景里凡是期望
 * 「落在窗口 dock」的，现在的正确答案都是「落在那个会话自己的屏里」。
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9709;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/** 此刻页面上的容器长什么样。 */
const SHAPE = `(() => {
	const box = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); };
	const panes = [...document.querySelectorAll('[data-dock-pane]')]
		.filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
		.map((el) => el.dataset.dockPane + "(" + box(el) + ")");
	const tiles = [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => (el.dataset.lySplitPane || "?").slice(0, 8) + "(" + box(el) + ")");
	/*
	 * 一个面板落在哪一层，问它自己。
	 *
	 * 往上找最近的 [data-ly-split-pane]：找得到就是落在某一屏里（pane dock），找不到就是
	 * 落在窗口 dock 上。store 里存的是意图，这里读的是实际画出来的位置。
	 */
	const where = {};
	for (const el of document.querySelectorAll('[data-dock-pane]')) {
		const kind = el.dataset.dockPane;
		if (!kind || kind === 'conversation') continue;
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
		const tile = el.closest('[data-ly-split-pane]');
		where[kind] = tile ? 'tile:' + (tile.dataset.lySplitPane || '?').slice(0, 8) : 'window-dock';
	}
	return { panes: panes, tiles: tiles, where: where };
})()`;

interface Shape {
	panes: string[];
	tiles: string[];
	where: Record<string, string>;
}

async function shape(label: string): Promise<Shape> {
	const s = await evaluate<Shape>(SHAPE);
	console.log(`\n[${label}]`);
	console.log(`  窗口 dock 的面板：${s.panes.join("  ") || "（无）"}`);
	console.log(`  分屏 tile：${s.tiles.join("  ") || "（无）"}`);
	const w = Object.entries(s.where);
	console.log(`  面板落在哪：${w.length ? w.map(([k, v]) => `${k} → ${v}`).join("，") : "（没有非会话面板）"}`);
	return s;
}

/** localStorage 里和布局有关的键，用来回答「刷新之后还在不在」。 */
async function storedKeys(): Promise<string[]> {
	return evaluate<string[]>(`(() => {
		const out = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && (k.startsWith('dw:dock') || k.startsWith('ly:split') || k.indexOf('panedock') >= 0 || k.indexOf('home') >= 0)) out.push(k);
		}
		return out.sort();
	})()`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await new Promise((r) => setTimeout(r, 600));

		// 开第一个会话
		const first = await evaluate<string>(`(() => {
			const row = document.querySelector('[data-ly-row]');
			if (!row) return '';
			row.scrollIntoView({ block: 'center' });
			const r = row.getBoundingClientRect();
			window.__firstRow = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
			return (row.innerText || '').split('\\n')[0].trim();
		})()`);
		const at = await evaluate<{ x: number; y: number }>(`window.__firstRow`);
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
		}
		await until(`document.querySelector('[data-dock-pane="conversation"]') !== null`, 20000).catch(() => {});
		await new Promise((r) => setTimeout(r, 800));
		console.log(`开了「${first}」`);
		await shape("单屏，什么面板都没开");
		console.log(`  localStorage：${(await storedKeys()).join("  ") || "（无）"}`);

		// 页面上有哪些能开面板的入口
		const entries = await evaluate<string[]>(`(() => {
			const out = [];
			for (const b of document.querySelectorAll('button')) {
				const label = (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 20);
				if (!label) continue;
				if (/浏览|终端|文件|Git|browser|terminal|files|分屏|split/i.test(label)) {
					const r = b.getBoundingClientRect();
					if (r.width > 0) out.push(label + " @" + Math.round(r.left) + "," + Math.round(r.top));
				}
			}
			return out.slice(0, 16);
		})()`);
		console.log(`\n能开面板/分屏的入口：\n  ${entries.join("\n  ") || "（没找到）"}`);

		// 右键一行会话，看菜单里有没有分屏
		const menu = await evaluate<string[]>(`(() => {
			const row = document.querySelectorAll('[data-ly-row]')[1] || document.querySelector('[data-ly-row]');
			if (!row) return [];
			const r = row.getBoundingClientRect();
			row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
			return [];
		})()`);
		void menu;
		await new Promise((r) => setTimeout(r, 500));
		const items = await evaluate<string[]>(`(() => [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].map((b) => (b.innerText || '').trim().slice(0, 18)).filter(Boolean).slice(0, 14))()`);
		console.log(`\n会话右键菜单：\n  ${items.join("\n  ") || "（没弹出来）"}`);
		// 「打开方式」里应该藏着分屏
		const sub = await evaluate<string[]>(`(() => {
			const b = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式|Open/.test(el.innerText || ''));
			if (!b) return [];
			b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
			b.click();
			return [];
		})()`);
		void sub;
		await new Promise((r) => setTimeout(r, 500));
		const subItems = await evaluate<string[]>(`(() => [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].map((b) => (b.innerText || '').trim().slice(0, 20)).filter(Boolean).slice(0, 16))()`);
		console.log(`\n「打开方式」子菜单：\n  ${subItems.join("\n  ") || "（没展开）"}`);

		// ---- V1：单屏时点右上角「浏览器」，面板落在哪 ----
		await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
		await new Promise((r) => setTimeout(r, 300));
		const opened = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /浏览器/.test(el.getAttribute('aria-label') || ''));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 900));
		console.log(`\n点了右上角「浏览器」：${opened ? "点到了" : "没找到按钮"}`);
		await shape("V1 单屏 + 浏览器");
		console.log(`  localStorage：${(await storedKeys()).join("  ") || "（无）"}`);

		/*
		 * ---- V1b：对照组。单屏状态下刷新一次，面板还在不在。
		 *
		 * 分屏之后刷新丢面板，可能是分屏引入的，也可能本来就丢。不先做这一次对照，就会把一个
		 * 老问题记成分屏的账。
		 */
		await evaluate(`(() => { location.reload(); return true; })()`);
		await new Promise((r) => setTimeout(r, 4000));
		await until(`document.querySelector('[data-ly-split-pane]') !== null`, 25000).catch(() => {});
		await new Promise((r) => setTimeout(r, 1500));
		const v1b = await shape("V1b 单屏 + 浏览器，刷新之后");
		const keptSingle = v1b.panes.some((p) => p.startsWith("browser"));
		console.log(`  → 单屏刷新${keptSingle ? "保住了" : "没保住"}窗口 dock 的面板`);
		/*
		 * 没保住的话，分清是「存错了」还是「读不出来」——直接把盘上那份印出来。
		 * 存着 browser 却没画出来是读的问题；存的就只有 conversation，那是写的问题。
		 */
		const stored = await evaluate<Record<string, string>>(`(() => {
			const out = {};
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.startsWith('dw:panedock:')) out[k.slice(12, 20)] = (localStorage.getItem(k) || '').slice(0, 150);
			}
			return out;
		})()`);
		for (const [k, v] of Object.entries(stored)) console.log(`  盘上 ${k}：${v}`);

		// ---- V2：分屏 ----
		const split = await evaluate<string>(`(async () => {
			const row = document.querySelectorAll('[data-ly-row]')[1];
			if (!row) return 'no row';
			const r = row.getBoundingClientRect();
			row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
			await new Promise((res) => setTimeout(res, 400));
			const open = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式/.test(el.innerText || ''));
			if (!open) return 'no submenu';
			open.click();
			await new Promise((res) => setTimeout(res, 400));
			const item = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => (el.innerText || '').trim() === '分屏');
			if (!item) return 'no split item';
			item.click();
			return 'clicked';
		})()`);
		await new Promise((r) => setTimeout(r, 1400));
		console.log(`\n分屏：${split}`);
		const after = await shape("V2 分屏之后");
		console.log(`  localStorage：${(await storedKeys()).join("  ") || "（无）"}`);
		if (after.tiles.length < 2) { console.log("  ⚠️ 没分成两屏，后面的判定没有意义"); return; }

		// ---- V3：分屏状态下，从右上角那颗按钮开终端，落在窗口 dock 还是某一屏 ----
		await evaluate(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /终端/.test(el.getAttribute('aria-label') || ''));
			if (b) b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 1000));
		const v3 = await shape("V3 分屏 + 从右上角开终端");
		console.log(`  期望：按 SplitWorkspace 的注释，从 tile 开的该落 tile；但这颗按钮不属于任何 tile，落窗口 dock 才对`);
		console.log(`  实际：终端 → ${v3.where["terminal"] ?? "（没开出来）"}`);

		// ---- V4：刷新，看两层布局各自恢复了什么 ----
		const before = await storedKeys();
		await evaluate(`(() => { location.reload(); return true; })()`);
		await new Promise((r) => setTimeout(r, 4000));
		await until(`document.querySelector('[data-ly-split-pane]') !== null`, 25000).catch(() => {});
		await new Promise((r) => setTimeout(r, 1500));
		const v4 = await shape("V4 刷新之后");
		console.log(`  刷新前 localStorage：${before.join("  ")}`);
		console.log(`  刷新后 localStorage：${(await storedKeys()).join("  ")}`);
		console.log(`  分屏恢复了 ${v4.tiles.length} 屏；窗口 dock 恢复了 ${v4.panes.filter((p) => !p.startsWith("conversation")).length} 个面板`);
		/*
		 * 布局存着却没恢复——先问一句「读的是哪把钥匙」。
		 *
		 * 窗口 dock 按当前会话存（dw:dock:<sessionId>）。分屏之后屏上同时有两个会话，而「当前」
		 * 只有一个；刷新后它要是换了人，读的就是另一把钥匙，于是拿到默认布局。
		 */
		const keyed = await evaluate<{ active: string; stored: string[]; focusedTile: string }>(`(() => {
			const tiles = [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => el.dataset.lySplitPane || '');
			const lit = document.querySelector('[data-ly-split-pane][data-focused="true"]');
			const stored = [];
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.startsWith('dw:panedock:')) stored.push(k.slice(12, 20));
			}
			return { active: (tiles[0] || '').slice(0, 8), stored: stored, focusedTile: (lit ? lit.dataset.lySplitPane || '' : '').slice(0, 8) };
		})()`);
		console.log(`  屏上第一个 tile ${keyed.active}，聚焦的 tile ${keyed.focusedTile || "（没标记）"}`);
		console.log(`  存过布局的会话：${keyed.stored.join("、") || "（无）"}`);
		console.log(`  → ${keyed.stored.length && !keyed.stored.includes(keyed.focusedTile || keyed.active) ? "❌ 存布局的会话和当前读的不是同一个，所以读到默认布局" : "存取用的是同一把钥匙"}`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
