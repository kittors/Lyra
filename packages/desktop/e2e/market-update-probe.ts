/* oxlint-disable no-console -- probe CLI that reports what the real window did */
/**
 * 市场上出了新版，装过的东西怎么跟上：真窗口、真下载、真替换。
 *
 *   一、自动更新关着：装好 Time（打开）和 Brave Search（填好钥匙）→ 市场换成新版本 → 点刷新 →
 *       卡片变「更新」、横幅「2 个有新版本」、侧栏挂着 2 → 点「全部更新」→ 换成新版，
 *       Time 还开着、Brave 的钥匙还在保险箱里；
 *   二、自动更新开着：市场再出一版 → 点刷新 → 不用点任何东西，几秒后就换好了。
 *
 * 测试市场是探针自己起的（`e2e/market-server.mjs`，端口 8444），每一版换一份配置重启；
 * 自签 CA 经 NODE_EXTRA_CA_CERTS 交给应用。
 *
 * 用法：NODE_EXTRA_CA_CERTS=/tmp/plugin-verify/tls/ca.pem node --experimental-strip-types e2e/market-update-probe.ts [输出目录]
 */

import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { frameGrabber, pause } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "插件市场测试", "更新实测");
const PORT = 9648;
const MARKET_PORT = 8444;
const REGISTRY = `https://localhost:${MARKET_PORT}/v1/index`;
const SOURCE = "/tmp/lyra-plugins/repo";
const WORK = "/tmp/plugin-verify/update-probe";

/** 一版市场：全部条目，另把这几个包的版本改成给定的号（包里的 manifest 跟着改，包的哈希就变了）。 */
async function marketVersion(tag: string, bumps: Record<string, string>): Promise<string> {
	const root = join(WORK, tag);
	await rm(root, { recursive: true, force: true });
	await cp(join(SOURCE, "plugins"), join(root, "plugins"), { recursive: true });
	for (const [id, version] of Object.entries(bumps)) {
		const manifest = join(root, "plugins", id, ".lyra-plugin", "plugin.json");
		const parsed = JSON.parse(await readFile(manifest, "utf8")) as { version?: string };
		parsed.version = version;
		await writeFile(manifest, JSON.stringify(parsed, null, 2));
	}
	const registry = JSON.parse(await readFile(join(SOURCE, "registry.json"), "utf8")) as { plugins: { id: string; version?: string }[] };
	const entries = registry.plugins.map((entry) => (bumps[entry.id] ? { ...entry, version: bumps[entry.id] } : entry));
	const config = join(WORK, `${tag}.json`);
	await writeFile(config, JSON.stringify({ wrappers: root, entries }));
	return config;
}

let server: ChildProcess | null = null;
async function serve(config: string): Promise<void> {
	if (server) {
		server.kill();
		await pause(600);
	}
	server = spawn("node", [new URL("./market-server.mjs", import.meta.url).pathname, config], { env: { ...process.env, PORT: String(MARKET_PORT) }, stdio: ["ignore", "pipe", "inherit"] });
	await new Promise<void>((done) => server!.stdout!.once("data", () => done()));
}

