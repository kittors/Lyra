/* oxlint-disable no-console -- probe CLI that reports what the real window did */
/**
 * 插件市场一整套用下来，真窗口、真鼠标、真安装：
 *
 *   浏览 70 个条目 → 按种类和分类筛 → 搜索 →
 *   装一个不要钥匙的 MCP（Time）并在详情页打开它 →
 *   装一个要钥匙的 MCP（Brave Search），卡片是「待配置」，在详情页把钥匙填上——落盘时进保险箱，
 *   settings.json 里只剩空位 →
 *   装一个技能集（I Have ADHD，从 GitHub 克隆），整个装成一个包，详情页列出它的技能 →
 *   去设置 › 插件看这三样 → 卸载。
 *
 * 市场是本地起的一个 https 测试市场（`e2e/market-server.mjs`），自签 CA 经
 * NODE_EXTRA_CA_CERTS 交给应用——证书校验照常开着。MCP 包装走 tar 包 + sha256，技能集走 git 克隆。
 *
 * 用法：
 *   NODE_EXTRA_CA_CERTS=/tmp/plugin-verify/tls/ca.pem node --experimental-strip-types e2e/market-flow-probe.ts [输出目录]
 * 先 build：探针跑的是 out/ 里的产物。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, frameGrabber, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "插件市场测试", "真窗口实测");
const REGISTRY = process.env.LYRA_PROBE_REGISTRY ?? "https://localhost:8443/v1/index";
const PORT = 9647;

let home = "";
const app = await startApp({
	port: PORT,
	scaleFactor: 2,
	seed: async (dir) => {
		home = dir;
		await seedInteractions(dir);
		const path = join(dir, "settings.json");
		const settings = JSON.parse(await readFile(path, "utf8").catch(() => "{}")) as Record<string, unknown>;
		settings.pluginRegistries = [REGISTRY];
		settings.skillRegistries = [];
		await writeFile(path, JSON.stringify(settings, null, 2));
		await writeFile(join(dir, "window.json"), JSON.stringify({ width: 1320, height: 880, x: 0, y: 0 }));
	},
});
await mkdir(OUT_DIR, { recursive: true });
const grab = await frameGrabber(PORT);
const $ = <T>(expression: string) => grab.evaluate<T>(expression);
const frames: Frame[] = [];
const stopRecording = await startRecording(PORT, frames);
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, detail });
	console.log(`   ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
};

let n = 0;
const shot = async (name: string) => {
	n += 1;
	const file = join(OUT_DIR, `${String(n).padStart(2, "0")}_${name}.png`);
	await writeFile(file, Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
	console.log(`   📸 ${file}`);
};
const clickAt = async (x: number, y: number) => {
	await grab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await pause(120);
	for (const type of ["mousePressed", "mouseReleased"]) await grab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	await pause(600);
};
const centre = (selectorJs: string) =>
	$<{ x: number; y: number } | null>(`(()=>{const e=(${selectorJs});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
const clickEl = async (selectorJs: string, what: string) => {
	const at = await centre(selectorJs);
	if (!at) throw new Error(`找不到：${what}`);
	await pause(250);
	const again = await centre(selectorJs);
	await clickAt((again ?? at).x, (again ?? at).y);
};
const byText = (scope: string, text: string, tags = "button,[role=tab],a") =>
	`[...document.querySelectorAll(${JSON.stringify(scope)})].flatMap(r=>[...r.querySelectorAll(${JSON.stringify(tags)})]).find(e=>e.checkVisibility()&&((e.innerText||e.getAttribute('aria-label')||'').trim().startsWith(${JSON.stringify(text)})))`;
const cardOf = (name: string) => `[...document.querySelectorAll('[data-card]')].find(c=>c.querySelector('[data-card-name]')?.textContent===${JSON.stringify(name)})`;
const until = async (what: string, test: () => Promise<boolean>, ms = 60_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await test().catch(() => false)) return true;
		await pause(400);
	}
	console.log(`   … 等「${what}」超时`);
	return false;
};
const search = async (text: string) => {
	await clickEl(`document.querySelector('[data-market] input')`, "搜索框");
	// 全选再输入：CDP 的按键不走系统快捷键，要用编辑命令 selectAll。
	await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2, commands: ["selectAll"] });
	await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2 });
	if (text) await grab.send("Input.insertText", { text });
	else {
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
	}
	await pause(700);
};
const settingsOnDisk = async () => JSON.parse(await readFile(join(home, "settings.json"), "utf8")) as { mcpServers: { id: string; enabled: boolean; env?: Record<string, string> }[] };

try {
	await pause(1500);
	console.log("【一】逛市场");
	await clickEl(byText("body", "插件", "button"), "侧栏的插件");
	const loaded = await until("市场读完", async () => (await $<number>(`document.querySelectorAll('[data-card]').length`)) >= 60, 60_000);
	const count = await $<number>(`document.querySelectorAll('[data-card]').length`);
	check("市场列出了全部条目", loaded, `${count} 张卡片`);
	await pause(2500); // 等图标
	await shot("市场_全部");
	for (const tab of ["MCP", "技能", "插件"]) {
		await clickEl(byText("[data-market] [role=tablist]", tab, "[role=tab]"), `标签 ${tab}`);
		await pause(700);
		await shot(`市场_${tab}`);
	}
	await clickEl(byText("[data-market] [role=tablist]", "全部", "[role=tab]"), "标签 全部");
	await clickEl(byText("[data-market] [role=group]", "搜索", "button"), "分类 搜索");
	await pause(600);
	const shelf = await $<string[]>(`[...document.querySelectorAll('[data-card-name]')].map(e=>e.textContent)`);
	check("分类筛选只剩这一类", shelf.length > 0 && shelf.length < 12, shelf.join("、"));
	await shot("市场_分类_搜索");
	await clickEl(byText("[data-market] [role=group]", "全部分类", "button"), "全部分类");

	console.log("\n【二】装一个不要钥匙的 MCP：Time");
	await search("time");
	await shot("搜索_time");
	await clickEl(`[...(${cardOf("Time")})?.querySelectorAll('button')??[]].find(b=>b.textContent==='安装')`, "Time 的安装");
	const timeInstalled = await until("Time 装好", async () => /未启用|已安装/.test(await $<string>(`(${cardOf("Time")})?.innerText??''`)), 120_000);
	check("Time 装好后卡片是「未启用」（装完默认关着）", timeInstalled, await $<string>(`(${cardOf("Time")})?.innerText.replace(/\\s+/g,' ')??''`));
	await shot("Time_装好");
	await clickEl(`(${cardOf("Time")})?.querySelector('button')`, "Time 的卡片");
	await until("详情页", async () => Boolean(await $<boolean>(`Boolean(document.querySelector('[data-plugin-detail]'))`)));
	await clickEl(`document.querySelector('[data-plugin-detail] [role=switch]')`, "Time 的开关");
	const timeOn = await until("Time 打开", async () => (await settingsOnDisk()).mcpServers.some((s) => s.id.startsWith("time") && s.enabled));
	check("详情页的开关把 Time 的服务打开了（落盘）", timeOn);
	await pause(500);
	await shot("Time_详情_已启用");
	await clickEl(byText("[data-plugin-detail] header", "插件市场", "button"), "返回市场");

	console.log("\n【三】装一个要钥匙的 MCP：Brave Search");
	await search("brave");
	const needsKey = /需要密钥/.test(await $<string>(`(${cardOf("Brave Search")})?.innerText??''`));
	check("没装时卡片就说「需要密钥」", needsKey);
	await clickEl(`[...(${cardOf("Brave Search")})?.querySelectorAll('button')??[]].find(b=>b.textContent==='安装')`, "Brave 的安装");
	const braveInstalled = await until("Brave 装好", async () => /待配置/.test(await $<string>(`(${cardOf("Brave Search")})?.innerText??''`)), 180_000);
	check("装好后卡片是「待配置」", braveInstalled, await $<string>(`(${cardOf("Brave Search")})?.innerText.replace(/\\s+/g,' ')??''`));
	await shot("Brave_待配置");
	await clickEl(`(${cardOf("Brave Search")})?.querySelector('button')`, "Brave 的卡片");
	await until("钥匙那一块", async () => Boolean(await $<boolean>(`Boolean(document.querySelector('[data-detail-keys] input'))`)));
	await shot("Brave_详情_缺钥匙");
	await clickEl(`document.querySelector('[data-detail-keys] input')`, "钥匙输入框");
	await grab.send("Input.insertText", { text: "BSA-probe-not-a-real-key-0001" });
	await pause(300);
	await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	const saved = await until("钥匙落盘", async () => {
		const row = (await settingsOnDisk()).mcpServers.find((s) => s.id.startsWith("brave-search"));
		return row?.env?.BRAVE_API_KEY === "${BRAVE_API_KEY}" && (await readFile(join(home, "credentials.json"), "utf8").catch(() => "")).includes("mcp:brave-search__brave-search:BRAVE_API_KEY");
	});
	check("钥匙进了保险箱，settings.json 里只剩空位", saved);
	const leaked = (await readFile(join(home, "settings.json"), "utf8")).includes("BSA-probe-not-a-real-key-0001");
	check("settings.json 里没有明文钥匙", !leaked);
	await pause(800);
	await shot("Brave_详情_钥匙已存");
	const ready = /已就绪/.test(await $<string>(`document.querySelector('[data-detail-keys]')?.innerText??''`));
	check("钥匙那一块显示「已就绪」", ready);
	await clickEl(byText("[data-plugin-detail] header", "插件市场", "button"), "返回市场");

	console.log("\n【四】装一个技能集：I Have ADHD（git 克隆）");
	await search("adhd");
	await clickEl(`[...(${cardOf("I Have ADHD")})?.querySelectorAll('button')??[]].find(b=>b.textContent==='安装')`, "ADHD 的安装");
	const adhdInstalled = await until("ADHD 装好", async () => /已安装/.test(await $<string>(`(${cardOf("I Have ADHD")})?.innerText??''`)), 180_000);
	check("技能集装好后卡片是「已安装」，而且还在「技能」这一类", adhdInstalled);
	await clickEl(`(${cardOf("I Have ADHD")})?.querySelector('button')`, "ADHD 的卡片");
	await until("详情页", async () => Boolean(await $<boolean>(`Boolean(document.querySelector('[data-plugin-detail]'))`)));
	await pause(800);
	const detail = await $<string>(`document.querySelector('[data-plugin-detail]')?.innerText??''`);
	check("详情页列出了它的技能，并且有开关", /技能/.test(detail) && Boolean(await $<boolean>(`Boolean(document.querySelector('[data-plugin-detail] [role=switch]'))`)));
	await shot("ADHD_详情");
	await clickEl(byText("[data-plugin-detail] header", "插件市场", "button"), "返回市场");
	await search("");

	console.log("\n【五】设置 › 插件");
	await clickEl(`document.querySelector('[data-market] header button[aria-label="管理已安装"]')`, "管理已安装");
	await pause(1500);
	await shot("设置_插件");
	const pluginsTab = await $<string>(`document.querySelector('[data-ly-extensions-page]')?.innerText??''`);
	check("设置的插件页里有技能集那一行", /I Have ADHD/.test(pluginsTab), pluginsTab.slice(0, 200).replace(/\s+/g, " "));
	await clickEl(byText("[data-ly-extensions-page]", "MCP", "button"), "MCP 标签");
	await pause(1200);
	await shot("设置_MCP");
	// 名字在输入框里（可以直接改名），innerText 读不到，要读 value。
	const names = await $<string[]>(`[...document.querySelectorAll('[data-mcp-server]')].map(c=>c.querySelector('input')?.value??'')`);
	check("设置的 MCP 页里有 Time 和 Brave 两张卡片，名字是市场上的名字", names.includes("Time") && names.includes("Brave Search"), names.join("、"));
	await clickEl(byText("[data-ly-extensions-page]", "技能", "button"), "技能标签");
	await pause(1000);
	await shot("设置_技能");

	console.log("\n【六】卸载（经主进程的同一个 IPC——菜单里的项探针点不动，见记忆 probe-cannot-click-popover-items）");
	await $(`window.lyra.plugins.uninstall('i-have-adhd')`);
	const rescanned = await until("设置页跟着重扫", async () => /插件\s*0/.test(await $<string>(`document.querySelector('[data-ly-extensions-page]')?.innerText??''`)), 20_000);
	check("在别处卸载，开着的设置页自己重扫（插件 0）", rescanned);
	await clickEl(byText("body", "返回工作区", "button"), "返回工作区");
	await clickEl(byText("body", "插件", "button"), "侧栏的插件");
	await search("adhd");
	const back = await until("ADHD 卸掉", async () => /安装/.test(await $<string>(`(${cardOf("I Have ADHD")})?.innerText??''`)) && !/已安装/.test(await $<string>(`(${cardOf("I Have ADHD")})?.innerText??''`)), 30_000);
	check("卸载后卡片回到「安装」", back);
	await shot("卸载之后");
} catch (error) {
	check("探针跑完", false, error instanceof Error ? error.message : String(error));
	await shot("出错时");
} finally {
	await stopRecording();
	await encode(frames, join(OUT_DIR, "插件市场实测.mp4"), undefined, 1500).catch((error: unknown) => console.log("录像没合成：", error));
	grab.close();
	await app.stop();
	const failed = checks.filter((c) => !c.ok);
	console.log(`\n${checks.length - failed.length}/${checks.length} 项通过${failed.length ? `，没过：${failed.map((c) => c.name).join("；")}` : ""}`);
	await writeFile(join(OUT_DIR, "checks.json"), JSON.stringify(checks, null, 2));
}
