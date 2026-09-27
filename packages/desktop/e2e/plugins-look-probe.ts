/* oxlint-disable no-console -- probe CLI that prints what the real window shows */
/**
 * 插件那两块地方在真窗口里长什么样：侧栏的「插件市场」，和设置里的「插件」。逐个状态拍下来。
 *
 * 用法：node --experimental-strip-types e2e/plugins-look-probe.ts [输出目录] [前缀]
 * 先 build：探针跑的是 out/ 里的产物。
 *
 * 环境变量：
 *   LYRA_PROBE_REGISTRY  用这个索引地址代替默认的市场（本地 https 服务：自签 CA 用 NODE_EXTRA_CA_CERTS 交给应用，不关证书校验）
 *   LYRA_PROBE_HOME      用一个已经准备好的 profile（装好了东西的），不从空白开始
 */

import { cp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { frameGrabber, pause } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "插件市场测试", "改后");
const PREFIX = process.argv[3] ?? "改后";
const PORT = 9646;
const REGISTRY = process.env.LYRA_PROBE_REGISTRY;
const PREPARED = process.env.LYRA_PROBE_HOME;

const app = await startApp({
	port: PORT,
	scaleFactor: 2,
	seed: async (home) => {
		await seedInteractions(home);
		if (PREPARED) await cp(PREPARED, home, { recursive: true, force: true });
		if (REGISTRY) {
			const { readFile } = await import("node:fs/promises");
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8").catch(() => "{}")) as Record<string, unknown>;
			settings.pluginRegistries = [REGISTRY];
			settings.skillRegistries = [];
			await writeFile(path, JSON.stringify(settings, null, 2));
		}
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 880, x: 0, y: 0 }));
	},
});
await mkdir(OUT_DIR, { recursive: true });
const grab = await frameGrabber(PORT);
const $ = <T>(expression: string) => grab.evaluate<T>(expression);
let n = 0;
const shot = async (name: string) => {
	n += 1;
	const file = join(OUT_DIR, `${PREFIX}_${String(n).padStart(2, "0")}_${name}.png`);
	await writeFile(file, Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
	console.log(`   📸 ${file}`);
};
const clickAt = async (x: number, y: number) => {
	await grab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	for (const type of ["mousePressed", "mouseReleased"]) await grab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	await pause(700);
};
/** 按可见文字（开头匹配）找一个能点的东西，用真鼠标点。 */
const clickText = async (text: string, scope = "body", exact = false) => {
	const at = await $<{ x: number; y: number } | null>(`(()=>{const root=document.querySelector(${JSON.stringify(scope)});if(!root)return null;const els=[...root.querySelectorAll('button,[role=tab],[role=menuitem],a')].filter(e=>{if(!e.checkVisibility())return false;const s=(e.innerText||e.getAttribute('aria-label')||'').trim();return ${exact ? "s===" : "s.startsWith("}${JSON.stringify(text)}${exact ? "" : ")"};});const e=els[0];if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	if (!at) return false;
	await clickAt(at.x, at.y);
	return true;
};
const scrollMain = (dy: number) => $(`(()=>{const s=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+40&&getComputedStyle(e).overflowY!=='visible'&&e.checkVisibility()).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];if(s)s.scrollTop+=${dy};return Boolean(s);})()`);
const typeInto = async (selector: string, text: string) => {
	await $(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.focus();})()`);
	await grab.send("Input.insertText", { text });
	await pause(600);
};

try {
	await pause(1500);
	console.log("【一】插件市场");
	if (!(await clickText("插件", "nav, aside, body"))) throw new Error("侧栏找不到「插件」");
	await pause(2500);
	await shot("市场_全部");
	console.log("   页面文字：", (await $<string>(`(document.querySelector('[data-market]')?.innerText ?? '').slice(0, 900)`)).replace(/\n+/g, " | "));
	await scrollMain(700);
	await pause(500);
	await shot("市场_全部_下半");
	await scrollMain(-9000);
	for (const tab of ["MCP", "技能", "插件"]) {
		if (await clickText(tab, "[data-market] [role=tablist]")) {
			await pause(800);
			await shot(`市场_${tab}`);
		}
	}
	await clickText("全部", "[data-market] [role=tablist]");
	await pause(600);
	// 分类筛选
	const chip = await $<string | null>(`(()=>{const c=[...document.querySelectorAll('[data-market] [role=group] button')].filter(b=>b.checkVisibility())[1];return c?c.innerText.trim():null;})()`);
	if (chip) {
		await clickText(chip.split("\n")[0]!, "[data-market] [role=group]");
		await pause(600);
		await shot(`市场_分类_${chip.split("\n")[0]}`);
		await clickText("全部分类", "[data-market] [role=group]");
	}
	// 搜索
	await typeInto("[data-market] input", "浏览器");
	await shot("市场_搜索");
	await $(`(()=>{const e=document.querySelector('[data-market] input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
	await pause(500);
	// 详情页：第一张 MCP 卡片
	const card = await $<{ x: number; y: number } | null>(`(()=>{const c=[...document.querySelectorAll('[data-card]')].find(e=>e.innerText.includes('MCP'))??document.querySelector('[data-card]');if(!c)return null;c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2};})()`);
	if (card) {
		await clickAt(card.x, card.y);
		await pause(1200);
		await shot("市场_详情");
		await scrollMain(700);
		await pause(400);
		await shot("市场_详情_下半");
		console.log("   详情文字：", (await $<string>(`(document.querySelector('[data-plugin-detail]')?.innerText ?? '').slice(0, 700)`)).replace(/\n+/g, " | "));
		await clickText("插件市场", "[data-plugin-detail] header");
		await pause(800);
	}

	console.log("\n【二】设置里的「插件」");
	await clickText("管理已安装", "[data-market] header");
	await pause(1500);
	await shot("设置_插件");
	for (const tab of ["MCP", "技能", "规则", "扩展"]) {
		if (await clickText(tab, "[data-ly-extensions-page]")) {
			await pause(1000);
			await shot(`设置_${tab}`);
		}
	}
	console.log("   页面文字：", (await $<string>(`(document.querySelector('[data-ly-extensions-page]')?.innerText ?? '').slice(0, 1200)`)).replace(/\n+/g, " | "));
} finally {
	grab.close();
	await app.stop();
}
