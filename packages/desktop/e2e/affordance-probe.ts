/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 「按得下去的东西，看起来按得下去吗」——全窗口扫一遍。
 *
 * 两件事，对每一个可交互元素都问一次：
 *   1. 开了「使用指针光标」之后，光标是不是 pointer；
 *   2. 有没有任何一条 `:hover` 规则命中它。
 *
 * 第二条靠翻样式表实现：收集所有含 `:hover` 的选择器，去掉 `:hover` 之后拿元素去 `matches`。
 * Tailwind 的 `hover:bg-x` 编译成 `.hover\:bg-x:hover`，去掉之后正好匹配元素自己的 class；
 * `.group:hover .child` 去掉之后是 `.group .child`，匹配的是被影响的那一个。两种都算数。
 *
 * 只跑不断言：名单是给人看的，哪些「本来就不该有 hover」需要人判断。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "affordance");

let app: RunningApp;

/** 页面里跑的那一段：翻样式表，再对每个可交互元素问那两个问题。 */
/*
 * 手写的 hover 类名单，而不是翻 `document.styleSheets`。
 *
 * 翻样式表在这里行不通：打包后的 CSS 是外链进来的，Electron 里读 `sheet.cssRules` 直接抛跨域，
 * 于是一条规则都收不到、每个元素都被判成「没有 hover」。所以换成两个都能在页面里直接看的证据：
 * 元素自己带没带 Tailwind 的 `hover:`／`group-hover:` 类，以及它命不命中 styles/*.css 里那几个
 * 写了 `:hover` 的自定义类——那份名单短且稳定，用 grep 就能对齐。
 */
const HOVER_CLASSES = ["ly-item", "ly-scroll", "ly-dock-grip", "ly-dock-pane", "ly-pr-row", "ly-splitter", "ly-thumb", "ly-hthumb", "ly-diff-host", "ly-scroll-host", "ly-update-dot", "ly-dialog-action-danger", "ly-dialog-action-secondary"];

const SCAN = `(()=>{
	const named=${JSON.stringify(HOVER_CLASSES)};
	/*
	 * 只看它自己，和它 hover 时会跟着变的那些后代。
	 *
	 * 不往上找祖先：一个没有任何 hover 的按钮，装在一张有 hover 的卡片里，鼠标压上去变的是卡片而
	 * 不是它——那正是要挑出来的情况，顺着祖先找会把它放过去。
	 */
	const own=node=>{const cls=String(node.className||'');
		return /(?:^|\\s)hover:/.test(cls)||named.some(name=>node.classList?.contains(name))};
	const hasHover=el=>own(el)||/(?:^|\\s)group-hover:/.test(String(el.className||''))
		||[...el.querySelectorAll('*')].some(child=>/(?:^|\\s)group-hover:/.test(String(child.className||''))||own(child));
	const roles='[role=tab],[role=switch],[role=button],[role=link],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[role=radio],[role=checkbox],[role=combobox],[role=treeitem]';
	const seen=new Map();
	for(const el of document.querySelectorAll('button,select,a[href],summary,'+roles)){
		if(!el.checkVisibility())continue;
		const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
		if(el.disabled||el.getAttribute('aria-disabled')==='true')continue;
		const cursor=getComputedStyle(el).cursor;
		// grab / col-resize 这些是有意选的，说的是「这个能拖」而不是「这个能点」——不算缺。
		const deliberate=['grab','grabbing','col-resize','row-resize','ns-resize','ew-resize','move','crosshair','zoom-in','zoom-out','not-allowed'].includes(cursor);
		const hover=hasHover(el);
		if((cursor==='pointer'||deliberate)&&hover)continue;
		const label=(el.getAttribute('aria-label')||el.getAttribute('data-ly-tip')||el.textContent||'').trim().slice(0,24);
		const key=el.tagName.toLowerCase()+'['+(el.getAttribute('role')||'')+'] '+String(el.className).split(' ').slice(0,2).join('.')+' | '+label;
		const bad=[];if(cursor!=='pointer'&&!deliberate)bad.push('光标='+cursor);if(!hover)bad.push('疑似无 hover');const miss=bad.join(' 且 ');
		el.dataset.probeCandidate=String(seen.size);
		if(!seen.has(key))seen.set(key,{何处:key,缺:miss,个数:0});
		seen.get(key).个数++;
	}
	return {名单:[...seen.values()].sort((a,b)=>b.个数-a.个数)}})()`;

