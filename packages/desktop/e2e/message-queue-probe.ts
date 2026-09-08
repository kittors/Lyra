/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 排队条的探针：真窗口里量它进来、让位、走掉的样子。
 *
 * 单元测试量得了顺序和状态，量不了这几件：条出现在输入框上方的哪一格、拖动时让开的那几行是不是真的
 * 在动、退场是不是把队伍平稳地带上来、以及「编辑」之后输入框有没有亮那一下。这些只有画出来才算数。
 *
 * 模型这一端是可控的：请求进来先挂着，探针说结束才结束——排队要的正是「一直在跑」这个前提。
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "message-queue");

let app: RunningApp;
let server: Server;
/** 还挂着的那些回合，先进先出——探针说停哪一个就停哪一个。 */
const open: { res: ServerResponse; index: number }[] = [];
let turns = 0;

function emit(res: ServerResponse, type: string, data: object) {
	res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

/** 结束最早的那个回合，像模型自己写完了一样。 */
function finishTurn() {
	const held = open.shift();
	if (!held) return false;
	emit(held.res, "content_block_stop", { index: 0 });
	emit(held.res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
	emit(held.res, "message_stop", {});
	held.res.end();
	return true;
}

async function main() {
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const index = turns++;
			res.writeHead(200, { "content-type": "text/event-stream" });
			emit(res, "message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: `第 ${index + 1} 轮开始了，正在忙。` } });
			open.push({ res, index });
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	app = await startApp({
		port: 9673,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});
	await mkdir(OUT, { recursive: true });

	await click('[data-ly-row="qa-short"]');
	await send("第一句：开一轮，让它一直忙着");
	await until(`document.querySelector('[data-composer-send="stop"]')`);
	console.log("这一轮跑起来了，挂着的回合数：", open.length);

	console.log("\n=== 正忙时说的三句，去了哪里 ===");
	for (const text of ["第二句：排在第一位", "第三句：排在第二位", "第四句：排在第三位"]) {
		await send(text);
		await wait(320);
	}
	console.log("条上：", JSON.stringify(await rows(), null, 1));
	console.log("转录里的用户消息：", await app.evaluate(`document.querySelectorAll('[data-dock-pane="conversation"] [data-question-index]').length`));
	console.log("几何：", JSON.stringify(await geometry(), null, 1));
	await shot("queued");
	await shot("queued-strip", await clipOf("[data-composer-queue]", 12));

	console.log("\n=== 拖第三行到最前面 ===");
	const grips = await app.evaluate<{ x: number; y: number }[]>(
		`[...document.querySelectorAll('[data-queue-grip]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...grips[2] });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...grips[2], button: "left", clickCount: 1 });
	// 一路挪上去，中途量一次：让位的那两行应该已经在往下走。
	for (let step = 1; step <= 8; step++) {
		const y = grips[2].y + ((grips[0].y - grips[2].y) * step) / 8;
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grips[2].x, y, button: "left" });
		await wait(28);
		if (step === 4) {
			console.log("拖到一半时各行的位移：", await transforms());
			await shot("dragging", await clipOf("[data-composer-queue]", 14));
		}
	}
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grips[2].x, y: grips[0].y - 6, button: "left" });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: grips[2].x, y: grips[0].y - 6, button: "left", clickCount: 1 });
	await frames();
	console.log("松手之后：", JSON.stringify(await rows()));
	await shot("reordered", await clipOf("[data-composer-queue]", 12));

	console.log("\n=== 删掉中间那条：收拢的过程 ===");
	const before = await heights();
	await clickAt('[data-queue-row]:nth-of-type(2) [data-queue-remove]');
	await wait(90);
	console.log("按下去 90ms 后（应当正在收）：", JSON.stringify(await heights()), "起始：", JSON.stringify(before));
	await shot("removing", await clipOf("[data-composer-queue]", 14));
	await wait(320);
	console.log("收完之后：", JSON.stringify(await rows()));

	console.log("\n=== 编辑：行收掉，字回到输入框 ===");
	await clickAt("[data-queue-row]:last-of-type [data-queue-more]");
	await until(`document.querySelector('[role="menu"]')`);
	await frames();
	await shot("more-menu");
	/*
	 * 亮那一下只有 340ms，跨进程读一次就过去了——先在页面里盯着，再去点。
	 *
	 * 从输入框往上找那个外壳，而不是在对话面板里挑第一个 `.ly-composer`：页面里挂着两个（侧边聊天
	 * 用的是同一个外壳，没显示但在），第一次写成后者，量到的是另一个框，于是「没亮」是探针的错觉。
	 */
	await app.evaluate(
		`(()=>{const shell=document.querySelector('[data-dock-pane="conversation"] textarea').closest('.ly-composer');window.__catch=[];
		new MutationObserver(()=>window.__catch.push(shell.className.includes('ly-composer-catch')?'亮了':'灭了')).observe(shell,{attributes:true,attributeFilter:['class']});
		shell.addEventListener('animationstart',(e)=>window.__catch.push('animationstart:'+e.animationName));
		shell.addEventListener('animationend',(e)=>window.__catch.push('animationend:'+e.animationName));})()`,
	);
	console.log(
		"输入框往上找到的外壳：",
		await app.evaluate(
			`(()=>{const ta=document.querySelector('[data-dock-pane="conversation"] textarea'),shell=ta.closest('.ly-composer');
			return {找到:Boolean(shell),同一个:shell===document.querySelector('[data-dock-pane="conversation"] .ly-composer'),类:String(shell&&shell.className).slice(0,48),几个:document.querySelectorAll('.ly-composer').length}})()`,
		),
	);
	await clickAt('[role="menu"] button');
	console.log("输入框里：", JSON.stringify(await app.evaluate(`document.querySelector('[data-dock-pane="conversation"] textarea').value`)));
	console.log("焦点在：", await app.evaluate(`document.activeElement?.tagName+'.'+String(document.activeElement?.className).split(' ')[0]`));
	console.log("亮灭记录：", await app.evaluate(`window.__catch`));
	console.log(
		"输入框亮了没：",
		await app.evaluate(
			`(()=>{const shell=document.querySelector('[data-dock-pane="conversation"] textarea').closest('.ly-composer');const s=getComputedStyle(shell);
			return {类:shell.classList.contains('ly-composer-catch'),动画:s.animationName,时长:s.animationDuration,减速:document.documentElement.dataset.reduceMotion??'（未设）'}})()`,
		),
	);
	await shot("edited");
	await wait(400);
	console.log("剩下：", JSON.stringify(await rows()));

	console.log("\n=== 这一轮结束，队首自己走 ===");
	const queuedBefore = await rows();
	finishTurn();
	/*
	 * 等的是那一行开始收，不是「停止」按钮消失——它不会消失。
	 *
	 * 队首被送出去就立刻开了下一轮，所以按钮从上一轮的停止直接变成这一轮的停止，中间没有一帧是空
	 * 的。第一次写成等按钮消失，探针在这里等到超时，而屏幕上一切正常：等错了东西。
	 */
	await until(`document.querySelector('[data-queue-row][data-leaving]')||!document.querySelector('[data-queue-row]')`);
	console.log("刚结束时（应当有一行正在收）：", JSON.stringify(await rows()));
	await shot("draining", await clipOf("[data-composer-queue]", 14));
	await wait(400);
	console.log("排队的：", JSON.stringify(queuedBefore), "→", JSON.stringify(await rows()));
	console.log("转录里的用户消息：", await app.evaluate(`document.querySelectorAll('[data-dock-pane="conversation"] [data-question-index]').length`));
	console.log("挂着的回合数（说明它真的发出去了）：", open.length);
	await shot("after-drain");

	console.log("\n=== 停止之后，剩下的那些不会自己发 ===");
	await send("第五句：停止之后应当留在条上");
	await wait(200);
	await clickAt('[data-composer-send="stop"]');
	await wait(500);
	console.log("按下停止之后：", JSON.stringify(await rows()), "｜挂着的回合数：", open.length);
	await shot("stopped");

	// 亮色下再看一眼：条只有一圈描边和一层很淡的底，两种主题里它们都得站得住。
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:"light"}})})()`);
	await until(`document.documentElement.style.colorScheme==='light'&&!document.documentElement.hasAttribute('data-theme-switching')`);
	await frames();
	await shot("queued-strip-light", await clipOf("[data-composer-queue]", 12));

	console.log("\n产物：", OUT);
}

/** 条上现在有哪几行，以及哪几行正在收。 */
async function rows() {
	return app.evaluate<{ text: string; leaving: boolean }[]>(
		`[...document.querySelectorAll('[data-queue-row]')].map(e=>({text:e.textContent.trim().slice(0,18),leaving:e.hasAttribute('data-leaving')}))`,
	);
}

async function transforms() {
	return app.evaluate<string[]>(
		`[...document.querySelectorAll('[data-queue-row]')].map(e=>(e.hasAttribute('data-dragging')?'拖着的 ':'')+(getComputedStyle(e).transform||'none'))`,
	);
}

async function heights() {
	return app.evaluate<number[]>(
		`[...document.querySelectorAll('[data-queue-row]')].map(e=>Math.round(e.getBoundingClientRect().height))`,
	);
}

/** 条和输入框、和转录的关系——它必须读起来是输入框的一部分。 */
async function geometry() {
	return app.evaluate(
		// 从输入框往上找它的外壳：页面里挂着两个 `.ly-composer`，侧边聊天那个没显示，挑错了整段几何都是假的。
		`(()=>{const box=e=>e?e.getBoundingClientRect():null;const strip=document.querySelector('[data-composer-queue]'),shell=document.querySelector('[data-dock-pane="conversation"] textarea').closest('.ly-composer');
		const s=box(strip),c=box(shell),row=box(document.querySelector('[data-queue-row]'));
		return {条:{x:Math.round(s.x),width:Math.round(s.width),height:Math.round(s.height)},
		 输入框:{x:Math.round(c.x),width:Math.round(c.width)},
		 左右对齐:Math.round(s.x-c.x)+'/'+Math.round(c.right-s.right),
		 条底到输入框顶:Math.round(c.top-s.bottom),
		 行高:Math.round(row.height),
		 行距:(()=>{const r=[...document.querySelectorAll('[data-queue-row]')].map(e=>e.getBoundingClientRect().top);return r.length>1?Math.round(r[1]-r[0]):null})()}})()`,
	);
}

async function clipOf(selector: string, pad: number) {
	return app.evaluate<Record<string, number>>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.max(0,r.x-${pad}),y:Math.max(0,r.y-${pad}),width:r.width+${pad * 2},height:r.height+${pad * 2},scale:2}})()`,
	);
}

async function until(expression: string) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}))}tick()})`,
	);
}
async function frames(n = 20) {
	await app.evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}
function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function clickAt(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await frames(2);
	const point = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
const click = clickAt;
async function send(text: string) {
	await clickAt('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await frames(3);
}
async function shot(name: string, clip?: Record<string, number>) {
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(image.data, "base64"));
}

try {
	await main();
} finally {
	// 收尾：还挂着的那几个回合放掉，否则窗口关了它们还在等。
	while (finishTurn());
	await app?.stop();
	await closeListeningServer(server);
}
