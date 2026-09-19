/* oxlint-disable no-console -- probe CLI that prints what the real windows did */
/**
 * 第二个窗口里发生的事。
 *
 * 场景矩阵（`docs/architecture/split-window-conflicts.md`）里有一整列写着「探针够不到」：
 * 收回按钮长在面板窗口里，关掉面板窗口之后谁把它放回树里，也只有那个窗口能回答。那不是难，
 * 是 `startApp` 从前只连主窗口那一个 CDP target。`app.windows()` 补上了这条路，这个文件就是
 * 那一列。
 *
 * 和 `split-matrix-probe.ts` 分开放，因为这里的每一条都要开第二个窗口，而那边每一条开头都
 * 假定只有一个。两边共用的规矩仍然成立：**每条场景自己负责前置状态**，判据取自 DOM 和主进程
 * 的窗口列表，不问 store——store 说的是「我们以为放哪了」。
 *
 * 用法：node --experimental-strip-types e2e/panel-window-probe.ts [场景前缀，如 S1 或 S12]
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9716;
const ONLY = process.argv[2] ?? "";
let app: RunningApp;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 20000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

interface Shot {
	/** 可见的 dock 面板：kind → 落在哪（窗口 dock 还是某一屏）。 */
	panes: Record<string, string>;
	tiles: string[];
	/** 主进程说的：此刻有几个面板窗口、几个会话窗口。 */
	panels: string[];
	sessions: string[];
	/** 盘上那份「弹出去之前是从哪儿走的」。 */
	homes: string[];
	keys: string[];
}

async function shot(): Promise<Shot> {
	return evaluate<Shot>(`(async () => {
		const panes = {};
		for (const el of document.querySelectorAll('[data-dock-pane]')) {
			const kind = el.dataset.dockPane;
			if (!kind || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
			const tile = el.closest('[data-ly-split-pane]');
			panes[kind] = tile ? 'tile:' + (tile.dataset.lySplitPane || '?').slice(0, 8) : 'window';
		}
		const tiles = [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => (el.dataset.lySplitPane || '?').slice(0, 8));
		let panels = [], sessions = [];
		if (window.lyra && window.lyra.windows && window.lyra.windows.list) {
			const r = await window.lyra.windows.list();
			panels = (r.panels || []).map((p) => p.kind + '@' + String(p.scope).slice(0, 8));
			sessions = (r.sessions || []).map((s) => String(s).slice(0, 8));
		}
		let homes = [];
		try {
			const raw = JSON.parse(localStorage.getItem('dw:homes') || '{}');
			homes = Object.keys(raw).map((k) => k.slice(0, 8) + '=' + raw[k].dock + ':' + String(raw[k].scope).slice(0, 8));
		} catch (e) { homes = ['(坏数据)']; }
		const keys = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith('dw:')) keys.push(k.slice(0, 26));
		}
		return { panes: panes, tiles: tiles, panels: panels, sessions: sessions, homes: homes.sort(), keys: keys.sort() };
	})()`);
}

const kindsOf = (s: Shot): string[] => Object.keys(s.panes).filter((k) => k !== "conversation");

/**
 * 那个面板窗口，等到它的界面真的画出来为止。
 *
 * 等 `bootWindow` 答得上来是不够的——那是 preload 从 argv 里读的，window 一出现就有，而
 * React 还没挂。第一轮 S10 就是这么红的：收回按钮当时确实不在 DOM 上，报出来却像是「面板
 * 窗口没有收回按钮」这么一条产品缺陷。等那颗按钮，不等那个对象。
 */
async function panelWindowOf(kind: string, ms = 12000): Promise<AppWindow | null> {
	const end = Date.now() + ms;
	let seen: AppWindow | null = null;
	while (Date.now() < end) {
		const all = await app.windows();
		const hit = all.find((w) => w.boot.kind === "panel" && w.boot.panelKind === kind);
		if (hit) {
			seen = hit;
			const painted = await hit
				.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-restore-panel]'))`)
				.catch(() => false);
			if (painted) return hit;
		}
		await wait(400);
	}
	return seen;
}

// ---------------------------------------------------------------------------
// 写
// ---------------------------------------------------------------------------

async function clickTopBar(re: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(re)}).test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

