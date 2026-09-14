/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 横着滚的那些条，到底滚不滚得动、两头化没化开。
 *
 * 量的是画出来的结果：`scrollLeft` 真的动了没有，遮罩的两个长度是不是跟着位置变。只有鼠标的人
 * 能不能滚，就是 Shift + 滚轮这一下的事，所以这里发的是真的 `wheel`，不是直接改 `scrollLeft`。
 *
 * 只跑不断言：改之前跑一遍当基线，改之后再跑一遍对照。
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "sideways");

let app: RunningApp;

async function main() {
	app = await startApp({ port: 9687, seed: seedInteractions });
	await mkdir(OUT, { recursive: true });
	await click('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('.ly-transcript')`);

	/*
	 * 终端标签栏：开够标签它才溢出。
	 *
	 * 挑它是因为它是最容易造出溢出的那一条，而这套东西三个标签栏共用同一个 hook——这里能滚，
	 * 子智能体和文件那两条就是同一段代码。
	 */
	await openPane("终端");
	await frames(30);
	for (let i = 0; i < 7; i++) {
		await app.evaluate(
			`(()=>{const b=document.querySelector('[data-dock-pane="terminal"] button[aria-label*="新"],[data-dock-pane="terminal"] button[data-ly-tip*="新"]');if(b)b.click();return true})()`,
		);
		await frames(6);
	}
	await frames(30);

	console.log("=== 终端标签栏 ===");
	console.log(JSON.stringify(await strip(), null, 1));

	console.log("\n--- Shift + 滚轮往右 ---");
	await wheel(240, true);
	await frames(10);
	console.log(JSON.stringify(await strip(), null, 1));

	console.log("\n--- 不按 Shift（应该一动不动，那一下要留给上层）---");
	const before = await strip();
	await wheel(240, false);
	await frames(10);
	const after = await strip();
	console.log(`按之前 ${before.scrollLeft} → 按之后 ${after.scrollLeft}`);

	console.log("\n--- Shift + 滚轮往左，滚回头 ---");
	await wheel(-2000, true);
	await frames(10);
	console.log(JSON.stringify(await strip(), null, 1));

	/*
	 * 那几道蓝条是什么。
	 *
	 * 按住 Shift 在标签栏上操作时冒出来的蓝块，最像的就是文本选区——标签上的字默认是可选的，而
	 * Shift 正是「把选区扩到这里」的修饰键。是不是，问 `getSelection` 最直接。
	 */
	console.log("\n=== 两头那对方向键 ===");
	console.log(JSON.stringify(await arrows(), null, 1));
	console.log("--- 点右箭头 ---");
	await app.evaluate(
		`(()=>{const b=[...document.querySelectorAll('[data-dock-pane="terminal"] button')].find(e=>(e.getAttribute('aria-label')||'')==='往右滚');
		if(!b)throw Error('没有右箭头');b.click();return true})()`,
	);
	await frames(40);
	console.log(JSON.stringify(await arrows(), null, 1));

	console.log("\n=== 按住 Shift 真的点一下，会不会选中 ===");
	/*
	 * 走 CDP 的真实输入，不是 `dispatchEvent` 造的事件。
	 *
	 * 选区是浏览器在原生输入管线里做的，合成事件根本不经过那一层——拿它量到的「没有选区」是假的，
	 * 第一版就这么骗过自己一次。
	 */
	const bar = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const el=document.querySelector('[data-dock-pane="terminal"] .ly-fade-tail');const r=el.getBoundingClientRect();
		return {x:Math.round(r.left+16),y:Math.round(r.top+r.height/2)}})()`,
	);
	for (const [x, shift] of [[bar.x, false], [bar.x + 210, true]] as [number, boolean][]) {
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", { type, x, y: bar.y, button: "left", clickCount: 1, ...(shift ? { modifiers: 8 } : {}) });
		}
		await frames(6);
	}
	console.log(
		JSON.stringify(
			await app.evaluate(
				`(()=>{const sel=document.getSelection();const el=document.querySelector('[data-dock-pane="terminal"] .ly-fade-tail');
				return {选中的字:sel.toString().slice(0,60),选区宽度:sel.rangeCount?Math.round(sel.getRangeAt(0).getBoundingClientRect().width):0,
				 这条上的userSelect:getComputedStyle(el).userSelect}})()`,
			),
		),
	);

	await shot("tabs");
	console.log("\n产物：", OUT);
}

/** 两枚箭头此刻的可见性，以及这条滚到哪——两者读的是同一份状态，该同进同出。 */
async function arrows() {
	return app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane="terminal"]');
		const el=pane.querySelector('.ly-fade-tail');
		const one=(label)=>{const b=[...pane.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||'')===label);
			if(!b)return '（没画）';const cs=getComputedStyle(b);
			return {不透明度:cs.opacity,能点:cs.pointerEvents!=='none',tab停留:b.tabIndex}};
		return {滚到:Math.round(el.scrollLeft),还能滚:Math.round(el.scrollWidth-el.clientWidth),
		 左箭头:one('往左滚'),右箭头:one('往右滚')}})()`,
	);
}

/** 这条标签栏此刻滚到哪、遮罩两头各化开多少。 */
async function strip(): Promise<{ scrollLeft: number; max: number; fadeLeft: string; fadeRight: string }> {
	return app.evaluate(
		`(()=>{const el=document.querySelector('[data-dock-pane="terminal"] [data-terminal-tabs], [data-dock-pane="terminal"] .ly-fade-tail');
		if(!el)throw Error('没找到终端标签栏');
		const cs=getComputedStyle(el);
		return {scrollLeft:Math.round(el.scrollLeft),max:Math.round(el.scrollWidth-el.clientWidth),
		 fadeLeft:cs.getPropertyValue('--ly-fade-left').trim(),fadeRight:cs.getPropertyValue('--ly-fade-right').trim()}})()`,
	);
}

/** 往标签栏上发一下真的滚轮。CDP 的 modifiers 里 8 是 Shift。 */
async function wheel(deltaY: number, shift: boolean) {
	const at = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const el=document.querySelector('[data-dock-pane="terminal"] .ly-fade-tail');const r=el.getBoundingClientRect();
		return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`,
	);
	await app.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: at.x,
		y: at.y,
		deltaX: 0,
		deltaY,
		...(shift ? { modifiers: 8 } : {}),
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