await mkdir(WORK, { recursive: true });
await serve(await marketVersion("v1", {}));

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
		// 第一段要的是「提示、等人点」，先关着。
		settings.autoUpdatePlugins = false;
		await writeFile(path, JSON.stringify(settings, null, 2));
		await writeFile(join(dir, "window.json"), JSON.stringify({ width: 1320, height: 880, x: 0, y: 0 }));
	},
});
await mkdir(OUT_DIR, { recursive: true });
const grab = await frameGrabber(PORT);
const $ = <T>(expression: string) => grab.evaluate<T>(expression);
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, detail });
	console.log(`   ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
};
let n = 0;
const shot = async (name: string) => {
	n += 1;
	await writeFile(join(OUT_DIR, `${String(n).padStart(2, "0")}_${name}.png`), Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
};
const clickAt = async (x: number, y: number) => {
	await grab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await pause(120);
	for (const type of ["mousePressed", "mouseReleased"]) await grab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	await pause(600);
};
const clickEl = async (selectorJs: string, what: string) => {
	const at = await $<{ x: number; y: number } | null>(`(()=>{const e=(${selectorJs});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	if (!at) throw new Error(`找不到：${what}`);
	await pause(200);
	await clickAt(at.x, at.y);
};
const byText = (scope: string, text: string, tags = "button,[role=tab],a") =>
	`[...document.querySelectorAll(${JSON.stringify(scope)})].flatMap(r=>[...r.querySelectorAll(${JSON.stringify(tags)})]).find(e=>e.checkVisibility()&&((e.innerText||e.getAttribute('aria-label')||'').trim().startsWith(${JSON.stringify(text)})))`;
const cardOf = (name: string) => `[...document.querySelectorAll('[data-card]')].find(c=>c.querySelector('[data-card-name]')?.textContent===${JSON.stringify(name)})`;
const cardText = (name: string) => $<string>(`(${cardOf(name)})?.innerText.replace(/\\s+/g,' ')??''`);
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
	await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2, commands: ["selectAll"] });
	await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2 });
	if (text) await grab.send("Input.insertText", { text });
	else {
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
	}
	await pause(700);
};
const ledger = async () => JSON.parse(await readFile(join(home, "installs.json"), "utf8").catch(() => "{}")) as Record<string, { version?: string; sha256?: string }>;
const settingsOnDisk = async () => JSON.parse(await readFile(join(home, "settings.json"), "utf8")) as { mcpServers: { id: string; enabled: boolean; env?: Record<string, string> }[] };
const refresh = () => clickEl(`document.querySelector('[data-market] header button[aria-label="重新读取"]')`, "刷新");

