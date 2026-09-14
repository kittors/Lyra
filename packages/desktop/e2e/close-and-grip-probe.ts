/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 两件「东西没在该在的地方」的量法。
 *
 *   1. 按下关闭之后窗口是收起来了还是被拆了，以及再唤起时里面的东西还在不在；
 *   2. 面板标题栏上那条把手画在哪——居不居中，离上沿多远，会不会压到右边的按钮。
 *
 * 只跑不断言：改之前跑一遍当基线，改之后再跑一遍对照。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { electronLaunch, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "close-and-grip");
const INSPECT = 9683;

/**
 * 主进程里怎么拿到 `app` 和 `BrowserWindow`。
 *
 * 想当然的几条路在调试器的那个作用域里全是死的，逐条试过：主进程是 ESM，模块作用域的 `require`
 * 不在全局上（`typeof require` 是 undefined）；evaluate 出来的代码没有宿主给的动态 import 回调，
 * `await import('electron')` 直接报 "A dynamic import callback was not specified"；
 * `process.getBuiltinModule` 函数在，但 Electron 没把自己注册成 Node 内建模块，返回 undefined；
 * 用 `--require` 预加载一个 CJS 桥也不行，这个仓库里的 electron 二进制被改名成了 Lyra，Electron
 * 据此认定自己是打包应用，然后整串 NODE_OPTIONS 都不认。
 *
 * 剩下的是 `process._linkedBinding`，它不经过任何模块系统。拿到的不是半成品：Electron 的 JS 层
 * 就是在这两个对象上直接挂的方法，所以 `getAllWindows` 这些一并都在。
 */
const ELECTRON = `(()=>({BrowserWindow:process._linkedBinding('electron_browser_window').BrowserWindow,app:process._linkedBinding('electron_browser_app').app}))`;

let app: RunningApp;

