/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 交付卡片悬停预览的几何与悬停行为探针。
 *
 * 量三件事，都是「看得见但说不清」的那类：
 *   1. diff 面板在浮层里的四周留白——菜单内衬（margin/padding-right）让代码底色没铺满卡片；
 *   2. 浮层是否盖住了卡片头部的「撤销」「审核」；
 *   3. 从文件行往上移一点点，浮层还在不在——中间那段没有 mouseenter 的死区。
 *
 * 只跑不断言：改之前跑一遍当基线，改之后再跑一遍对照。
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "delivery-preview");

/** 够高（出竖向滚动条）也够宽（出横向滚动条）的一份改动。 */
function payload(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 40; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("横向溢出用的长行".repeat(i === 3 ? 14 : 1))};`);
	return lines.join("\n") + "\n";
}

let app: RunningApp;
let server: Server;
let turns = 0;

async function main() {
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const index = turns++;
			const tool = index < 5 ? { name: "write", input: { path: `delivery-${index}.ts`, content: payload(index) } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "这一轮没有修改文件。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	app = await startApp({
		port: 9671,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});
	await mkdir(OUT, { recursive: true });

	await click('[data-ly-row="qa-short"]');
	await send("修改五个文件用于验证变更卡片");
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 5 个文件')`);
	// 贴着窗口底部，也就是真实用法里它出现的位置：上方有整整一屏可以展开。
	await app.evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'end',behavior:'instant'})`);
	await frames();

	// 最后一个可见的文件行——用户抱怨的正是「放在最后一个文件」上。
	const row = await app.evaluate<{ x: number; y: number; top: number; height: number; hit: string }>(
		`(()=>{const rows=[...document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)')];const e=rows[rows.length-1];const r=e.getBoundingClientRect();const p={x:r.x+60,y:r.y+r.height/2};const under=document.elementFromPoint(p.x,p.y);return {...p,top:r.top,height:r.height,hit:e.contains(under)?'行本身':(under?under.className:'null')}})()`,
	);
	console.log("悬停目标：", JSON.stringify(row));
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y });

	const openedAt = Date.now();
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`);
	console.log("打开耗时（含轮询开销）ms:", Date.now() - openedAt);
	await frames(30);

	console.log("\n=== 几何 ===");
	console.log(JSON.stringify(await geometry(), null, 1));

	console.log("\n=== 头部按钮是否被盖住 ===");
	console.log(JSON.stringify(await obscured(), null, 1));

	await shot("preview");
	// 底部那条：横向滚动条和最后一行代码挨在一起，放大了才看得出压没压住。
	await shot("preview-bottom", await app.evaluate(`(()=>{const r=document.querySelector('[aria-label="文件变更预览"]').getBoundingClientRect();return {x:r.x,y:r.bottom-70,width:r.width,height:78,scale:2}})()`));

	const before = await where();
	console.log("\n=== 往上移一点（离开文件行 4px / 12px）之后 ===");
	for (const up of [4, 12, 40]) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.top - up });
		await wait(500);
		console.log(`${up}px：`, await alive(), "｜位置", (await where()) === before ? "没动" : "变了 → " + (await where()));
	}
	await shot("after-up");

	console.log("\n=== 停在浮层的竖向滚动条上 ===");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y });
	await until(`document.querySelector('[aria-label="文件变更预览"]')`);
	await frames();
	const thumb = await app.evaluate<{ x: number; y: number } | null>(
		`(()=>{const t=document.querySelector('[aria-label="文件变更预览"] .ly-thumb');if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	if (!thumb) console.log("（没有竖向滚动条）");
	else {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...thumb });
		await wait(400);
		console.log("停在 thumb 上：", await alive());
	}

	console.log("\n=== 从下往上扫过文件行（模拟去够按钮）===");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 });
	await wait(400);
	const buttons = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const b=document.querySelector('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]')||document.querySelector('[data-turn-delivery] button');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	// 从卡片下方走直线到「审核」，一路扫过文件行。
	for (let step = 0; step <= 10; step++) {
		const t = step / 10;
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x + (buttons.x - row.x) * t, y: row.y + 30 + (buttons.y - row.y - 30) * t });
		await wait(30);
	}
	await wait(200);
	console.log("走到按钮上之后：", JSON.stringify(await obscured()));
	await shot("reaching-buttons");

	console.log("\n=== 点文件 / 审核，进右边这一轮的 diff ===");
	await click('[data-turn-delivery] [data-delivery-file]');
	await until(`document.querySelector('[data-dock-pane="delivery"] .ly-diff-scroll')`);
	console.log("点文件：", JSON.stringify(await dock("delivery"), null, 1));
	await shot("delivery-pane");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 });
	await wait(400);
	await click('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]');
	await until(`document.querySelectorAll('[data-dock-pane="delivery"] [data-delivery-diff]').length>=3`);
	console.log("点审核：", JSON.stringify(await dock("delivery"), null, 1));
	await shot("delivery-review");

	console.log("\n产物：", OUT);
}

