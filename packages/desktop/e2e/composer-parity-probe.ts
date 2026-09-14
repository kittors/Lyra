/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 主输入框和侧边聊天输入框，那一排到底长得一样不一样。
 *
 * 量的是画出来的结果：每个控件的高度、字号、有没有描边，以及那一行里有没有多出一个别处没有的
 * 按钮。「看着差不多」不算——描边是 1px，肉眼在截图上不一定分得清，但 `border-width` 分得清。
 *
 * 只跑不断言：改之前跑一遍当基线，改之后再跑一遍对照。
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "composer-parity");

let app: RunningApp;

async function main() {
	app = await startApp({ port: 9685, seed: seedInteractions });
	await mkdir(OUT, { recursive: true });
	await click('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('.ly-transcript')`);

	await openPane("侧边聊天");
	await frames(40);

	console.log("=== 两排控件 ===");
	console.log(JSON.stringify(await rows(), null, 1));

	console.log("\n=== 那一行里还写着「随主会话」吗 ===");
	console.log(JSON.stringify(await says()));

	console.log("\n=== 往侧边聊天里贴一张图 ===");
	await paste("chat");
	await frames(40);
	console.log(JSON.stringify(await pasted(), null, 1));
	await shot("side-attachment");

	console.log("\n=== 面板标题栏上的按钮（侧边聊天还空着）===");
	console.log(JSON.stringify(await headerMarks()));

	await shot("composers");

	/*
	 * 发一条，再看一次。
	 *
	 * 「重开一轮」只在有东西可丢的时候画，所以空着的时候读到的是「没有」——那既可能是对的，也
	 * 可能是它根本没接上。真发一条才分得清。模型没配，请求会失败，但 `ask` 是先把消息画上去再
	 * 发请求的，标题栏那一枚要的就是这个。
	 */
	console.log("\n=== 发一条之后 ===");
	await app.evaluate(
		`(()=>{const area=[...document.querySelectorAll('textarea')].find(a=>a.closest('[data-dock-pane="chat"]'));
		if(!area)throw Error('侧边聊天没有输入框');
		const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
		set.call(area,'探针发的一句');area.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	);
	await frames(20);
	await app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane="chat"]');
		const send=[...pane.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='发送');
		if(!send)throw Error('找不到发送按钮');send.click();return true})()`,
	);
	await frames(60);
	console.log("侧边聊天里的消息数：", await app.evaluate(`document.querySelectorAll('[data-dock-pane="chat"] .ly-bubble, [data-dock-pane="chat"] [data-side-row]').length`));
	console.log("面板标题栏上的按钮：", JSON.stringify(await headerMarks()));
	console.log("那一排还是三个吗：", JSON.stringify(await says()));
	await shot("after-send");
	console.log("\n产物：", OUT);
}

/**
 * 每个输入框那一排画出来的东西。
 *
 * 从 textarea 往上 `closest()` 找外壳：`.ly-composer` 两个输入框都在用，直接按类名取会把两个
 * 混成一个。
 */
async function rows() {
	return app.evaluate(
		`(()=>{const out={};
		for(const area of document.querySelectorAll('textarea')){
			const shell=area.closest('.ly-composer');if(!shell)continue;
			const pane=shell.closest('[data-dock-pane]');
			const name=pane?pane.dataset.dockPane:'（不在面板里）';
			const round=(n)=>Math.round(n*10)/10;
			const controls=[...shell.querySelectorAll('button')].map(b=>{
				const r=b.getBoundingClientRect(),cs=getComputedStyle(b);
				return {标签:(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,24),
				 高:round(r.height),字号:cs.fontSize,描边:cs.borderTopWidth,圆角:cs.borderRadius,
				 放大类:b.classList.contains('ly-composer-control')};
			}).filter(b=>b.高>0);
			out[name]={控件数:controls.length,控件:controls};
		}
		return out})()`,
	);
}

/** 那一排的文字，逐个控件——「随主会话」这类配置话术应该一个都不剩。 */
async function says() {
	return app.evaluate(
		`(()=>{const out={};
		for(const area of document.querySelectorAll('textarea')){
			const shell=area.closest('.ly-composer');if(!shell)continue;
			const pane=shell.closest('[data-dock-pane]');
			out[pane?pane.dataset.dockPane:'（不在面板里）']=[...shell.querySelectorAll('button')]
				.map(b=>b.textContent.trim()).filter(Boolean);
		}
		return out})()`,
	);
}

/** 侧边聊天面板自己的标题栏上都有什么——「重开一轮」应该在这儿。 */
async function headerMarks() {
	return app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane="chat"]');if(!pane)return '（没有侧边聊天面板）';
		const actions=pane.querySelector('[data-dock-actions]');if(!actions)return '（没有动作区）';
		return [...actions.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||'').trim())})()`,
	);
}

/**
 * 往某个输入框里贴一张真的图。
 *
 * 走 paste 而不是点「+」：文件选择器是原生的，探针点不动；而 `ComposerShell` 的粘贴和拖放走的是
 * 同一条 `onFiles`，所以这一条量到的就是那一条。
 */
async function paste(kind: string) {
	await app.evaluate(
		`(()=>{const area=[...document.querySelectorAll('textarea')].find(a=>a.closest('[data-dock-pane=${JSON.stringify(kind)}]'));
		if(!area)throw Error('没找到输入框');
		area.focus();
		const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
		const file=new File([png],'shot.png',{type:'image/png'});
		const dt=new DataTransfer();dt.items.add(file);
		area.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
		return true})()`,
	);
}

/** 贴完之后：正文里有没有那枚标记，镜像层上画没画出来，附件条上是不是同一个名字。 */
async function pasted() {
	return app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane="chat"]');
		const area=pane.querySelector('textarea');
		const mirror=pane.querySelector('[data-command-mirror]');
		const tokens=[...(mirror?.querySelectorAll('.ly-attachment-token')??[])];
		const tiles=[...pane.querySelectorAll('[data-ly-attachment]')];
		return {正文:area.value,
		 镜像层画出来的标签:tokens.map(e=>e.textContent),
		 附件条上的格子:tiles.length,
		 光标:area.selectionStart}})()`,
	);
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