async function main() {
	app = await startApp({ port: 9681, inspectPort: INSPECT, seed: seedInteractions });
	await mkdir(OUT, { recursive: true });
	await click('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('.ly-transcript')`);

	// 把手只在「有别的地方可搬」时才画，所以先开够面板。
	for (const pane of ["终端", "浏览器"]) await openPane(pane);
	await frames(30);

	console.log("=== 2. 把手画在哪 ===");
	console.log(JSON.stringify(await grips(), null, 1));
	await hover("browser");
	await frames(20);
	await shot("grips-hover");

	// 窄面板：右边按钮和面板中心离得最近的那一档。
	await app.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
	await frames(30);
	console.log("\n900px 窗口下：");
	console.log(JSON.stringify(await grips(), null, 1));
	await hover("browser");
	await frames(20);
	await shot("grips-narrow");
	await app.send("Emulation.clearDeviceMetricsOverride");
	await frames(20);

	console.log("\n=== 1. 关窗之后 ===");
	// 拿不到 electron 的话，下面每一行都会以同一种方式失败——先把原因问出来。
	await app.evaluate(`window.__lyraKept = 'kept-' + Date.now(); true`);
	console.log("窗口（关之前）：", JSON.stringify(await windows()));
	console.log("渲染层（关之前）：", JSON.stringify(await probe()));

	/*
	 * `BrowserWindow.close()`，也就是红色按钮和 ⌘W 汇进去的那个事件。
	 *
	 * 另外两条看着能用的都不算数，试过：页面里的 `window.close()` 在 Electron 里什么也不做；
	 * CDP 的 `Page.close` 会把窗口拆掉，但它走的是 Chromium 的关页流程，根本不经过 close 事件
	 * ——量到的是「窗口没了」，而那跟我们在 close 上拦没拦住毫无关系。
	 *
	 * setTimeout 是为了别让关闭把这一次 evaluate 的回包一起带走。
	 */
	console.log(
		"关：",
		await app.main<string>(
			`(()=>{const {BrowserWindow}=${ELECTRON}();const w=BrowserWindow.getAllWindows().filter(x=>!x.isDestroyed()&&x.isVisible()).sort((a,b)=>a.id-b.id)[0];setTimeout(()=>w.close(),50);return 'close() 已发给窗口 '+w.id})()`,
		),
	);
	await new Promise((r) => setTimeout(r, 2_000));
	console.log("窗口（关之后）：", JSON.stringify(await windows()));
	console.log("渲染层（关之后）：", JSON.stringify(await probe()));

	console.log("\n再唤起（第二个实例撞锁，走 second-instance → reveal）…");
	const second = await secondLaunch(app.home);
	console.log("第二个实例退出码：", second.code);
	await new Promise((r) => setTimeout(r, 2_500));
	console.log("窗口（唤起后）：", JSON.stringify(await windows()));
	console.log("渲染层（唤起后）：", JSON.stringify(await probe()));
	await shot("after-revive");

	/*
	 * 最要紧的一条：退出还退不退得掉。
	 *
	 * 关窗改成收起来，靠的是在 close 上 preventDefault——写错了就是一个退不出去的应用，
	 * 比原来的毛病严重得多。托盘的「退出」和 ⌘Q 都走 `app.quit()`，就是这里。
	 */
	console.log("\n=== 退出还走得通吗 ===");
	console.log("quit：", await app.main<string>(`(()=>{const {app}=${ELECTRON}();setTimeout(()=>app.quit(),100);return 'quit() 已排上'})()`));
	console.log("进程退干净了：", await waitGone(12_000));

	console.log("\n产物：", OUT);
}

/** 主进程手上还有哪些窗口，各自什么状态——桥没装上就说没装上，别把「问不出来」混成「没有窗口」。 */
async function windows() {
	return app
		.main(
			`(()=>{const {BrowserWindow}=${ELECTRON}();
		return BrowserWindow.getAllWindows().map(w=>w.isDestroyed()?{id:w.id,已销毁:true}:{id:w.id,已销毁:false,看得见:w.isVisible(),最小化:w.isMinimized()})})()`,
		)
		.catch((error: unknown) => `（问不出来：${String(error).slice(0, 120)}）`);
}

/** 退出之后调试端口应该跟着没，没就是进程真的走了。 */
async function waitGone(within: number): Promise<boolean> {
	const end = Date.now() + within;
	while (Date.now() < end) {
		const listed = await fetch(`http://127.0.0.1:${INSPECT}/json/list`)
			.then((r) => r.json())
			.catch(() => null);
		if (!listed) return true;
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
}

/** 窗口还在不在，看不看得见，里面的东西留没留下。 */
async function probe(): Promise<{ alive: boolean; kept?: string; visibility?: string; scroll?: number; panes?: string[]; error?: string }> {
	try {
		const seen = await app.evaluate<{ kept: string; visibility: string; scroll: number; panes: string[] }>(
			`({kept:window.__lyraKept ?? '（没了）',visibility:document.visibilityState,scroll:Math.round(document.querySelector('.ly-transcript')?.scrollTop ?? -1),panes:[...document.querySelectorAll('[data-dock-pane]')].map(p=>p.dataset.dockPane)})`,
		);
		return { alive: true, ...seen };
	} catch (error) {
		return { alive: false, error: String(error).slice(0, 300) };
	}
}

/** 每个面板的把手，相对它自己的卡片和它自己的按钮。 */
async function grips() {
	return app.evaluate(
		`(()=>{const out={};
		for(const pane of document.querySelectorAll('[data-dock-pane]')){
			const kind=pane.dataset.dockPane,grip=pane.querySelector('[data-dock-grip="'+kind+'"]');
			if(!grip)continue;
			const mark=grip.querySelector('span'),card=pane.querySelector('.ly-dock-card')||pane;
			const header=pane.querySelector('[data-dock-header]'),actions=pane.querySelector('[data-dock-actions]');
			const m=mark.getBoundingClientRect(),c=card.getBoundingClientRect(),h=header.getBoundingClientRect();
			const buttons=[...actions.querySelectorAll('button')].map(b=>b.getBoundingClientRect());
			const round=(n)=>Math.round(n*10)/10;
			out[kind]={卡片:[Math.round(c.left),Math.round(c.top),Math.round(c.width)],
			 水平偏移:round((m.left+m.right)/2-(c.left+c.right)/2),
			 横线距卡片上沿:round(m.top-c.top),
			 横线距header顶:round(m.top-h.top),
			 按钮顶距header顶:buttons.length?round(Math.min(...buttons.map(b=>b.top))-h.top):null,
			 横线底到按钮顶:buttons.length?round(Math.min(...buttons.map(b=>b.top))-m.bottom):null,
			 横线与按钮水平重叠:buttons.some(b=>b.left<m.right&&b.right>m.left),
			 可点区:[round(grip.getBoundingClientRect().top-h.top),round(grip.getBoundingClientRect().height)],
			 透明度:getComputedStyle(grip).opacity}}
		return out})()`,
	);
}

/** 真把指针放到面板上，让 :hover 生效——把手平时是透明的。 */
async function hover(kind: string) {
	const at = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const p=document.querySelector('[data-dock-pane=${JSON.stringify(kind)}]');const r=p.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+40)}})()`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none" });
}

/**
 * 同一个 profile 再起一个，撞上单实例锁。
 *
 * 赢家收到 `second-instance` 并 `reveal()`，这正是用户从 dock 点回来那条路：窗口还在就把它
 * 亮出来，不在才重新造一个。所以这也是「关掉之后还回得来吗」的答案。
 */
function secondLaunch(home: string): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const output: string[] = [];
		const { executable, argv } = electronLaunch();
		const second = spawn(executable, argv, {
			cwd: ROOT,
			env: { ...process.env, LYRA_HOME: home, ELECTRON_ENABLE_LOGGING: "1" },
			stdio: "pipe",
			detached: true,
		});
		second.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
		second.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
		second.on("exit", (code) => resolve({ code, output: output.join("").slice(-2_000) }));
		setTimeout(() => {
			try {
				if (second.pid) process.kill(-second.pid, "SIGKILL");
			} catch {}
		}, 20_000);
	});
}

async function openPane(label: string) {
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`);
	await frames(20);
}
async function until(expression: string) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}))}tick()})`,
	);
}
async function frames(n = 20) {
	await app.evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
	await frames();
}
async function shot(name: string) {
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, name + ".png"), Buffer.from(image.data, "base64"));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await app?.stop();
	});

assert.ok(true);