async function main() {
	app = await startApp({
		port: 9675,
		seed: async (home) => {
			await seedInteractions(home);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			// 扫描的前提：开关是开着的，否则量到的只是「设置没打开」。
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off",
				appearance: { ...settings.appearance, pointerCursor: true } }));
		},
	});
	await mkdir(OUT, { recursive: true });
	await click('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('.ly-transcript')`);

	const places: [string, string][] = [
		["主界面", ""],
		["任务面板", `document.querySelector('button[aria-label="面板"]').click()`],
	];
	for (const [name, open] of places) {
		if (open) { await app.evaluate(open); await frames(20); await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith('任务'))?.click()`); await frames(30); }
		console.log(`\n=== ${name} ===`);
		console.log(JSON.stringify(await app.evaluate(SCAN), null, 1));
		console.log("真鼠标复核后，确实一动不动的：", JSON.stringify(await confirmNoHover(), null, 1));
	}

	// 菜单要在打开的状态下扫——它们是 portal，关着的时候根本不在文档里。
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/模型/.test(e.getAttribute('data-ly-tip')||e.getAttribute('aria-label')||''));b?.click()})()`);
	await frames(25);
	console.log("\n=== 打开模型菜单 ===");
	console.log(JSON.stringify(await app.evaluate(SCAN), null, 1));
	await shot("model-menu-open");
	for (const type of ["keyDown", "keyUp"]) await app.send("Input.dispatchKeyEvent", { type, key: "Escape", windowsVirtualKeyCode: 27 });
	await frames(20);

	console.log("\n=== 设置页 ===");
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/设置/.test(e.getAttribute('aria-label')||e.getAttribute('data-ly-tip')||''));b?.click()})()`);
	await frames(40);
	console.log(JSON.stringify(await app.evaluate(SCAN), null, 1));
	await shot("settings");

	console.log("\n产物：", OUT);
}

/**
 * 用真鼠标复核：移上去，看它到底变不变。
 *
 * CSS 检测只认 `:hover` 规则，而这里一半的反馈是 JS 给的——会话行、问题标记的 hover 都是组件自己
 * 的 state 在驱动，样式表里查不到。所以名单只是候选，谁真的没反应要靠移上去看：读一遍背景、前景、
 * 透明度和边框，鼠标压上去再读一遍，两次一样才算真的没有。
 */
async function confirmNoHover(): Promise<string[]> {
	const spots = await app.evaluate<{ index: number; x: number; y: number; label: string }[]>(
		`[...document.querySelectorAll('[data-probe-candidate]')].map(e=>{const r=e.getBoundingClientRect();
			return {index:Number(e.dataset.probeCandidate),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),
			label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,26)}}).filter(s=>s.x>0&&s.y>0)`,
	);
	const read = (index: number) =>
		app.evaluate<string>(`(()=>{const e=document.querySelector('[data-probe-candidate="${index}"]');if(!e)return 'gone';
			const s=getComputedStyle(e);const inner=[...e.querySelectorAll('*')].slice(0,4).map(c=>{const t=getComputedStyle(c);return t.backgroundColor+t.color+t.opacity+t.width}).join('');
			return s.backgroundColor+'|'+s.color+'|'+s.opacity+'|'+s.borderColor+'|'+s.transform+'|'+inner})()`);
	const dead: string[] = [];
	for (const spot of spots) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
		await frames(6);
		const before = await read(spot.index);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: spot.x, y: spot.y });
		await frames(10);
		const after = await read(spot.index);
		if (before === after && after !== "gone") dead.push(`${spot.label} @${spot.x},${spot.y}`);
	}
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
	return dead;
}

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}))}tick()})`);
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
