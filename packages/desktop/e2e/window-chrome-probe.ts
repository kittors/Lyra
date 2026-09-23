/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 窗口顶上那一行，在每一种摆法下有没有东西压到一起。
 *
 * 那一行是三方共用的：系统画的窗口控件（macOS 的红绿灯在左，Windows 的最小化/最大化/关闭在右）、
 * 应用自己的侧边栏开关，以及面板自己的标题栏和标签。三者谁都不在对方的坐标系里，所以「有没有叠
 * 上」只能在布局跑完之后量，`getBoundingClientRect` 在 happy-dom 里全是 0——单测一个字也验不到。
 *
 * 每一种摆法都验四条：
 *
 *   1. 侧边栏开关不压住任何面板的标题或标签
 *   2. 面板右上角的控件不伸进系统按钮那一块（Windows 和 Linux 才有，macOS 那头是空的）
 *   3. 有 header 的平台上，每个面板都在 header 底下，一个都不许骑上去
 *   4. 没有标题栏被窗口左边裁掉
 *
 * 摆法是累积的：对话 → 加一个终端 → 加到三个终端 → 再加一个浏览器 → 把终端最大化。每一种再乘上
 * 侧边栏开合和原生全屏两档。收起侧边栏、把终端顶到左上角、再进全屏，正是那个 bug 的现场。
 *
 * **平台**：`--win` 会把渲染层临时改成按 Windows 的几何排版并重新构建，拍完自动还原。本机是
 * macOS，`titleBarOverlay` 只在 Windows 和 Linux 上存在，系统那三个按钮这里画不出来——所以 Windows
 * 这一轮验的是**布局给它们让出的位置对不对**，而不是按钮本身长什么样。
 *
 * 用法：
 *   node --experimental-strip-types e2e/window-chrome-probe.ts [输出目录]
 *   node --experimental-strip-types e2e/window-chrome-probe.ts --win [输出目录]
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const run = promisify(execFile);
const WIN = process.argv.includes("--win");
const OUT_DIR =
	process.argv.slice(2).find((a) => !a.startsWith("--")) ??
	join(homedir(), "Desktop", WIN ? "Lyra窗口-Windows" : "Lyra窗口-macOS");
const PORT = 9675;
const INSPECT_PORT = 9676;

/** 红绿灯让位那一档和普通边距那一档，跟 `titlebar.ts` 里是同一对数。 */
const TRAFFIC_LIGHTS_PX = 78;
const TOOLBAR_EDGE_PX = 12;
/** Windows 那三个按钮按 100% 缩放算的宽度，和 `OVERLAY_FALLBACK` 是同一个数。 */
const WIN_OVERLAY_PX = 138;

/**
 * 主进程里够到**主窗口**。
 *
 * `_linkedBinding` 是唯一一条路，理由见 `app.ts` 里 `main()` 的注释。但 `getAllWindows()[0]` 不是
 * 主窗口——跑起来之后这里有两个窗口，那条 IPC 曾经发给了另一个，于是渲染层什么都没收到，而探针
 * 只看到「开关还在 78」，查了三轮才发现。挑可见的里面最宽的那个。
 */
const WINDOW =
	'process._linkedBinding("electron_browser_window").BrowserWindow.getAllWindows()' +
	".filter((w) => !w.isDestroyed() && w.isVisible())" +
	".sort((a, b) => b.getBounds().width - a.getBounds().width)[0]";

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	if (!ok) console.log(`     ❌ ${what}  —— ${saw}`);
}

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 8000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

async function settle(frames = 40): Promise<void> {
	await evaluate(
		`new Promise(resolve=>{let n=${frames};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`,
	);
}

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
}

/**
 * 点一个按钮，按 aria-label **或者**可见文字找，返回有没有点到。
 *
 * 只按 aria-label 找过一版，于是侧边栏那几个导航项（「拉取请求」之类）一个都点不中——文字在
 * innerText 里，它们没有 aria-label。而探针照样往下跑，把 dock 的面板当成 PR 视图量了一遍，
 * 印出八格绿的。没点中不是没问题。
 */