try {
	await pause(1500);
	await clickEl(byText("body", "插件", "button"), "侧栏的插件");
	await until("市场读完", async () => (await $<number>(`document.querySelectorAll('[data-card]').length`)) >= 60);

	console.log("【准备】装 Time 并打开，装 Brave 并填钥匙");
	await search("time");
	await clickEl(`[...(${cardOf("Time")})?.querySelectorAll('button')??[]].find(b=>b.textContent==='安装')`, "Time 的安装");
	await until("Time 装好", async () => /未启用/.test(await cardText("Time")), 120_000);
	await clickEl(`(${cardOf("Time")})?.querySelector('button')`, "Time 的卡片");
	await until("详情", async () => Boolean(await $<boolean>(`Boolean(document.querySelector('[data-plugin-detail] [role=switch]'))`)));
	await clickEl(`document.querySelector('[data-plugin-detail] [role=switch]')`, "Time 的开关");
	await until("Time 打开", async () => (await settingsOnDisk()).mcpServers.some((s) => s.id.startsWith("time") && s.enabled));
	await clickEl(byText("[data-plugin-detail] header", "插件市场", "button"), "返回");
	await search("brave");
	await clickEl(`[...(${cardOf("Brave Search")})?.querySelectorAll('button')??[]].find(b=>b.textContent==='安装')`, "Brave 的安装");
	await until("Brave 装好", async () => /待配置/.test(await cardText("Brave Search")), 180_000);
	await clickEl(`(${cardOf("Brave Search")})?.querySelector('button')`, "Brave 的卡片");
	await until("钥匙输入框", async () => Boolean(await $<boolean>(`Boolean(document.querySelector('[data-detail-keys] input'))`)));
	await clickEl(`document.querySelector('[data-detail-keys] input')`, "钥匙输入框");
	await grab.send("Input.insertText", { text: "BSA-update-probe-key" });
	await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await until("钥匙落盘", async () => (await readFile(join(home, "credentials.json"), "utf8").catch(() => "")).includes("mcp:brave-search__brave-search:BRAVE_API_KEY"));
	await clickEl(byText("[data-plugin-detail] header", "插件市场", "button"), "返回");
	await search("");
	const before = await ledger();
	console.log(`   装下的版本：Time ${before.time?.version}，Brave ${before["brave-search"]?.version}`);

	console.log("\n【一】自动更新关着：市场出了新版，点刷新");
	await serve(await marketVersion("v2", { time: "9999.1.0", "brave-search": "9999.2.0" }));
	await refresh();
	const flagged = await until("卡片变「更新」", async () => /更新/.test(await cardText("Time")) && /更新/.test(await cardText("Brave Search")), 30_000);
	check("两张卡片都变成「更新」", flagged, `${await cardText("Time")} | ${await cardText("Brave Search")}`);
	const banner = await $<string>(`document.querySelector('[data-market-updates]')?.innerText??''`);
	check("横幅说有 2 个新版本", /2 个有新版本/.test(banner), banner.replace(/\s+/g, " "));
	const badge = await until("侧栏挂数", async () => (await $<string>(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('插件'))?.innerText??''`)).includes("2"), 20_000);
	check("自动更新关着时侧栏挂着待更新数", badge);
	await shot("有新版本");
	await clickEl(byText("[data-market-updates]", "全部更新", "button"), "全部更新");
	const updated = await until("换成新版", async () => {
		const now = await ledger();
		return now.time?.version === "9999.1.0" && now["brave-search"]?.version === "9999.2.0";
	}, 180_000);
	check("点「全部更新」后两个都换成了新版（账本）", updated, JSON.stringify(Object.fromEntries(Object.entries(await ledger()).map(([id, r]) => [id, r.version]))));
	await until("卡片恢复", async () => !/更新/.test(await cardText("Time")), 20_000);
	const disk = await settingsOnDisk();
	check("Time 更新后还开着", disk.mcpServers.some((s) => s.id.startsWith("time") && s.enabled));
	const brave = disk.mcpServers.find((s) => s.id.startsWith("brave-search"));
	check(
		"Brave 更新后钥匙还在（文件里是空位、保险箱里有）",
		brave?.env?.BRAVE_API_KEY === "${BRAVE_API_KEY}" && (await readFile(join(home, "credentials.json"), "utf8")).includes("mcp:brave-search__brave-search:BRAVE_API_KEY"),
	);
	check("Brave 的卡片仍是就绪状态，不是「待配置」", !/待配置/.test(await cardText("Brave Search")), await cardText("Brave Search"));
	await shot("手动全部更新之后");

	console.log("\n【二】自动更新开着：再出一版，点刷新，不再点别的");
	await $(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,autoUpdatePlugins:true});})()`);
	await pause(800);
	await serve(await marketVersion("v3", { time: "9999.1.1", "brave-search": "9999.2.1" }));
	await refresh();
	const auto = await until("自动换好", async () => {
		const now = await ledger();
		return now.time?.version === "9999.1.1" && now["brave-search"]?.version === "9999.2.1";
	}, 180_000);
	check("自动更新开着时，刷新之后自己换成了新版", auto, JSON.stringify(Object.fromEntries(Object.entries(await ledger()).map(([id, r]) => [id, r.version]))));
	await until("卡片恢复", async () => !/更新/.test(await cardText("Time")), 20_000);
	check("卡片没有停在「更新」上", !/更新/.test(await cardText("Time")) && !/更新/.test(await cardText("Brave Search")));
	await shot("自动更新之后");
} catch (error) {
	check("探针跑完", false, error instanceof Error ? error.message : String(error));
	await shot("出错时").catch(() => undefined);
} finally {
	grab.close();
	await app.stop();
	(server as ChildProcess | null)?.kill();
	const failed = checks.filter((c) => !c.ok);
	console.log(`\n${checks.length - failed.length}/${checks.length} 项通过${failed.length ? `，没过：${failed.map((c) => c.name).join("；")}` : ""}`);
	await writeFile(join(OUT_DIR, "checks.json"), JSON.stringify(checks, null, 2));
}