/**
 * 点某个面板标题栏上的「在新窗口打开」。
 *
 * 认 `data-ly-pop-out` 而不是 aria-label：那颗按钮的文案跟着界面语言走，而这个属性是为探针
 * 留的，两个 dock（窗口的和每一屏的）用的是同一个 `PaneHeader`，所以一条路两边都通。
 */
async function popOut(kind: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const mark = document.querySelector('[data-ly-pop-out="${kind}"]');
		if (!mark) return false;
		const b = mark.closest('button');
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

/** 在面板窗口里点「回到原来的位置」。 */
async function clickRestore(win: AppWindow): Promise<boolean> {
	return win
		.evaluate<boolean>(`(() => {
			const mark = document.querySelector('[data-ly-restore-panel]');
			if (!mark) return false;
			(mark.closest('button') || mark).click();
			return true;
		})()`)
		.catch(() => false);
}

async function clickTile(index: number, re: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const tile = document.querySelectorAll('[data-ly-split-pane]')[${index}];
		if (!tile) return false;
		const b = [...tile.querySelectorAll('header button')].find((el) => new RegExp(${JSON.stringify(re)}).test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

async function menu(rowIndex: number, item: string): Promise<string> {
	return evaluate<string>(`(async () => {
		const row = document.querySelectorAll('[data-ly-row]')[${rowIndex}];
		if (!row) return 'no row';
		const r = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
		await new Promise((res) => setTimeout(res, 420));
		const open = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式/.test(el.innerText || ''));
		if (!open) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'no submenu'; }
		open.click();
		await new Promise((res) => setTimeout(res, 420));
		const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(item)});
		if (!hit) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'no item'; }
		if (hit.disabled) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'disabled'; }
		hit.click();
		return 'clicked';
	})()`);
}

async function openRow(index: number): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const row = document.querySelectorAll('[data-ly-row]')[${index}];
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
	await wait(800);
}

/** 分成两屏，返回屏数。只挑还没上屏的会话——已经在分屏里的那一行点「分屏」走的是 focus 分支。 */
async function splitTo(n: number): Promise<number> {
	for (let target = 2; target <= n; target++) {
		const onScreen = new Set((await shot()).tiles);
		const rows = await evaluate<string[]>(`[...document.querySelectorAll('[data-ly-row]')].map((r) => (r.dataset.lyRow || '').slice(0, 8))`);
		let done = false;
		for (const cand of rows.map((id, i) => ({ id, i })).filter((r) => r.id && !onScreen.has(r.id)).slice(0, 8)) {
			if (done) break;
			if ((await menu(cand.i, "分屏")) === "clicked") { await wait(1600); done = true; }
		}
		if (!done) break;
	}
	return (await shot()).tiles.length;
}

/**
 * 回到一个说得清的状态：单屏、没有面板、没有第二个窗口、盘上没有回家记录。
 *
 * 面板窗口要走 IPC 关——它一旦弹出去，关闭按钮就不在主窗口里了，只点 DOM 是关不掉的。
 * `dw:homes` 也要清：它现在活过刷新，于是也会活过一条用例，成为下一条的隐藏输入。
 */
async function reset(): Promise<void> {
	await evaluate(`(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		if (window.lyra && window.lyra.windows) {
			const r = await window.lyra.windows.list();
			for (const p of r.panels || []) await window.lyra.windows.closePanel({ kind: p.kind, scope: p.scope });
			for (const s of r.sessions || []) if (window.lyra.windows.closeSession) await window.lyra.windows.closeSession(s);
		}
		for (const b of [...document.querySelectorAll('button')]) {
			const l = b.getAttribute('aria-label') || '';
			if (/^关闭(浏览器|终端|文件|Git|差异|侧边)/.test(l)) b.click();
		}
		localStorage.removeItem('dw:homes');
		return true;
	})()`);
	await wait(700);
	for (let i = 0; i < 4; i++) {
		const many = await evaluate<number>(`document.querySelectorAll('[data-ly-split-pane]').length`);
		if (many <= 1) break;
		await clickTile(1, "关闭此屏");
		await wait(800);
	}
	await wait(400);
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

type Verdict = "ok" | "bad" | "skip";
const results: { id: string; title: string; v: Verdict; note: string }[] = [];

function say(id: string, title: string, v: Verdict, note: string): void {
	results.push({ id, title, v, note });
	console.log(`${v === "ok" ? "✅" : v === "bad" ? "❌" : "⏭️"} ${id} ${title}\n     ${note}`);
}

const want = (id: string): boolean => !ONLY || id.startsWith(ONLY);

async function scene(id: string, title: string, body: () => Promise<[Verdict, string]>): Promise<void> {
	if (!want(id)) return;
	try {
		await reset();
		const [v, note] = await body();
		say(id, title, v, note);
	} catch (error) {
		say(id, title, "skip", `跑挂了：${error instanceof Error ? error.message : String(error)}`);
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	/*
	 * profile 归这个文件管，不归 `startApp`。
	 *
	 * S18/S19 要用同一份数据再起一次，而默认的一次性目录在第一次 `stop()` 时就删了——第一轮
	 * 这两条报的是 ENOENT settings.json，看起来像重启坏了，其实是探针把自己的地基拆了。
	 * 自己建、自己 seed、两次都借给 `startApp`，最后自己收拾。
	 */
	const home = await mkdtemp(join(tmpdir(), "lyra-e2e-panels-"));
	await seedFromReal(home);
	app = await startApp({ port: PORT, reuseHome: home });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await wait(600);
		await openRow(0);

		// -------------------------------------------------------------------
		// S10 / S11：收回按钮在面板窗口里，从那个窗口点它。
		// -------------------------------------------------------------------

		await scene("S10", "窗口 dock 弹出的面板，从面板窗口点「收回」", async () => {
			if (!(await clickTopBar("终端"))) return ["skip", "工具条上没有终端按钮"];
			await wait(900);
			if (!(await popOut("terminal"))) return ["skip", "终端面板上没有「在新窗口打开」"];
			const win = await panelWindowOf("terminal");
			if (!win) return ["bad", "点了弹出，面板窗口没开出来"];
			const gone = await shot();
			if (kindsOf(gone).includes("terminal")) return ["bad", "弹出去了，主窗口里还留着一个"];

			if (!(await clickRestore(win))) return ["bad", "面板窗口里找不到收回按钮"];
			await wait(1600);
			const back = await shot();
			if (back.panes.terminal !== "window") return ["bad", `收回之后终端在 ${back.panes.terminal ?? "哪儿都不在"}`];
			if (back.panels.length > 0) return ["bad", `收回了但面板窗口还开着：${back.panels.join(" ")}`];
			if (back.homes.length > 0) return ["bad", `回家记录没清掉：${back.homes.join(" ")}`];
			return ["ok", `终端回到窗口 dock，面板窗口关掉了，回家记录也清了`];
		});

		await scene("S11", "某一屏弹出的面板，从面板窗口点「收回」，回的是那一屏", async () => {
			if ((await splitTo(2)) < 2) return ["skip", "没分成两屏"];
			const tiles = (await shot()).tiles;
			if (!(await clickTopBar("终端"))) return ["skip", "工具条上没有终端按钮"];
			await wait(900);
			const opened = await shot();
			const at = opened.panes.terminal ?? "";
			if (!at.startsWith("tile:")) return ["skip", `终端没落在某一屏里，而在 ${at || "哪儿都不在"}`];
			const owner = at.slice(5);
			if (!(await popOut("terminal"))) return ["skip", "那一屏的终端上没有「在新窗口打开」"];
			const win = await panelWindowOf("terminal");
			if (!win) return ["bad", "点了弹出，面板窗口没开出来"];
			if (win.boot.panelScope?.slice(0, 8) !== owner) {
				return ["bad", `面板窗口认的是 ${win.boot.panelScope?.slice(0, 8)}，而它是从 ${owner} 走的`];
			}
			if (!(await clickRestore(win))) return ["bad", "面板窗口里找不到收回按钮"];
			await wait(1600);
			const back = await shot();
			if (back.panes.terminal !== `tile:${owner}`) {
				return ["bad", `该回 tile:${owner}，实际在 ${back.panes.terminal ?? "哪儿都不在"}（屏还在：${back.tiles.join(" ")}）`];
			}
			return ["ok", `从 tile:${owner} 走，收回时回的还是它（两屏：${tiles.join(" ")}）`];
		});

		// -------------------------------------------------------------------
		// S12 / S14：不点收回，直接把那个窗口关掉。
		// -------------------------------------------------------------------

		await scene("S12", "窗口 dock 弹出的面板，直接关掉那个窗口", async () => {
			if (!(await clickTopBar("浏览器"))) return ["skip", "工具条上没有浏览器按钮"];
			await wait(900);
			if (!(await popOut("browser"))) return ["skip", "浏览器面板上没有「在新窗口打开」"];
			const win = await panelWindowOf("browser");
			if (!win) return ["bad", "点了弹出，面板窗口没开出来"];
			const before = await shot();

			await evaluate(`(async () => { await window.lyra.windows.closePanel({ kind: 'browser', scope: 'window' }); return true; })()`);
			await wait(1400);
			const after = await shot();
			if (after.panels.length > 0) return ["bad", `窗口没关掉：${after.panels.join(" ")}`];

			// 关掉是关掉，面板不该自己跑回来——但也不该留下一条永远没人清的记录。
			const leaked = after.homes.length > 0;
			// 再点一次按钮，面板要能重新开出来。
			const reopened = await clickTopBar("浏览器");
			await wait(900);
			const again = await shot();
			const visible = kindsOf(again).includes("browser");
			if (!reopened || !visible) return ["bad", `关掉窗口之后再点按钮，浏览器开不出来了（记录 ${after.homes.join(" ") || "空"}）`];
			return [
				leaked ? "bad" : "ok",
				leaked
					? `窗口关掉了、面板也能重开，但回家记录留在盘上没人清：${after.homes.join(" ")}（弹出前 ${before.homes.join(" ")}）`
					: `窗口关掉了，面板没自己跑回来，再点按钮能重开，盘上没留垃圾`,
			];
		});

		await scene("S14", "某一屏弹出的面板，关掉那个窗口之后那一屏还好吗", async () => {
			if ((await splitTo(2)) < 2) return ["skip", "没分成两屏"];
			if (!(await clickTopBar("浏览器"))) return ["skip", "工具条上没有浏览器按钮"];
			await wait(900);
			const at = (await shot()).panes.browser ?? "";
			if (!at.startsWith("tile:")) return ["skip", `浏览器没落在某一屏里，而在 ${at || "哪儿都不在"}`];
			if (!(await popOut("browser"))) return ["skip", "那一屏的浏览器上没有「在新窗口打开」"];
			const win = await panelWindowOf("browser");
			if (!win) return ["bad", "点了弹出，面板窗口没开出来"];
			const scope = win.boot.panelScope ?? "";
			await evaluate(`(async () => { await window.lyra.windows.closePanel({ kind: 'browser', scope: ${JSON.stringify(scope)} }); return true; })()`);
			await wait(1400);
			const after = await shot();
			if (after.tiles.length !== 2) return ["bad", `关掉面板窗口之后屏数成了 ${after.tiles.length}`];
			if (after.panels.length > 0) return ["bad", `窗口没关掉：${after.panels.join(" ")}`];
			const leaked = after.homes.length > 0;
			return [leaked ? "bad" : "ok", leaked ? `两屏都在，但回家记录留着：${after.homes.join(" ")}` : `两屏都在（${after.tiles.join(" ")}），盘上没留垃圾`];
		});

		// -------------------------------------------------------------------
		// S9：弹出之后，它出身的那一屏被关掉。
		// -------------------------------------------------------------------

		await scene("S9", "某一屏弹出面板之后，那一屏被关掉，再收回", async () => {
			if ((await splitTo(2)) < 2) return ["skip", "没分成两屏"];
			if (!(await clickTopBar("终端"))) return ["skip", "工具条上没有终端按钮"];
			await wait(900);
			const at = (await shot()).panes.terminal ?? "";
			if (!at.startsWith("tile:")) return ["skip", `终端没落在某一屏里，而在 ${at || "哪儿都不在"}`];
			const owner = at.slice(5);
			if (!(await popOut("terminal"))) return ["skip", "那一屏的终端上没有「在新窗口打开」"];
			const win = await panelWindowOf("terminal");
			if (!win) return ["bad", "点了弹出，面板窗口没开出来"];

			// 关掉它出身的那一屏。
			const which = (await shot()).tiles.indexOf(owner);
			if (which < 0) return ["skip", `找不到 ${owner} 这一屏了`];
			await clickTile(which, "关闭此屏");
			await wait(1200);
			const oneScreen = await shot();
			if (oneScreen.tiles.includes(owner)) return ["skip", `那一屏没关掉（还剩 ${oneScreen.tiles.join(" ")}）`];

			if (!(await clickRestore(win))) return ["bad", "面板窗口里找不到收回按钮"];
			await wait(1600);
			const back = await shot();
			const still = back.panels.some((p) => p.startsWith("terminal@"));
			const landed = back.panes.terminal;
			if (landed) {
				return ["ok", `出身的那一屏没了，收回时落在 ${landed}${still ? "（但窗口还开着，成了两份）" : ""}`];
			}
			// 家没了就留在浮动窗口里，这是 popout.ts 写明的取舍：不把 tile 的面板停到窗口 dock 上。
			return [still ? "ok" : "bad", still ? "出身的那一屏没了，面板留在独立窗口里，没有凭空消失" : "那一屏关掉之后收回，面板哪儿都不在了"];
		});

		// -------------------------------------------------------------------
		// S3：面板窗口里，从内容触发打开另一个面板。
		// -------------------------------------------------------------------

		await scene("S3", "面板窗口里还能不能再开一个面板", async () => {
			/*
			 * 用哪一种面板不重要，这一条问的是那个窗口里有没有第二个面板的入口。
			 * 文件面板优先（它的内容里有可点的条目），开不出来就退回终端——第一轮就是卡在
			 * 「文件」这颗按钮上，白白 skip 掉了一条本来跑得通的用例。
			 */
			let picked = "";
			for (const [button, kind] of [["文件", "files"], ["终端", "terminal"]] as const) {
				if (!(await clickTopBar(button))) continue;
				await wait(900);
				if (await popOut(kind)) { picked = kind; break; }
				// 开出来了但弹不出去，关掉再试下一个，免得留给下一条。
				await clickTopBar(`^关闭`);
				await wait(400);
			}
			if (!picked) return ["skip", `文件和终端都没能弹出去；此刻画着的面板：${kindsOf(await shot()).join(" ") || "无"}`];
			const win = await panelWindowOf(picked);
			if (!win) return ["bad", `点了弹出，${picked} 的面板窗口没开出来`];
			await wait(800);

			const before = await shot();
			/*
			 * 问的是「有没有入口」，不是「调了会怎样」。
			 *
			 * 面板窗口里没有 DockView，`openScopedPanel` 在那里既画不出东西又会写进和主窗口
			 * 同一份 localStorage——但那是一条没人能走到的路才叫无害。所以判据是界面：那个窗口
			 * 里有没有哪颗按钮能触发它。直接 import 模块去调是测不到这件事的，生产包里也没有
			 * 那个路径。
			 */
			const survey = await win.evaluate<{ docks: number; openers: string[]; buttons: number }>(`(() => {
				const openers = [];
				for (const b of [...document.querySelectorAll('button')]) {
					const label = (b.getAttribute('aria-label') || '') + '|' + (b.innerText || '').trim();
					if (/浏览器|终端|Git|差异|打开文件|在新窗口/.test(label)) openers.push(label.slice(0, 24));
				}
				return { docks: document.querySelectorAll('[data-dock-pane]').length, openers: openers, buttons: document.querySelectorAll('button').length };
			})()`);

			// 文件面板里点一个条目，是那个窗口里真正能做的事——看它会不会改到主窗口的状态。
			const clicked = await win.evaluate<string>(`(() => {
				const row = document.querySelector('[data-ly-file-row], [data-ly-tree-row], [role="treeitem"]');
				if (!row) return 'no-row';
				(row.querySelector('button') || row).click();
				return 'clicked';
			})()`).catch(() => "threw");
			await wait(1200);
			const after = await shot();
			const newKeys = after.keys.filter((k) => !before.keys.includes(k));
			const changed = JSON.stringify(after.panes) !== JSON.stringify(before.panes);
			if (changed || newKeys.length > 0) {
				return ["bad", `在面板窗口里点了一下（${clicked}），主窗口的状态跟着变了：${JSON.stringify(before.panes)} → ${JSON.stringify(after.panes)}，新钥匙 ${newKeys.join(" ") || "无"}`];
			}
			return [
				survey.docks === 0 && survey.openers.length === 0 ? "ok" : "bad",
				survey.docks === 0 && survey.openers.length === 0
					? `${picked} 的面板窗口里没有 dock（${survey.docks} 个面板槽），${survey.buttons} 颗按钮里没有一颗能开第二个面板；点了条目（${clicked}）主窗口也没动`
					: `面板窗口里有能开第二个面板的东西：dock 槽 ${survey.docks}，按钮 [${survey.openers.join(" ")}]`,
			];
		});

		// -------------------------------------------------------------------
		// S18 / S19：整个应用重启。同一份 profile，不是一台新机器。
		// -------------------------------------------------------------------

		await scene("S18", "开着面板窗口和会话窗口时重启应用", async () => {
			if (!(await clickTopBar("终端"))) return ["skip", "工具条上没有终端按钮"];
			await wait(900);
			if (!(await popOut("terminal"))) return ["skip", "终端面板上没有「在新窗口打开」"];
			if (!(await panelWindowOf("terminal"))) return ["bad", "点了弹出，面板窗口没开出来"];
			const before = (await app.windows()).map((w) => `${w.boot.kind}${w.boot.panelKind ? ":" + w.boot.panelKind : ""}`);

			await app.stop();
			await wait(1200);
			app = await startApp({ port: PORT, reuseHome: home });
			await until(`document.querySelector('.ly-shell') !== null`, 40000);
			await wait(2500);
			const after = (await app.windows()).map((w) => `${w.boot.kind}${w.boot.panelKind ? ":" + w.boot.panelKind : ""}`);
			const state = await shot();
			/*
			 * 重开只有主窗口，是意料之中的——窗口列表从来没有存过盘。问题在这之后：那个面板
			 * 弹出去的时候已经从 dock 树里删掉了，重启之后它既不在窗口里，也不在任何树里。
			 * 盘上只剩一条 `dw:homes`，指着一个已经不存在的窗口。
			 */
			const stranded = state.homes.length > 0 && !kindsOf(state).includes("terminal");
			return [
				stranded ? "bad" : "ok",
				stranded
					? `重启前 [${before.join(" ")}]，重启后 [${after.join(" ")}]；终端既没回到 dock 也没有窗口，只剩一条指向空处的记录 ${state.homes.join(" ")}`
					: `重启前 [${before.join(" ")}]，重启后 [${after.join(" ")}]；主窗口里的面板：${kindsOf(state).join(" ") || "无"}，记录 ${state.homes.join(" ") || "空"}`,
			];
		});

		await scene("S19", "重启之后，分屏和每一屏的面板还在吗", async () => {
			if ((await splitTo(2)) < 2) return ["skip", "没分成两屏"];
			if (!(await clickTopBar("浏览器"))) return ["skip", "工具条上没有浏览器按钮"];
			await wait(900);
			const before = await shot();
			if (!before.panes.browser) return ["skip", "浏览器没开出来"];

			await app.stop();
			await wait(1200);
			app = await startApp({ port: PORT, reuseHome: home });
			await until(`document.querySelector('.ly-shell') !== null`, 40000);
			await wait(3000);
			const after = await shot();
			if (after.tiles.length !== before.tiles.length) {
				return ["bad", `重启前 ${before.tiles.length} 屏（${before.tiles.join(" ")}），重启后 ${after.tiles.length} 屏（${after.tiles.join(" ")}）`];
			}
			if (after.panes.browser !== before.panes.browser) {
				return ["bad", `重启前浏览器在 ${before.panes.browser}，重启后在 ${after.panes.browser ?? "哪儿都不在"}`];
			}
			return ["ok", `${after.tiles.length} 屏原样回来（${after.tiles.join(" ")}），浏览器还在 ${after.panes.browser}`];
		});

		console.log(`\n${"=".repeat(64)}`);
		const bad = results.filter((r) => r.v === "bad");
		const skip = results.filter((r) => r.v === "skip");
		console.log(`${results.length} 条：${results.length - bad.length - skip.length} 正常，${bad.length} 有问题，${skip.length} 没跑成`);
		for (const r of bad) console.log(`  ❌ ${r.id} ${r.title}\n     ${r.note}`);
		for (const r of skip) console.log(`  ⏭️ ${r.id} ${r.title}\n     ${r.note}`);
	} finally {
		await app.stop().catch(() => {});
		await rm(home, { recursive: true, force: true }).catch(() => {});
	}
}

await main();