async function click(pattern: string): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const re = new RegExp(${JSON.stringify(pattern)});
		const hit = [...document.querySelectorAll('button, [role="button"]')].find((e) => {
			if (!e.checkVisibility || !e.checkVisibility()) return false;
			return re.test(e.getAttribute('aria-label') || '') || re.test((e.innerText || '').trim());
		});
		if (hit) hit.click();
		return !!hit;
	})()`);
}

interface Rect { x: number; y: number; w: number; h: number }
interface PaneShape {
	kind: string;
	rect: Rect;
	/** 标题栏里真正画了东西的那些块：标签、标题文字、右侧控件。 */
	marks: { what: string; x: number; y: number; w: number; h: number }[];
}
interface Shape {
	width: number;
	headerBar: boolean;
	header: Rect | null;
	toggle: Rect | null;
	panes: PaneShape[];
}

/*
 * 注入的代码里不写反引号：这段字符串还要在外层的模板串里活一遍，注释里一个反引号就能把它截断，
 * 而 oxlint 会在一个完全无关的位置报「少个分号」。踩过一次。
 */
const READ = `(() => {
	const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	const vis = (el) => el && el.checkVisibility() && el.getBoundingClientRect().width > 0;
	const toggle = [...document.querySelectorAll('button[aria-label]')].find((b) => /侧边栏/.test(b.getAttribute('aria-label') || '')) ?? null;
	const header = document.querySelector('[data-ly-window-header]');
	/*
	 * 拉取请求那个视图不走 dock，它有自己的两栏和自己的顶栏——正因为这里只扫 [data-dock-pane]，
	 * 它压住开关的那个 bug 整套矩阵一次都没抓到。用 data-ly-toprow 把那两条顶栏也收进来。
	 */
	const extra = [...document.querySelectorAll('[data-ly-toprow]')].filter(vis).map((row) => ({
		kind: 'toprow:' + (row.getAttribute('data-ly-toprow') || '?'),
		rect: box(row),
		marks: [...row.querySelectorAll('button, [data-ly-title]')].filter(vis).map((el) => ({
			what: 'ctl:' + ((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 10)),
			...box(el),
		})),
	}));
	const panes = [...document.querySelectorAll('[data-dock-pane]')].filter(vis).map((pane) => {
		const head = pane.querySelector('[data-dock-heading]');
		const marks = [];
		for (const tab of pane.querySelectorAll('[data-tab]')) if (vis(tab)) marks.push({ what: 'tab:' + (tab.innerText || '').trim().slice(0, 8), ...box(tab) });
		if (head) for (const el of head.querySelectorAll('button, [data-dock-heading-slot]')) if (vis(el)) marks.push({ what: 'ctl:' + ((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 10)), ...box(el) });
		return { kind: pane.getAttribute('data-dock-pane'), rect: box(pane), marks };
	});
	return {
		width: window.innerWidth,
		headerBar: !!header,
		header: header ? box(header) : null,
		toggle: toggle ? box(toggle) : null,
		panes: [...panes, ...extra],
	};
})()`;

function overlaps(a: Rect, b: { x: number; y: number; w: number; h: number }): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 一种摆法下的全部判断。
 *
 * 读不到开关、或者一个面板都没画出来，都算**没验到**，直接判失败。第一版在标签数组为空时照样印
 * 绿勾，而那一轮终端压根没开——没量到不是没问题。
 */
function judge(where: string, s: Shape, endReserved: number): void {
	const marks = s.panes.flatMap((p) => p.marks.map((m) => ({ ...m, kind: p.kind })));
	console.log(`   ${where}：${s.panes.length} 个面板，${marks.length} 个标记，开关 ${JSON.stringify(s.toggle)}`);

	if (!s.toggle) {
		check(`${where}｜读到侧边栏开关`, false, "没找到那颗按钮，这一轮什么都没验到");
		return;
	}
	if (s.panes.length === 0) {
		check(`${where}｜读到面板`, false, "一个可见面板都没有，这一轮什么都没验到");
		return;
	}

	// 1. 开关不压住任何标题栏里的东西。
	const hit = marks.filter((m) => overlaps(s.toggle!, m));
	check(
		`${where}｜开关不压住标题栏`,
		hit.length === 0,
		`压住了 ${hit.map((m) => `${m.kind}/${m.what}`).join("、")}`,
	);

	/*
	 * 2. 右上角的控件不伸进系统按钮那一块——**只在没有 header 的时候才是个问题**。
	 *
	 * 有 header 的平台上系统按钮画在 header 的右端，而每个面板都在 header 底下（第 3 条守着），
	 * 两者的 y 根本不相交，面板控件的 x 越过那条线毫无影响。第一版漏了这个前提，于是 Windows 那轮
	 * 报了 16 条红，说「新建终端伸进了系统按钮区」——量得没错，结论是错的：那两块东西差着一整行。
	 *
	 * 留着这一条是因为它仍然守着一种真实的摆法：没有 header、系统按钮又在右上角的窗口。macOS 的
	 * `end` 是 0，走不到这里。
	 */
	if (!s.headerBar && endReserved > 0) {
		const edge = s.width - endReserved;
		const intruding = marks.filter((m) => m.x + m.w > edge + 1);
		check(
			`${where}｜控件不伸进系统按钮区`,
			intruding.length === 0,
			`${intruding.map((m) => `${m.kind}/${m.what} 右沿 ${m.x + m.w}`).join("、")} 越过了 ${edge}`,
		);
	}

	// 3. 有 header 的平台上，面板一个都不许骑到 header 上。
	if (s.headerBar && s.header) {
		const top = s.header.y + s.header.h;
		const riding = s.panes.filter((p) => p.rect.y < top - 1);
		check(
			`${where}｜面板都在 header 底下`,
			riding.length === 0,
			`${riding.map((p) => `${p.kind} 顶在 ${p.rect.y}`).join("、")}，header 底边在 ${top}`,
		);
	}

	// 4. 没有标记被窗口左边裁掉。
	const clipped = marks.filter((m) => m.x < 0);
	check(`${where}｜没有标记被窗口边裁掉`, clipped.length === 0, `${clipped.map((m) => `${m.what} x=${m.x}`).join("、")}`);
}

/** 侧边栏当前是不是开着——按开关的说明文字读，比猜状态可靠。 */
async function navOpen(): Promise<boolean> {
	return evaluate<boolean>(
		`!![...document.querySelectorAll('button[aria-label]')].find((b) => /隐藏侧边栏/.test(b.getAttribute('aria-label') || ''))`,
	);
}

async function setNav(open: boolean): Promise<void> {
	if ((await navOpen()) === open) return;
	await click("侧边栏");
	await settle(30);
}

/**
 * 进出原生全屏，并且等那条状态**真的落到布局上**，而不是数帧。
 *
 * 发两次是因为第一次可能发早了：渲染层挂 `onFullScreenChange` 是在一个 effect 里，窗口刚起来那
 * 几百毫秒它还没挂上，IPC 就丢了。整套矩阵里只有第一格栽在这上面——后面每一格都对，而那一格报的
 * 是「这一档没验到」，不是「没问题」。等不到就重发一次，再等不到才判失败。
 */
async function setFullScreen(on: boolean): Promise<boolean> {
	const want = WIN ? TOOLBAR_EDGE_PX : on ? TOOLBAR_EDGE_PX : TRAFFIC_LIGHTS_PX;
	const landed = `(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((e) => /侧边栏/.test(e.getAttribute('aria-label') || '')); return b && Math.round(b.getBoundingClientRect().x) === ${want}; })()`;
	for (let attempt = 0; attempt < 2; attempt++) {
		await app.main(`${WINDOW}.webContents.send("window:fullscreen", ${on})`);
		try {
			await until(landed, 4000);
			break;
		} catch {
			if (attempt === 1) break;
		}
	}
	await settle(20);
	// Windows 那边左端本来就不随全屏变，没有可观测的位移，只能信 IPC 发出去了。
	return WIN || (await evaluate<number>(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((e) => /侧边栏/.test(e.getAttribute('aria-label') || '')); return b ? Math.round(b.getBoundingClientRect().x) : -1; })()`)) === want;
}

