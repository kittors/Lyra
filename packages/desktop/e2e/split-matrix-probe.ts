/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 分屏 × 多窗口 × 浮动面板：完整场景矩阵。
 *
 * 场景表在 `docs/architecture/split-window-conflicts.md`。这个文件是它的可执行版本。
 *
 * **每条场景自己负责前置状态。** 这一条是用血换的：同一个窗口里跑一串用例，上一条留下的
 * 样子就是下一条的输入，而这中间已经骗过两次——「面板拖一下就永久消失」是把 pointerup 派给
 * 了已经脱离文档的把手；「tile 太小点按钮毫无反应」是上一轮弹出去的面板窗口还开着。两次都
 * 长得像真 bug。所以每条开头先 reset 到一个说得清的状态。
 *
 * 判据取自 DOM 和主进程的窗口列表，不问 store：store 说的是「我们以为放哪了」。
 *
 * 用法：node --experimental-strip-types e2e/split-matrix-probe.ts [场景前缀，如 B 或 B3]
 *
 * 场景表写于面板还有两个家的时候。窗口那一层已经拿掉了（ADR-0023）：面板只属于会话，单屏是
 * 只有一屏的分屏，布局都在 `dw:panedock:<会话>`。注释里提到窗口 dock 的地方是在讲当时的病因。
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9714;
const ONLY = process.argv[2] ?? "";
let app: RunningApp;

const CONV = { w: 420, h: 260 };
const PANEL = { w: 300, h: 150 };
/** 开跑时的视口，reset 要显式设回它。 */
let home = { w: 0, h: 0 };

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
// 读
// ---------------------------------------------------------------------------

interface Shot {
	/** 可见的 dock 面板：kind → 落在哪 + 尺寸。 */
	panes: Record<string, { at: string; w: number; h: number; x: number; y: number }>;
	/** 挂在 DOM 上但画不出来的，写成 kind:WxH——用来区分「没有」和「被压没」。 */
	hidden: string[];
	/** 窄窗口的折叠形态：面板还在，只是一次只显示一个。 */
	compact: boolean;
	tiles: { id: string; w: number; h: number; x: number; y: number }[];
	keys: string[];
	panels: string[];
	sessions: string[];
}

async function shot(): Promise<Shot> {
	return evaluate<Shot>(`(async () => {
		const panes = {};
		/*
		 * 不可见的也记一笔。
		 *
		 * 「转录不见了」有两种：树里真的没有它，和它被压成 0 高度还挂在那儿。两者修法不同，
		 * 而只收集可见的那一版分不开——会把后者报成前者。
		 */
		const hidden = [];
		for (const el of document.querySelectorAll('[data-dock-pane]')) {
			const kind = el.dataset.dockPane;
			if (!kind) continue;
			if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
				const hb = el.getBoundingClientRect();
				hidden.push(kind + ':' + Math.round(hb.width) + 'x' + Math.round(hb.height));
				continue;
			}
			const tile = el.closest('[data-ly-split-pane]');
			const r = el.getBoundingClientRect();
			panes[kind] = { at: tile ? 'tile:' + (tile.dataset.lySplitPane || '?').slice(0, 8) : 'window',
				w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
		}
		const tiles = [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => {
			const r = el.getBoundingClientRect();
			return { id: (el.dataset.lySplitPane || '?').slice(0, 8), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
		});
		const keys = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && (k.startsWith('dw:') || k.startsWith('ly:split'))) keys.push(k.slice(0, 26));
		}
		let panels = [], sessions = [];
		if (window.lyra?.windows?.list) {
			const r = await window.lyra.windows.list();
			panels = (r.panels || []).map((p) => p.kind + '@' + String(p.scope).slice(0, 8));
			sessions = (r.sessions || []).map((s) => String(s).slice(0, 8));
		}
		/*
		 * 窄窗口下 dock 会折叠成「一次只显示一个面板」（DockView 里那句
		 * hidden={compact ? kind !== focusedPane : ...}）。判据得认出这一形态，
		 * 否则会把「转录此刻没轮到显示」报成「转录丢了」。
		 * 认法：有面板被藏起来，而它的尺寸是满的——不是被压成 0，是没轮到它。
		 */
		const compact = hidden.some((h) => {
			const wh = h.split(':')[1] || '';
			const n = wh.split('x').map(Number);
			return n[0] > 200 && n[1] > 200;
		});
		return { panes: panes, hidden: hidden, compact: compact, tiles: tiles, keys: keys.sort(), panels: panels, sessions: sessions };
	})()`);
}

const kindsOf = (s: Shot): string[] => Object.keys(s.panes).filter((k) => k !== "conversation");

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

/**
 * 拖一个面板到某点。按下派给把手，移动和松手派给 window。
 *
 * 顺序不能反：面板一被拎起，把手就从 DOM 上消失，继续往它身上派事件等于派给游离节点，
 * 冒泡不到 window 上的监听，收尾那一步永远不跑——会量出「面板被拖没了」的假象。
 * 注入的代码里不写反引号。
 */
