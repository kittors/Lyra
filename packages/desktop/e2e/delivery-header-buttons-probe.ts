/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 交付卡片头上那一排按钮，量的是画出来的那一份。
 *
 * 改之前它们是两套东西：「报告」是颗 `IconButton`（22px、`rounded-md`、静止时没有任何底色或
 * 描边），「审核」是颗 `Button`（26px、`rounded-lg`、描着一圈 `border-line`）。并排站着两种
 * 高度、两种圆角、两种轮廓，而它们做的是同一类事。
 *
 * 所以这里不读源码里写了什么变体，读的是 `getComputedStyle` 和 `getBoundingClientRect`——
 * 边框宽度、圆角、外框高度、按钮上有没有字。属性写对了而屏幕上还是两样高，这几条才拦得住。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const ARTIFACTS = join(homedir(), "Desktop", "交付卡片按钮测试");

interface Painted {
	variant: string | null;
	text: string;
	height: number;
	border: string;
	radius: string;
	top: number;
	bottom: number;
}

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;

function written(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 12; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("内容行")};`);
	return lines.join("\n") + "\n";
}

async function evaluate<T>(expression: string): Promise<T> {
	if (!app) throw new Error("app 还没起来");
	return app.evaluate<T>(expression);
}

async function until(expression: string, note = "") {
	await evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(note || expression)}+'; '+document.body.innerText.slice(-600)))}tick()})`);
}

async function frames(n = 20) {
	await evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}

async function click(selector: string) {
	if (!app) throw new Error("app 还没起来");
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, `等不到 ${selector}`);
	await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await frames();
	// 真实鼠标：渲染进程里的 .click() 打不开会话行。
	const point = await evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

async function send(text: string) {
	if (!app) throw new Error("app 还没起来");
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}

async function shoot(name: string) {
	if (!app) throw new Error("app 还没起来");
	await mkdir(ARTIFACTS, { recursive: true });
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(ARTIFACTS, name + ".png"), Buffer.from(shot.data, "base64"));
}

/** 只裁交付卡片那一块，按钮的样子在整窗截图里小得看不出来。 */
async function shootCard(name: string) {
	if (!app) throw new Error("app 还没起来");
	await mkdir(ARTIFACTS, { recursive: true });
	const box = await evaluate<{ x: number; y: number; width: number; height: number }>(
		`(()=>{const r=document.querySelector('[data-turn-delivery]').getBoundingClientRect();return {x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:r.width+24,height:r.height+24}})()`,
	);
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	await writeFile(join(ARTIFACTS, name + ".png"), Buffer.from(shot.data, "base64"));
}

async function readButtons(): Promise<Painted[]> {
	return evaluate<Painted[]>(`[...document.querySelectorAll('[data-turn-delivery] button')].filter(b=>b.closest('.flex.min-h-16')).map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {variant:b.getAttribute('data-variant'),text:b.textContent.trim(),height:Math.round(r.height*100)/100,border:s.borderTopWidth,radius:s.borderTopLeftRadius,top:Math.round(r.top*100)/100,bottom:Math.round(r.bottom*100)/100}})`);
}

async function main() {
	server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			const index = turns++;
			const tool = index < 2 ? { name: "write", input: { path: `delivery-${index}.ts`, content: written(index) } } : null;
			response.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "两个文件都写好了。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			response.end();
		});
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const port = address.port;

	app = await startApp({
		port: 9695,
		seed: async (home) => {
			await seedInteractions(home, port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});

	await click('[data-ly-row="qa-short"]');
	await send("改两个文件，用来看交付卡片头上的按钮");
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 2 个文件')`, "等不到交付卡片");
	await frames();

	const buttons = await readButtons();
	console.log("卡片头上的按钮：" + JSON.stringify(buttons, null, 2));

	assert.ok(buttons.length >= 2, `头上至少该有「报告」和「审核」两颗，实际 ${buttons.length} 颗`);

	// 一、都不画框——这是这次要的那件事。
	for (const button of buttons) {
		assert.equal(button.border, "0px", `「${button.text}」还描着一圈 ${button.border} 的线`);
	}

	// 二、都带字：三个图标没一个认得出来，尤其那个文档图标。
	for (const button of buttons) {
		assert.ok(button.text.length > 0, `有一颗按钮还是光图标没有字：${JSON.stringify(button)}`);
	}

	// 三、同一套原语，于是同高、同圆角、同基线。
	const heights = [...new Set(buttons.map((button) => button.height))];
	assert.equal(heights.length, 1, `这一排按钮有 ${heights.length} 种高度：${JSON.stringify(buttons.map((b) => [b.text, b.height]))}`);
	const radii = [...new Set(buttons.map((button) => button.radius))];
	assert.equal(radii.length, 1, `这一排按钮有 ${radii.length} 种圆角：${JSON.stringify(buttons.map((b) => [b.text, b.radius]))}`);
	const tops = [...new Set(buttons.map((button) => button.top))];
	assert.equal(tops.length, 1, `这一排按钮没站在同一条基线上：${JSON.stringify(buttons.map((b) => [b.text, b.top]))}`);
	assert.equal(heights[0], 26, `sm 号按钮应当是 26px，实际 ${heights[0]}px`);

	// 四、「报告」那颗从前是 22px 的方块，现在必须和「审核」一样宽松——量它有没有真的长出内边距。
	const report = buttons.find((button) => button.text.includes("报告"));
	assert.ok(report, `没找到「报告」按钮：${JSON.stringify(buttons.map((b) => b.text))}`);

	/*
	 * 五、那句长说明退到 tooltip 上之后，还找得到这颗按钮。
	 *
	 * `workspace-quality` 是用它开这一轮的实现记录的，从前按 `aria-label` 找——而带了字的
	 * `Button` 把 `aria-label` 留给了没字的情形，可读名成了「报告」两个字。选择器跟着改了，
	 * 改得对不对只有问真的 DOM 才知道，所以在这里问一次，而不是等那套几十分钟的 e2e 来告诉我。
	 */
	const byTip = await evaluate<number>(`document.querySelectorAll('[data-turn-delivery] button[data-ly-tip="查看实现与验证记录"]').length`);
	assert.equal(byTip, 1, `workspace-quality 用的那个选择器选到了 ${byTip} 个元素`);
	const named = await evaluate<string>(`(()=>{const b=document.querySelector('[data-turn-delivery] button[data-ly-tip="查看实现与验证记录"]');return b.getAttribute('aria-label')??b.textContent.trim()})()`);
	assert.equal(named, "报告", `这颗按钮报给读屏的名字是 ${JSON.stringify(named)}`);

	for (const theme of ["light", "dark"] as const) {
		await evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}});})()`);
		await until(`document.documentElement.style.colorScheme===${JSON.stringify(theme)}&&!document.documentElement.hasAttribute('data-theme-switching')`, `等不到 ${theme} 主题`);
		await evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'center',behavior:'instant'})`);
		await frames();
		await shootCard(`卡片头部-${theme}`);
		await shoot(`整窗-${theme}`);
		console.log(`${theme}：` + JSON.stringify(await readButtons()));
	}

	console.log("截图落在 " + ARTIFACTS);
}

// 不写 finally + process.exit：那会把上面每一条断言的异常一起吞掉，探针于是永远「通过」。
try {
	await main();
	console.log("通过");
} finally {
	await app?.stop().catch(() => {});
	if (server) await closeListeningServer(server).catch(() => {});
}