/**
 * 一种摆法。
 *
 * `expect` 是这一步声称会带来的东西，用一个 CSS 选择器写。没有它的话，一个点空了的场景会安安静静
 * 地量上一个场景的界面，然后印出一串绿的——整套矩阵里 PR 视图那八格就这么假绿过一轮。
 */
const SCENES: { name: string; setup: () => Promise<void>; expect?: string }[] = [
	{ name: "只有对话", setup: async () => {} },
	{
		name: "一个终端",
		setup: async () => {
			await click("^终端");
			await settle(30);
		},
	},
	{
		name: "三个终端",
		setup: async () => {
			for (let i = 0; i < 2; i++) {
				await evaluate(`(() => {
					const pane = document.querySelector('[data-dock-pane="terminal"]');
					const add = pane && [...pane.querySelectorAll('button[aria-label]')].find((b) => /新建终端|新终端/.test(b.getAttribute('aria-label') || ''));
					if (add) add.click();
					return !!add;
				})()`);
				await settle(20);
			}
		},
	},
	{
		name: "终端 + 浏览器",
		setup: async () => {
			await click("^浏览器");
			await settle(40);
		},
	},
	/*
	 * 拉取请求那一页**没有**摆进这套矩阵，而它正是那颗开关压住标题的地方（列表展开时压「全部」
	 * 那个筛选按钮，列表收起时压 PR 的标题）。
	 *
	 * 够不到的原因是这个 fixture 没有配代码托管账号：那一页于是整页是「未添加代码托管账号」的空态，
	 * 空态直接 return，两条顶栏一条都不渲染。要在这里覆盖它，得连 GitHub 的接口一起假造。
	 *
	 * 所以那条规则改由单测守：`test/ui/dock-corner.test.ts` 里的「拉取请求那一页，谁在最左边谁让位」
	 * 把 `prInsets` 的八种组合全测了。这里留这段话，是为了下一个人知道这一页不在矩阵里、以及为什么。
	 */
	{
		name: "终端最大化",
		setup: async () => {
			await evaluate(`(() => {
				const pane = document.querySelector('[data-dock-pane="terminal"]');
				const b = pane && [...pane.querySelectorAll('button[aria-label]')].find((x) => /^全屏/.test(x.getAttribute('aria-label') || ''));
				if (b) b.click();
				return !!b;
			})()`);
			await settle(40);
		},
	},
];