async function drag(kind: string, to: { x: number; y: number }, opts: { escape?: boolean } = {}): Promise<boolean> {
	return evaluate<boolean>(`(async () => {
		const grip = document.querySelector('[data-dock-grip="${kind}"]');
		if (!grip) return false;
		const box = grip.getBoundingClientRect();
		const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		const send = (type, x, y) => (type === 'pointerdown' ? grip : window).dispatchEvent(new PointerEvent(type, {
			pointerId: 1, isPrimary: true, bubbles: true, cancelable: true,
			clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
		}));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		send('pointerdown', from.x, from.y);
		await frame();
		for (let i = 1; i <= 10; i++) {
			send('pointermove', from.x + (${to.x} - from.x) * i / 10, from.y + (${to.y} - from.y) * i / 10);
			await frame();
		}
		${opts.escape ? `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame(); return true;` : `send('pointerup', ${to.x}, ${to.y}); await frame(); return true;`}
	})()`);
}

async function dragSplitter(index: number, dx: number, dy: number): Promise<boolean> {
	return evaluate<boolean>(`(async () => {
		const bar = document.querySelectorAll('[role="separator"]')[${index}];
		if (!bar) return false;
		const box = bar.getBoundingClientRect();
		const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		const send = (type, x, y) => (type === 'pointerdown' ? bar : window).dispatchEvent(new PointerEvent(type, {
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
	// 清掉上一轮的日志：这一条要看的是刷新之后发生了什么。
	await evaluate(`(() => { localStorage.setItem("__probe", "[]"); return true; })()`);
	await evaluate(`(() => { location.reload(); return true; })()`);
	await wait(4200);
	await until(`document.querySelector('[data-ly-split-pane]') !== null`, 25000).catch(() => {});
	await wait(1400);
}

/** 按标题开一个会话——有些场景需要转录里确实有那张卡片。 */
async function openRowNamed(title: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const row = [...document.querySelectorAll('[data-ly-row]')].find((r) => (r.innerText || '').includes(${JSON.stringify(title)}));
		if (!row) return null;
		row.scrollIntoView({ block: 'center' });
		const r = row.getBoundingClientRect();
		if (r.width === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`document.querySelector('[data-dock-pane="conversation"]') !== null`).catch(() => {});
	await wait(1200);
	return true;
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

/**
 * 回到一个说得清的状态：单屏、没有面板、没有第二个窗口、视口没被改过。
 *
 * 面板窗口要走 IPC 关——它一旦弹出去，关闭按钮就不在主窗口里了，只点 DOM 是关不掉的。
 */
async function reset(): Promise<void> {
	/*
	 * 视口要设回去，不能只 clear。
	 *
	 * `clearDeviceMetricsOverride` 在这里没把窗口还原——一条压过窗口的用例之后，后面每一条都
	 * 在 700 宽的窗口里跑，分屏被正确拦掉，于是七条用例一起报「没分成两屏」。看起来像七个 bug，
	 * 其实是一条用例没收拾干净。显式设回开跑时的尺寸，再验一次。
	 */
	await app.send("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
	if (home.w > 0) {
		const now = await evaluate<number>(`window.innerWidth`).catch(() => 0);
		if (Math.abs(now - home.w) > 4) {
			await app.send("Emulation.setDeviceMetricsOverride", { width: home.w, height: home.h, deviceScaleFactor: 0, mobile: false }).catch(() => {});
			await wait(500);
		}
	}
	await evaluate(`(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		if (window.lyra?.windows?.list && window.lyra?.windows?.closePanel) {
			const r = await window.lyra.windows.list();
			for (const p of r.panels || []) await window.lyra.windows.closePanel({ kind: p.kind, scope: p.scope });
		}
		for (const b of [...document.querySelectorAll('button')]) {
			const l = b.getAttribute('aria-label') || '';
			if (/^关闭(浏览器|终端|文件|Git|差异|侧边)/.test(l)) b.click();
		}
		return true;
	})()`);
	await wait(600);
	// 分屏收回单屏：一直点第二屏的「关闭此屏」
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

/**
 * 分成 n 屏，返回实际屏数。
 *
 * 按行号挨个试，而不是认死第 i 行：刷新一次侧边栏的顺序就变了，而已经在分屏里的那一行点
 * 「分屏」是没有意义的（菜单项会禁用）。四条用例一起报「没分成两屏」就是这么来的——看着像
 * 四个 bug，其实是取行的方式太脆。
 */
let splitWhy = "";

async function splitTo(n: number): Promise<number> {
	splitWhy = "";
	for (let target = 2; target <= n; target++) {
		let done = false;
		const tried: string[] = [];
		/*
		 * 只挑还没上屏的会话。
		 *
		 * 对一个已经在分屏里的会话点「分屏」，菜单项不禁用，但 splitWith 走的是 focus 分支——
		 * 点得动、屏数不变。探针于是报「点成功了但只有 1 屏」，看着像分屏坏了。
		 * 侧边栏行的 data-ly-row 就是会话 id，拿它和屏上的对一遍即可。
		 */
		const onScreen = new Set((await shot()).tiles.map((t) => t.id));
		const rows = await evaluate<string[]>(`[...document.querySelectorAll('[data-ly-row]')].map((r) => (r.dataset.lyRow || '').slice(0, 8))`);
		const fresh = rows.map((id, i) => ({ id, i })).filter((r) => r.id && !onScreen.has(r.id));
		for (const cand of fresh.slice(0, 8)) {
			if (done) break;
			const r = await menu(cand.i, "分屏");
			tried.push(`${cand.i}(${cand.id}):${r}`);
			if (r === "clicked") { await wait(1600); done = true; }
		}
		if (!done) { splitWhy = `分到第 ${target} 屏时每一行都不行 [${tried.join(" ")}]`; break; }
		const got = (await shot()).tiles.length;
		if (got < target) { splitWhy = `点成功了但只有 ${got} 屏`; break; }
	}
	return (await shot()).tiles.length;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await wait(600);
		await openRow(0);
		const view = await evaluate<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
		home = { w: view.w, h: view.h };
		console.log(`窗口 ${view.w}x${view.h}；并排要 ${CONV.w + PANEL.w} 宽，上下叠要 ${CONV.h + PANEL.h} 高\n`);

		// ---- A 打开与关闭 ----
		await scene("A1", "单屏：从顶栏开浏览器", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const s = await shot();
			const at = s.panes["browser"]?.at;
			return at === "window" || at?.startsWith("tile") ? ["ok", `落在 ${at}`] : ["bad", `没开出来（可见面板：${kindsOf(s).join(",") || "无"}）`];
		});

		await scene("A2", "分屏：从第一屏标题栏开终端", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const s = await shot();
			const at = s.panes["terminal"]?.at;
			// 放不放得下都该落进那一屏——自动弹窗那条退路已经去掉了（第六节）。
			if (!at) return ["bad", s.panels.length ? `不该弹成独立窗口：${s.panels.join(",")}` : "既没落进 tile，也没别的去处"];
			return at.startsWith("tile") ? ["ok", `落在 ${at}`] : ["bad", `落在 ${at}，期望落进某一屏`];
		});

		await scene("A3", "分屏：同一种面板在两屏各开一次", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1200);
			const first = (await shot()).panes["terminal"]?.at;
			await clickTile(1, "终端");
			await wait(1200);
			const s = await shot();
			const now = s.panes["terminal"]?.at;
			return ["ok", `第一屏开在 ${first}，再从第二屏点之后：${now ?? "不在页面上"}，面板窗口 [${s.panels.join(",")}]`];
		});

		await scene("A4", "分屏：面板已在窗口 dock，再从 tile 点同一种", async () => {
			await clickTopBar("浏览器");
			await wait(1000);
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			const before = (await shot()).panes["browser"]?.at;
			await clickTile(0, "浏览器");
			await wait(1200);
			const s = await shot();
			return ["ok", `窗口 dock 上原本在 ${before}，从第一屏点过之后：${s.panes["browser"]?.at ?? "不在页面上"}，面板窗口 [${s.panels.join(",")}]`];
		});

		await scene("A5", "关掉面板再开，回不回原来的位置", async () => {
			await clickTopBar("浏览器");
			await wait(1000);
			await dragSplitter(0, -180, 0);
			await wait(600);
			const before = (await shot()).panes["browser"];
			await clickTopBar("关闭浏览器");
			await wait(800);
			await clickTopBar("浏览器");
			await wait(1100);
			const after = (await shot()).panes["browser"];
			if (!before || !after) return ["skip", "面板没开出来"];
			const same = Math.abs(before.w - after.w) <= 8;
			return [same ? "ok" : "bad", `关之前 ${before.w}x${before.h}，再开 ${after.w}x${after.h}${same ? "" : " ← 宽度没回来"}`];
		});

		await scene("A6", "分屏：从转录内容里打开面板，落在哪一屏", async () => {
			/*
			 * 这一条问的是 C1：从工具条点和从转录里点，落点该不该一致。
			 *
			 * 转录里的「审核」走 openScopedPanel("delivery")，工具条上那排走 toggleScopedPanel。
			 * 从前前者写死窗口 dock，后者认 scope——同一个动作两个结果，看不出规律。
			 */
			// 先开一个转录里确实有「已编辑 N 个文件」卡片的会话，否则这一条无从点起。
			if (!(await openRowNamed("整理图片需求到文档"))) return ["skip", "侧边栏里没有那个会话"];
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			// 「已编辑 N 个文件」那张卡在这一轮的末尾，先滚到底才点得到。
			await evaluate(`(() => {
				for (const el of document.querySelectorAll('[data-ly-split-pane] .ly-scroll-view')) el.scrollTop = el.scrollHeight;
				return true;
			})()`);
			await wait(900);
			const clicked = await evaluate<boolean>(`(() => {
				const tile = [...document.querySelectorAll('[data-ly-split-pane]')].find((t) => [...t.querySelectorAll('button')].some((el) => /^(审核|Review)$/.test((el.innerText || '').trim())));
				if (!tile) return false;
				const b = [...tile.querySelectorAll('button')].find((el) => /^(审核|Review)$/.test((el.innerText || '').trim()));
				if (!b) return false;
				b.click();
				return true;
			})()`);
			if (!clicked) {
				/*
				 * 跳过时把这一屏实际有哪些按钮印出来——下次不用再靠猜改正则。
				 * C1 那条规矩本身由 `test/ui/scoped-open.test.ts` 的六条钉着，这里只是想在
				 * 真窗口里再见一次。
				 */
				const seen = await evaluate<string[]>(`(() => {
					const tile = document.querySelectorAll('[data-ly-split-pane]')[0];
					if (!tile) return [];
					return [...tile.querySelectorAll('button')].map((b) => ((b.innerText || '').trim() || b.getAttribute('aria-label') || '')).filter(Boolean).slice(0, 14);
				})()`);
				return ["skip", `这一屏的转录里没有「审核」卡片（规矩本身由 scoped-open.test.ts 钉着）。按钮有：${seen.join("、") || "（读不到）"}`];
			}
			await wait(1500);
			const s2 = await shot();
			const at = s2.panes["delivery"]?.at;
			if (!at) return ["bad", s2.panels.length ? `不该弹成独立窗口：${s2.panels.join(",")}` : "点了「审核」但面板没出现"];
			return [at.startsWith("tile") ? "ok" : "bad",
				`从第一屏的转录里点「审核」，面板落在 ${at}${at.startsWith("tile") ? "" : " ← 期望落进那一屏，而不是横在两屏旁边"}`];
		});

		// ---- B 拖动 ----
		await scene("B1", "窗口 dock 内拖动换位", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const before = (await shot()).panes;
			if (!before["browser"] || !before["conversation"]) return ["skip", "面板没开出来"];
			await drag("browser", { x: before["conversation"].x + 60, y: before["conversation"].y + 260 });
			await wait(1000);
			const after = (await shot()).panes["browser"];
			if (!after) return ["bad", "拖完面板不见了"];
			const moved = Math.abs(after.x - before["browser"].x) > 20 || Math.abs(after.y - before["browser"].y) > 20;
			return [moved ? "ok" : "bad", `x ${before["browser"].x}→${after.x}，y ${before["browser"].y}→${after.y}`];
		});

		await scene("B2", "tile 内部拖动换位（下半屏拖到上半屏）", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const s0 = await shot();
			const t = s0.panes["terminal"];
			const tile = s0.tiles[0];
			if (!t || !tile) return ["skip", `终端没落进 tile（面板窗口 ${s0.panels.join(",") || "无"}）`];
			await drag("terminal", { x: tile.x + Math.round(tile.w / 2), y: tile.y + Math.round(tile.h / 4) });
			await wait(1100);
			const after = (await shot()).panes["terminal"];
			if (!after) return ["bad", "拖完终端不见了"];
			return [after.y < t.y ? "ok" : "bad", `终端 y ${t.y}→${after.y}${after.y < t.y ? "（换到上半屏了）" : "（没动）"}`];
		});

		await scene("B3", "把 tile 里的面板拖到另一屏", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const s0 = await shot();
			const t = s0.panes["terminal"];
			const other = s0.tiles[1];
			if (!t || !other) return ["skip", "终端没落进 tile"];
			await drag("terminal", { x: other.x + Math.round(other.w / 2), y: other.y + Math.round(other.h / 2) });
			await wait(1100);
			const after = (await shot()).panes["terminal"];
			if (!after) return ["bad", "拖到另一屏之后终端不见了"];
			return ["ok", `从 ${t.at} 拖向第二屏，落点 ${after.at}${after.at === t.at ? "（被拒，弹回原屏）" : "（真的换屏了）"}`];
		});

		await scene("B4", "拖到没有合法落点的地方松手", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const s0 = await shot();
			const t = s0.panes["terminal"];
			if (!t) return ["skip", "终端没落进 tile"];
			await drag("terminal", { x: 8, y: 8 });
			await wait(1100);
			const after = (await shot()).panes["terminal"];
			return after ? ["ok", `松手后回到 ${after.at}，没丢`] : ["bad", "面板丢了——放不下时必须复原，不能留在被拎起的状态"];
		});

		await scene("B5", "拖动中按 Esc 取消", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const before = (await shot()).panes["browser"];
			if (!before) return ["skip", "面板没开出来"];
			await drag("browser", { x: 200, y: 400 }, { escape: true });
			await wait(1000);
			const after = (await shot()).panes["browser"];
			if (!after) return ["bad", "按了 Esc 面板却没了"];
			const back = Math.abs(after.x - before.x) <= 8 && Math.abs(after.y - before.y) <= 8;
			return [back ? "ok" : "bad", `Esc 之后 ${before.x},${before.y} → ${after.x},${after.y}${back ? "（回原处）" : "（没回去）"}`];
		});

		// ---- C 尺寸与底线 ----
		await scene("C1", "窗口 dock 的分隔线拖到底", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			await dragSplitter(0, -900, 0);
			await wait(800);
			const s = await shot();
			const c = s.panes["conversation"], b = s.panes["browser"];
			if (!c || !b) return ["bad", `拖完少了面板：${kindsOf(s).join(",") || "无"}`];
			const okFloor = c.w >= CONV.w - 8 && b.w >= PANEL.w - 8;
			return [okFloor ? "ok" : "bad", `转录 ${c.w}（底线 ${CONV.w}），浏览器 ${b.w}（底线 ${PANEL.w}）`];
		});

		await scene("C2", "tile 里的分隔线拖到底", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const s0 = await shot();
			if (!s0.panes["terminal"]) return ["skip", "终端没落进 tile"];
			const bars = await evaluate<number>(`document.querySelectorAll('[role="separator"]').length`);
			await dragSplitter(bars - 1, 0, -900);
			await wait(800);
			const s = await shot();
			const c = s.panes["conversation"], t = s.panes["terminal"];
			if (!c || !t) return ["bad", `拖完少了面板：${kindsOf(s).join(",") || "无"}`];
			const okFloor = c.h >= CONV.h - 8 && t.h >= PANEL.h - 8;
			return [okFloor ? "ok" : "bad", `转录高 ${c.h}（底线 ${CONV.h}），终端高 ${t.h}（底线 ${PANEL.h}）`];
		});

		await scene("C3", "分屏之间的分隔线拖到底", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await dragSplitter(0, -900, 0);
			await wait(800);
			const s = await shot();
			const small = s.tiles.filter((t) => t.w < CONV.w - 8);
			return [small.length === 0 ? "ok" : "bad",
				`两屏宽 ${s.tiles.map((t) => t.w).join(" / ")}（转录底线 ${CONV.w}）${small.length ? " ← 有屏被压穿" : ""}`];
		});

		await scene("C4", "窗口压小到面板放不下，已开的面板怎么办", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const before = (await shot()).panes["browser"];
			if (!before) return ["skip", "面板没开出来"];
			await app.send("Emulation.setDeviceMetricsOverride", { width: 700, height: 500, deviceScaleFactor: 0, mobile: false });
			await wait(1200);
			const s = await shot();
			const b = s.panes["browser"], c = s.panes["conversation"];
			await app.send("Emulation.setDeviceMetricsOverride", { width: home.w, height: home.h, deviceScaleFactor: 0, mobile: false });
			await wait(600);
			if (s.compact) {
				const shown = Object.entries(s.panes)[0];
				return ["ok", `700x500 触发折叠形态：只显示 ${shown?.[0]} ${shown?.[1].w}x${shown?.[1].h}，收起的 [${s.hidden.join(",")}]`];
			}
			if (!b) return ["ok", `窗口压到 700x500 后浏览器被收起（转录 ${c?.w}x${c?.h}）——收起也是一种答案`];
			return [b.w >= PANEL.w - 8 && (c?.w ?? 0) >= CONV.w - 8 ? "ok" : "bad",
				`700x500 下：转录 ${c?.w}，浏览器 ${b.w}（底线 ${CONV.w}/${PANEL.w}）`];
		});

		await scene("C5", "四屏时开面板：放不下该有退路", async () => {
			const n = await splitTo(4);
			const s0 = await shot();
			const t = s0.tiles[0];
			if (!t) return ["skip", "没有 tile"];
			const fits = t.w >= CONV.w + PANEL.w || t.h >= CONV.h + PANEL.h;
			await clickTile(0, "终端");
			await wait(1600);
			const s = await shot();
			const at = s.panes["terminal"]?.at;
			if (at) return ["ok", `${n} 屏，每屏 ${t.w}x${t.h}${fits ? "" : "（理论上放不下）"}，终端落在 ${at}`];
			if (s.panels.length) return ["bad", `${n} 屏，每屏 ${t.w}x${t.h}：不该弹成独立窗口 ${s.panels.join(",")}`];
			return ["bad", `${n} 屏，每屏 ${t.w}x${t.h}：点了没反应`];
		});

		await scene("C6", "屏太小时还让不让继续分", async () => {
			const n = await splitTo(4);
			const s = await shot();
			const more = await menu(1, "分屏");
			const t = s.tiles[0];
			return ["ok", `分到 ${n} 屏（每屏 ${t?.w}x${t?.h}）后再点「分屏」：${more}${more === "no item" || more === "disabled" ? "（拦住了，对）" : ""}`];
		});

		// ---- D 弹出与收回 ----
		await scene("D1", "窗口 dock 的面板弹成独立窗口", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			await clickTopBar("在新窗口中打开");
			await wait(1900);
			const s = await shot();
			const gone = !s.panes["browser"];
			const popped = s.panels.some((p) => p.startsWith("browser"));
			return [gone && popped ? "ok" : "bad", `原位腾空=${gone}，面板窗口=[${s.panels.join(",")}]`];
		});

		await scene("D2", "tile 里的面板弹成独立窗口", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			if (!(await shot()).panes["terminal"]) return ["skip", "终端没落进 tile"];
			const clicked = await clickTopBar("在新窗口中打开");
			await wait(1900);
			const s = await shot();
			return [s.panels.length ? "ok" : "bad", `点到弹出按钮=${clicked}，面板窗口=[${s.panels.join(",")}]，tile 里还剩 ${kindsOf(s).join(",") || "无"}`];
		});

		await scene("D3", "弹出之后刷新主窗口，那条回家的路还在吗", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			await clickTopBar("在新窗口中打开");
			await wait(1900);
			const before = (await shot()).panels;
			/*
			 * 真正要问的是「回家的那条路还在不在」，不只是窗口还开着。
			 *
			 * 那份记录从前是个模块作用域的 Map：主窗口一刷新就空了，而弹出去的窗口还好好地开着，
			 * 于是点「收回」时落到默认位置而不是它离开的那个槽。现在它和 dock 布局一起存盘。
			 */
			await reload();
			const s = await shot();
			const homes = await evaluate<string[]>(`Object.keys(JSON.parse(localStorage.getItem("dw:homes") || "{}"))`);
			const kept = s.panels.length === before.length;
			return [kept && homes.length > 0 ? "ok" : "bad",
				`刷新前面板窗口 [${before.join(",")}]，刷新后 [${s.panels.join(",")}]；` +
				`刷新后盘上的回家记录 [${homes.join(",") || "空 ← 收回时会落默认位置"}]`];
		});

		await scene("D4", "弹出之后关掉那一屏", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			if (!(await shot()).panes["terminal"]) return ["skip", "终端没落进 tile"];
			await clickTopBar("在新窗口中打开");
			await wait(1800);
			const popped = (await shot()).panels;
			await clickTile(0, "关闭此屏");
			await wait(1200);
			const s = await shot();
			return ["ok", `弹出后 [${popped.join(",")}]，关掉那一屏之后 [${s.panels.join(",")}]，剩 ${s.tiles.length} 屏`];
		});

		// ---- E 生命周期 ----
		await scene("E1", "单屏：窗口 dock 的布局刷新后恢复", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const before = await shot();
			if (!before.panes["browser"]) return ["skip", "面板没开出来"];
			const wasOn = before.tiles[0]?.id;
			await reload();
			const after = await shot();
			const nowOn = after.tiles[0]?.id;
			/*
			 * 恢复不出来先问一句：刷新前后是不是同一个会话。
			 *
			 * 窗口 dock 的布局按会话存（dw:dock:<sessionId>）。刷新后要是换了人，读的就是另一
			 * 把钥匙，拿到默认布局——那是每会话布局该有的样子，不是 bug。两者长得一模一样。
			 */
			const same = wasOn && nowOn && wasOn === nowOn;
			/* 盘上那份到底长什么样——存坏了和读丢了是两个 bug。 */
			const onDisk = await evaluate<Record<string, string>>(`(() => {
				const out = {};
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.startsWith('dw:panedock:')) out[k.slice(12, 20)] = (localStorage.getItem(k) || '').replace(/"(type|dir|sizes)":/g, '').slice(0, 130);
				}
				return out;
			})()`);
			for (const [k, v] of Object.entries(onDisk)) console.log(`     盘上 ${k}：${v}`);
			const logs = await evaluate<string[]>(`JSON.parse(localStorage.getItem("__probe") || "[]")`).catch(() => []);
			for (const l of logs.slice(0, 12)) console.log(`     ${l}`);
			return [after.panes["browser"] ? "ok" : same ? "bad" : "skip",
				`刷新前会话 ${wasOn} 带浏览器，刷新后会话 ${nowOn}${same ? "（同一个）" : "（换人了——那就该是默认布局）"}，`
				+ `面板 [${kindsOf(after).join(",") || "无"}]，localStorage [${after.keys.join(" ")}]`];
		});

		await scene("E2", "分屏：窗口 dock 的布局刷新后恢复", async () => {
			/*
			 * 先分屏，再开浏览器——顺序不能反。
			 *
			 * 窗口 dock 的布局按会话存（dw:dock:<id>）。先开浏览器的话它存在分屏之前那个会话
			 * 名下，而分屏会把焦点交给新进来的那一屏，刷新后恢复的是后者，读的是另一把钥匙，
			 * 拿到空布局——那是每会话布局该有的样子，不是分屏的毛病。反过来排，浏览器就存在
			 * 分屏之后的当前会话名下，刷新读的是同一把钥匙，这时才测得出「分屏状态下会不会
			 * 恢复」。
			 */
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTopBar("浏览器");
			await wait(1300);
			const before = await shot();
			if (!before.panes["browser"]) return ["skip", "分屏后浏览器就不在了"];
			await reload();
			const after = await shot();
			const logs = await evaluate<string[]>(`JSON.parse(localStorage.getItem("__probe") || "[]")`).catch(() => []);
			for (const l of logs.slice(0, 14)) console.log(`     ${l}`);
			return [after.panes["browser"] ? "ok" : "bad",
				`刷新前 ${before.tiles.length} 屏带浏览器，刷新后 ${after.tiles.length} 屏、面板 [${kindsOf(after).join(",") || "无"}]`];
		});

		await scene("E2b", "先单屏开面板（落在窗口 dock），再分屏，再刷新", async () => {
			/*
			 * 这一条问的才是 E2 那个设计决策的真实形态，而 E2 自己绕开了它。
			 *
			 * E2 先分屏再开浏览器——分屏之后从工具条开的面板落在**那一屏**（pane dock），所以
			 * 它量的其实是 E3。窗口 dock 在分屏下只会装着「进入分屏之前就开着的」面板，要摆出
			 * 那个状态，顺序必须是先开后分。
			 *
			 * 而那正是难处所在：浏览器存在分屏之前那个会话名下，分屏把焦点交给新进来的一屏，
			 * 刷新后 `activeSessionId` 恢复成焦点那一屏，读的是另一把钥匙。
			 */
			if (!(await clickTopBar("浏览器"))) return ["skip", "工具条上没有浏览器按钮"];
			await wait(1300);
			const single = await shot();
			if (single.panes["browser"]?.at !== "window") return ["skip", `单屏下浏览器没落在窗口 dock，而在 ${single.panes["browser"]?.at ?? "哪儿都不在"}`];
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			const split = await shot();
			if (split.panes["browser"]?.at !== "window") {
				return ["bad", `分屏之后浏览器就从窗口 dock 上走了，现在在 ${split.panes["browser"]?.at ?? "哪儿都不在"}`];
			}
			await reload();
			const after = await shot();
			return [after.panes["browser"]?.at === "window" ? "ok" : "bad",
				`刷新前 ${split.tiles.length} 屏、浏览器在窗口 dock，刷新后 ${after.tiles.length} 屏、浏览器在 ${after.panes["browser"]?.at ?? "哪儿都不在"}（面板 [${kindsOf(after).join(",") || "无"}]，钥匙 [${after.keys.join(" ")}]）`];
		});

		await scene("E3", "分屏：tile 里的面板刷新后恢复", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const before = await shot();
			if (!before.panes["terminal"]) return ["skip", "终端没落进 tile"];
			await reload();
			const after = await shot();
			return [after.panes["terminal"] ? "ok" : "bad",
				`刷新前终端在 ${before.panes["terminal"].at}，刷新后 ${after.panes["terminal"]?.at ?? "不见了"}；屏数 ${before.tiles.length}→${after.tiles.length}`];
		});

		await scene("E4", "分屏结构本身刷新后恢复", async () => {
			const n = await splitTo(3);
			const before = await shot();
			await reload();
			const after = await shot();
			return [after.tiles.length === before.tiles.length ? "ok" : "bad",
				`刷新前 ${before.tiles.length} 屏（分到 ${n}），刷新后 ${after.tiles.length} 屏`];
		});

		await scene("E5", "切换会话，窗口 dock 跟着换布局", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			const first = (await shot()).panes["browser"];
			await openRow(1);
			await wait(1200);
			const second = await shot();
			await openRow(0);
			await wait(1200);
			const back = (await shot()).panes["browser"];
			return ["ok", `会话一带浏览器（${first ? "有" : "无"}）→ 换到会话二 [${kindsOf(second).join(",") || "无"}] → 换回来 [${back ? "浏览器回来了" : "浏览器没回来"}]`];
		});

		await scene("E6", "关掉分屏中的一屏，它的面板去哪", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			await clickTile(0, "终端");
			await wait(1300);
			const before = await shot();
			if (!before.panes["terminal"]) return ["skip", "终端没落进 tile"];
			await clickTile(0, "关闭此屏");
			await wait(1300);
			const s = await shot();
			return ["ok", `关掉带终端的那一屏：剩 ${s.tiles.length} 屏，面板 [${kindsOf(s).join(",") || "无"}]，面板窗口 [${s.panels.join(",")}]`];
		});

		await scene("E7", "把分屏里的会话开到新窗口", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			const before = await shot();
			const r = await menu(1, "新窗口");
			await wait(2200);
			const s = await shot();
			return [s.sessions.length > before.sessions.length ? "ok" : "bad",
				`点「新窗口」=${r}，会话窗口 ${before.sessions.length}→${s.sessions.length}，主窗口屏数 ${before.tiles.length}→${s.tiles.length}`];
		});

		await scene("E8", "同一会话同时在分屏里和独立窗口里", async () => {
			if ((await splitTo(2)) < 2) return ["skip", `没分成两屏：${splitWhy}`];
			const tiles0 = (await shot()).tiles.map((t) => t.id);
			await menu(1, "新窗口");
			await wait(2200);
			const s = await shot();
			const both = s.sessions.some((id) => tiles0.includes(id));
			return ["ok", `分屏里有 [${tiles0.join(",")}]，独立窗口里有 [${s.sessions.join(",")}]${both ? " ← 同一个会话两处都在" : ""}`];
		});

		/*
		 * ---- G 拖拽 × 尺寸 ----
		 *
		 * 同一套拖拽动作，在六种舞台上各跑一遍。单看「能不能拖」没有意义——窗口够宽时哪儿都
		 * 能落，窄下来之后落点会一个个消失，而消失的过程正是人说的「拖不动」。所以每个舞台
		 * 先把可落的方向算出来，再拿实际行为跟它对。
		 */
		const stages: { id: string; label: string; screens: number; view?: { w: number; h: number } }[] = [
			{ id: "G1", label: "单屏 + 正常窗口", screens: 1 },
			{ id: "G2", label: "两屏 + 正常窗口", screens: 2 },
			{ id: "G3", label: "四屏 + 正常窗口", screens: 4 },
			{ id: "G4", label: "单屏 + 窄窗口 900x600", screens: 1, view: { w: 900, h: 600 } },
			{ id: "G5", label: "两屏 + 窄窗口 900x600", screens: 2, view: { w: 900, h: 600 } },
			{ id: "G6", label: "单屏 + 极窄 700x500", screens: 1, view: { w: 700, h: 500 } },
		];

		for (const st of stages) {
			if (!want(st.id)) continue;
			await reset();
			try {
				if (st.view) {
					await app.send("Emulation.setDeviceMetricsOverride", { width: st.view.w, height: st.view.h, deviceScaleFactor: 0, mobile: false });
					await wait(900);
				}
				const got = st.screens > 1 ? await splitTo(st.screens) : 1;
				if (st.screens > 1 && got < 2) { say(`${st.id}a`, `${st.label}：开终端`, "skip", `没分成屏：${splitWhy}`); continue; }
				const stage = await shot();
				const tile = stage.tiles[0];
				const room = tile
					? `${tile.w}x${tile.h}（并排${tile.w >= CONV.w + PANEL.w ? "行" : "不行"}，上下${tile.h >= CONV.h + PANEL.h ? "行" : "不行"}）`
					: "没有 tile";
				console.log(`\n── ${st.id} ${st.label}：${got} 屏，第一屏 ${room}`);

				// a 开面板
				const opened = st.screens > 1 ? await clickTile(0, "终端") : await clickTopBar("终端");
				await wait(1500);
				let s = await shot();
				const at = s.panes["terminal"]?.at;
				if (!at) {
					say(`${st.id}a`, `${st.label}：开终端`, "bad",
						s.panels.length ? `不该弹成独立窗口 ${s.panels.join(",")}` : `点到按钮=${opened}，面板没出现`);
					continue;
				}
				say(`${st.id}a`, `${st.label}：开终端`, "ok", `落在 ${at}，${s.panes["terminal"]!.w}x${s.panes["terminal"]!.h}`);

				// b 拖到容器的另一侧
				const box = s.panes["terminal"]!;
				const host = st.screens > 1 ? stage.tiles[0]! : { x: 0, y: 0, w: home.w, h: home.h };
				const far = box.y > host.y + host.h / 2
					? { x: host.x + Math.round(host.w / 2), y: host.y + Math.round(host.h / 5) }
					: { x: host.x + Math.round(host.w / 2), y: host.y + Math.round(host.h * 4 / 5) };
				await drag("terminal", far);
				await wait(1200);
				s = await shot();
				const moved = s.panes["terminal"];
				say(`${st.id}b`, `${st.label}：拖动换位`, moved ? "ok" : "bad",
					moved ? `y ${box.y}→${moved.y}${Math.abs(moved.y - box.y) > 20 ? "（换位了）" : "（没换成，落点被拒）"}` : "拖完面板不见了");

				// c 拖到窗口角落这种一定非法的地方，必须复原而不是把面板弄丢
				if (moved) {
					await drag("terminal", { x: 6, y: 6 });
					await wait(1200);
					const back = (await shot()).panes["terminal"];
					say(`${st.id}c`, `${st.label}：拖到非法处松手`, back ? "ok" : "bad",
						back ? `回到 ${back.at}，没丢` : "面板丢了——放不下必须复原");
				}

				// d 拖完之后两边还在不在底线以上
				const finShot = await shot();
				const fin = finShot.panes;
				const conv = fin["conversation"], term = fin["terminal"];
				if (finShot.compact) {
					const shown = Object.entries(fin).find(([k]) => k !== "conversation") ?? Object.entries(fin)[0];
					const floor = shown && shown[0] === "conversation" ? CONV : PANEL;
					const okOne = shown ? shown[1].w >= floor.w - 8 && shown[1].h >= floor.h - 8 : false;
					say(`${st.id}d`, `${st.label}：拖完仍在底线以上`, okOne ? "ok" : "bad",
						`窄窗口折叠成单面板形态，此刻显示 ${shown?.[0]} ${shown?.[1].w}x${shown?.[1].h}；收起的 [${finShot.hidden.join(",")}]`);
				} else if (conv && term) {
					const okW = conv.w >= CONV.w - 8 && term.w >= PANEL.w - 8;
					const okH = conv.h >= CONV.h - 8 && term.h >= PANEL.h - 8;
					say(`${st.id}d`, `${st.label}：拖完仍在底线以上`, okW && okH ? "ok" : "bad",
						`转录 ${conv.w}x${conv.h}（底线 ${CONV.w}x${CONV.h}），终端 ${term.w}x${term.h}（底线 ${PANEL.w}x${PANEL.h}）`);
				} else {
					const miss = ["conversation", "terminal"].filter((k) => !fin[k]);
					say(`${st.id}d`, `${st.label}：拖完仍在底线以上`, miss.includes("conversation") ? "bad" : "skip",
						`少了 [${miss.join(",")}]，画得出来的 [${Object.keys(fin).join(",")}]，挂着但画不出的 [${finShot.hidden.join(",") || "无"}]`);
				}
			} catch (error) {
				say(st.id, st.label, "skip", `跑挂了：${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// ---- F 多窗口 ----
		await scene("F1", "关掉面板窗口之后，面板回树里吗", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			await clickTopBar("在新窗口中打开");
			await wait(1900);
			const popped = (await shot()).panels;
			if (!popped.length) return ["skip", "没弹出来"];
			await evaluate(`(async () => {
				const r = await window.lyra.windows.list();
				for (const p of r.panels || []) await window.lyra.windows.closePanel({ kind: p.kind, scope: p.scope });
				return true;
			})()`);
			await wait(1500);
			const s = await shot();
			return ["ok", `关掉 [${popped.join(",")}] 之后：主窗口面板 [${kindsOf(s).join(",") || "无"}]，面板窗口 [${s.panels.join(",")}]`];
		});

		await scene("F2", "同一种面板能不能弹出两个窗口", async () => {
			await clickTopBar("浏览器");
			await wait(1100);
			await clickTopBar("在新窗口中打开");
			await wait(1800);
			const once = (await shot()).panels;
			await clickTopBar("浏览器");
			await wait(1500);
			const twice = (await shot()).panels;
			return [twice.length <= 1 ? "ok" : "bad", `弹一次 [${once.join(",")}]，再点一次「浏览器」后 [${twice.join(",")}]`];
		});
	} finally {
		console.log(`\n════ 汇总 ════`);
		const bad = results.filter((r) => r.v === "bad");
		const skip = results.filter((r) => r.v === "skip");
		console.log(`${results.length} 条：${results.filter((r) => r.v === "ok").length} 正常，${bad.length} 有问题，${skip.length} 没跑成`);
		if (bad.length) { console.log(`\n有问题的：`); for (const r of bad) console.log(`  ❌ ${r.id} ${r.title}\n       ${r.note}`); }
		if (skip.length) { console.log(`\n没跑成的：`); for (const r of skip) console.log(`  ⏭️ ${r.id} ${r.title} —— ${r.note}`); }
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
