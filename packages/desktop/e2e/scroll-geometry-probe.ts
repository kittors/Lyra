/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 「滚动条和内容之间到底差几个像素」——四处一起量。
 *
 *   1. 任务面板滚到底，视口里还有没有行（底部那片空白是不是真的空）；
 *   2. 轨迹面板的滚动条压没压住记录；
 *   3. 审核弹窗的滚动条压没压住代码；
 *   4. 智能体编辑页的返回箭头，和标题是不是同一条中线。
 *
 * 只跑不断言：改之前跑一遍当基线，改之后再跑一遍对照。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(process.cwd(), "test-results", "scroll-geometry");
const RUNS = 300;

let app: RunningApp;

async function main() {
	app = await startApp({
		port: 9677,
		seed: async (home) => {
			await seedInteractions(home);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
			// 往 qa-short 里塞够多的工具调用，任务面板才滚得起来。
			const projectId = createHash("sha256").update(join(home, "project")).digest("hex").slice(0, 16);
			const log = join(home, "sessions", projectId, "qa-short.jsonl");
			const lines = (await readFile(log, "utf8")).trim().split("\n");
			const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
			let seq = lines.length;
			const extra: string[] = [];
			for (let i = 0; i < RUNS; i++) {
				const id = `probe-run-${i}`;
				extra.push(JSON.stringify({ type: "message", seq: seq++, ts: 1, message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command: `echo 第 ${i} 条执行记录，命令写长一点好看出右边界` } }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "toolUse", timestamp: 1000 + i * 2 } }));
				extra.push(JSON.stringify({ type: "message", seq: seq++, ts: 1, message: { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text: `第 ${i} 条的输出` }], isError: false, timestamp: 1001 + i * 2 } }));
			}
			await writeFile(log, [...lines, ...extra].join("\n") + "\n");
		},
	});
	await mkdir(OUT, { recursive: true });
	await click('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('.ly-transcript')`);

	console.log("=== 1. 任务面板滚到底 ===");
	await openPane("任务");
	await until(`document.querySelector('[data-task-records]')`);
	await frames(30);
	for (const where of ["顶部", "中间", "底部"]) {
		await app.evaluate(`(()=>{const v=document.querySelector('[data-dock-pane="tasks"] .ly-scroll-view');
			v.scrollTop=${where === "顶部" ? "0" : where === "中间" ? "(v.scrollHeight-v.clientHeight)/2" : "v.scrollHeight"}})()`);
		await frames(30);
		console.log(`${where}：`, JSON.stringify(await taskGeometry()));
	}
	await shot("tasks-bottom");

	console.log("\n=== 2. 轨迹面板的滚动条 ===");
	await openPane("轨迹");
	await frames(40);
	console.log(JSON.stringify(await railGeometry('[data-dock-pane="trajectory"]'), null, 1));
	await shot("trajectory");

	console.log("\n=== 3. 智能体编辑页的返回箭头 ===");
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/设置/.test(e.getAttribute('aria-label')||e.getAttribute('data-ly-tip')||''));b?.click()})()`);
	await frames(40);
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button,[role=menuitem]')].find(e=>(e.textContent||'').trim()==='智能体');b?.click()})()`);
	await frames(40);
	await until(`[...document.querySelectorAll('button')].some(e=>/^编辑 /.test(e.getAttribute('aria-label')||''))`);
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^编辑 /.test(e.getAttribute('aria-label')||''));b.click()})()`);
	await until(`document.querySelector('[data-agent-editor]')`);
	await frames(30);
	console.log(JSON.stringify(await headerAlignment(), null, 1));
	await shot("agent-editor");

	console.log("\n产物：", OUT);
}

/** 视口里到底有没有行，以及容器高度和真实内容差多少。 */
async function taskGeometry() {
	return app.evaluate(
		`(()=>{const v=document.querySelector('[data-dock-pane="tasks"] .ly-scroll-view'),host=document.querySelector('[data-task-records]');
		if(!v||!host)return '（没有任务面板）';const box=v.getBoundingClientRect();
		const rows=[...host.querySelectorAll('[data-task-record]')].map(e=>e.getBoundingClientRect());
		const inView=rows.filter(r=>r.bottom>box.top+1&&r.top<box.bottom-1);
		const lowest=rows.length?Math.max(...rows.map(r=>r.bottom)):box.top;
		const tops=[...host.querySelectorAll('[data-task-record]')].map(e=>Math.round(parseFloat(getComputedStyle(e).top)||0));
		return {记录数:${RUNS},撑出的高:Math.round(host.getBoundingClientRect().height),渲染了:rows.length,视口内:inView.length,
		 渲染的行top:tops.length?tops[0]+'..'+tops[tops.length-1]:null,列表offsetTop:host.offsetTop,offsetParent:host.offsetParent?.className?.slice(0,30),
		 视口下沿到最后一行:Math.round(box.bottom-lowest),滚动位置:Math.round(v.scrollTop)+'/'+Math.round(v.scrollHeight-v.clientHeight)}})()`,
	);
}

/** 滚动条和它要滚的正文之间差几个像素。 */
async function railGeometry(pane: string) {
	return app.evaluate(
		`(()=>{const root=document.querySelector(${JSON.stringify(pane)});if(!root)return '（没有这个面板）';
		const thumb=root.querySelector('.ly-thumb'),view=root.querySelector('.ly-scroll-view');
		if(!thumb||!view)return {有滚动条:Boolean(thumb)};
		const t=thumb.getBoundingClientRect(),v=view.getBoundingClientRect();
		const texts=[...view.querySelectorAll('*')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0&&r.right<=v.right+1);
		const rightmost=texts.length?Math.max(...texts.map(r=>r.right)):v.left;
		return {视口右缘:Math.round(v.right),滚动条:Math.round(t.left)+'..'+Math.round(t.right),
		 内容最右:Math.round(rightmost),内容到滚动条:Math.round(t.left-rightmost),
		 结论:t.left-rightmost>=2?'没压住':'压住了 '+Math.round(rightmost-t.left)+'px'}})()`,
	);
}

/** 返回箭头和标题是不是同一条中线。 */
async function headerAlignment() {
	return app.evaluate(
		`(()=>{const form=document.querySelector('[data-agent-editor]');if(!form)return '（没进编辑页）';
		const back=form.querySelector('button[aria-label^="返回"]'),title=form.querySelector('h1');
		if(!back||!title)return '（没有返回按钮或标题）';
		const b=back.getBoundingClientRect(),t=title.getBoundingClientRect();
		const icon=back.querySelector('svg')?.getBoundingClientRect();
		return {按钮:Math.round(b.top)+'..'+Math.round(b.bottom)+' 中线 '+Math.round(b.top+b.height/2),
		 图标:icon?Math.round(icon.top)+'..'+Math.round(icon.bottom)+' 中线 '+Math.round(icon.top+icon.height/2):null,
		 标题:Math.round(t.top)+'..'+Math.round(t.bottom)+' 中线 '+Math.round(t.top+t.height/2),
		 图标与标题中线差:icon?Math.round((icon.top+icon.height/2)-(t.top+t.height/2)):null}})()`,
	);
}

async function openPane(label: string) {
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`);
	await frames(20);
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