/** `--win` 那一轮要先把渲染层改成按 Windows 排版，跑完还原。两个文件，各一处。 */
const PATCHES: { file: string; from: string; to: string }[] = [
	{
		file: "src/app/layout.tsx",
		from: 'const headerBar = hasHeaderBar(bridge.platform ?? "darwin", !onPhone());',
		to: 'const headerBar = hasHeaderBar("win32", !onPhone());',
	},
	{
		file: "src/app/layout.tsx",
		from: '() => titlebarInsets(bridge.platform ?? "darwin", nativeFullScreen, reserved, !onPhone()),',
		// Windows' own buttons sit at the right end only; see `overlayReserved`.
		to: `() => titlebarInsets("win32", nativeFullScreen, { start: 0, end: ${WIN_OVERLAY_PX} }, !onPhone()),`,
	},
	{
		file: "electron/window.ts",
		from: 'titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",',
		to: 'titleBarStyle: "hidden",',
	},
];

async function applyPatches(): Promise<() => Promise<void>> {
	const backups: { file: string; copy: string }[] = [];
	for (const file of new Set(PATCHES.map((p) => p.file))) {
		const copy = join(tmpdir(), `lyra-probe-${file.replace(/\W/g, "_")}`);
		await copyFile(file, copy);
		backups.push({ file, copy });
	}
	for (const { file, from, to } of PATCHES) {
		const text = await readFile(file, "utf8");
		if (!text.includes(from)) throw new Error(`补丁对不上，源码已经变了：${file}\n  找的是：${from}`);
		await writeFile(file, text.replace(from, to));
	}
	console.log("已临时切到 Windows 排版，正在构建…");
	await run("pnpm", ["build"], { cwd: join(import.meta.dirname, "..", "..", ".."), maxBuffer: 64 * 1024 * 1024 });
	return async () => {
		for (const { file, copy } of backups) await copyFile(copy, file);
		console.log("源码已还原，正在重新构建…");
		await run("pnpm", ["build"], { cwd: join(import.meta.dirname, "..", "..", ".."), maxBuffer: 64 * 1024 * 1024 });
	};
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	const restore = WIN ? await applyPatches() : null;

	try {
		app = await startApp({ port: PORT, seed: seedInteractions, scaleFactor: 2, inspectPort: INSPECT_PORT });
		const endReserved = WIN ? WIN_OVERLAY_PX : 0;
		try {
			await until(`document.querySelector('[data-ly-row="qa-short"] > button')`, 20000);
			await evaluate(`document.querySelector('[data-ly-row="qa-short"] > button').click()`);
			await settle(30);

			for (const scene of SCENES) {
				await scene.setup();
				console.log(`\n【${scene.name}】`);
				if (scene.expect) {
					const there = await evaluate<boolean>(`!!document.querySelector(${JSON.stringify(scene.expect)})`);
					check(`${scene.name}｜这一步声称要打开的东西真的在`, there, `${scene.expect} 没出现——这一场量的是上一场的界面`);
					if (!there) continue;
				}
				for (const open of [true, false]) {
					await setNav(open);
					const nav = open ? "栏开" : "栏收";

					const windowed = await evaluate<Shape>(READ);
					judge(`${scene.name}·${nav}·窗口`, windowed, endReserved);
					await shot(`${scene.name}-${nav}-窗口`);

					const entered = await setFullScreen(true);
					check(`${scene.name}·${nav}｜全屏状态传到了渲染层`, entered, "开关没挪位，这一档没验到");
					const full = await evaluate<Shape>(READ);
					judge(`${scene.name}·${nav}·全屏`, full, endReserved);
					await shot(`${scene.name}-${nav}-全屏`);
					await setFullScreen(false);
				}
			}
		} finally {
			await app?.stop().catch(() => {});
		}
	} finally {
		await restore?.();
	}

	const failed = checks.filter((c) => !c.ok);
	console.log(`\n${checks.length - failed.length}/${checks.length} 项通过（${WIN ? "Windows 排版" : "macOS"}）`);
	console.log(`截图在 ${OUT_DIR}`);
	if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