/** 点开之后，内容在右边的面板里，窗口中间没有弹层。 */
async function dock(kind: "file" | "review" | "delivery") {
	return app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane=${JSON.stringify(kind)}]');
		const modal=document.querySelector('[data-ly-modal]');
		const box=pane?pane.getBoundingClientRect():null;
		return {pane:Boolean(pane),modal:Boolean(modal),text:(pane?.innerText??'').slice(0,80),
			box:box?{x:Math.round(box.x),y:Math.round(box.y),w:Math.round(box.width),h:Math.round(box.height)}:null}})()`,
	);
}

async function geometry() {
	return app.evaluate(
		`(()=>{const box=e=>e?e.getBoundingClientRect().toJSON():null;const pop=document.querySelector('[aria-label="文件变更预览"]');
		const host=pop.querySelector('.ly-scroll-host'),view=pop.querySelector('.ly-scroll-view'),diff=pop.querySelector('.ly-diff-scroll'),head=pop.firstElementChild;
		const cs=e=>e?getComputedStyle(e):null;const hs=cs(host),vs=cs(view);
		const p=box(pop),d=box(diff);
		return {popover:p,header:box(head),host:box(host),view:box(view),diff:d,
		 hostMargin:{top:hs.marginTop,right:hs.marginRight,bottom:hs.marginBottom},
		 viewPadding:{right:vs.paddingRight,top:vs.paddingTop,bottom:vs.paddingBottom},
		 fade:{top:vs.getPropertyValue('--ly-fade-top'),bottom:vs.getPropertyValue('--ly-fade-bottom'),mask:vs.maskImage.slice(0,60)},
		 gaps:{left:d.left-p.left,right:p.right-d.right,top:d.top-p.top,bottom:p.bottom-d.bottom},
		 scroll:{vertical:Boolean(pop.querySelector('.ly-thumb')),horizontal:Boolean(pop.querySelector('.ly-hthumb'))}}})()`,
	);
}

async function obscured() {
	return app.evaluate(
		`(()=>{const out={};for(const tip of ['撤销这次文件改动','审核全部文件改动']){const b=document.querySelector('[data-turn-delivery] button[data-ly-tip="'+tip+'"]');
		if(!b){out[tip]='缺失';continue}const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
		out[tip]=b.contains(hit)?'可点':'被盖住：'+(hit?(hit.closest('[aria-label]')?.getAttribute('aria-label')??hit.className):'null')}
		return out})()`,
	);
}

/** 浮层现在停在哪、显示的是哪个文件——位置该稳，内容该跟着鼠标。 */
async function where() {
	return app.evaluate<string>(
		`(()=>{const e=document.querySelector('[aria-label="文件变更预览"]');if(!e)return '（没有浮层）';const r=e.getBoundingClientRect();
		return Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'×'+Math.round(r.height)+' | '+e.textContent.slice(0,28)})()`,
	);
}

async function alive() {
	return app.evaluate<string>(
		`(()=>{const on=Boolean(document.querySelector('[aria-label="文件变更预览"]')?.checkVisibility());
		const chain=[...document.querySelectorAll(':hover')].slice(-3).map(e=>e.tagName.toLowerCase()+'.'+String(e.className).split(' ').slice(0,3).join('.'));
		return (on?'还在':'没了')+' | 鼠标实际压着：'+chain.join(' > ')})()`,
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
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await frames();
	const point = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
async function send(text: string) {
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
async function shot(name: string, clip?: Record<string, number>) {
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
	await writeFile(join(OUT, name + ".png"), Buffer.from(image.data, "base64"));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await app?.stop();
		await closeListeningServer(server);
	});
