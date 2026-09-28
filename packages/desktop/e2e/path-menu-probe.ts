/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * Right-clicking a file in a conversation, in the real window, with the real right button.
 *
 * Three surfaces: a row of the 「已编辑 N 个文件」 card, the header of that file's diff in the pane,
 * and a file linked in the reply. Measured: the rows each menu offers, the applications 「打开方式」
 * lists on this machine and whether each carries its own icon, and that resting on another row while
 * the menu is open does not bring a preview up over it.
 *
 * The rows that hand the file to another application (在 Zed 中打开, 在访达中显示) are not pressed:
 * that would put a Finder or Zed window on the screen of whoever is using this machine. What they
 * send is asserted in `test/ui/path-menu.test.ts`, over the same IPC the file tree's menu uses.
 *
 *   node --experimental-strip-types e2e/path-menu-probe.ts [--before]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra文件右键菜单测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const PORT = 9436;
const FILES = ["claude-usage-monitor-prd.md", "notes.md"];

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;
const frames: Frame[] = [];
let stopRecording: (() => Promise<void>) | undefined;

async function until(expression: string, ms = 30_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app!.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}

async function centre(selector: string): Promise<{ x: number; y: number }> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	return app!.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
}

async function press(selector: string, button: "left" | "right") {
	const at = await centre(selector);
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await app!.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button, clickCount: 1 });
	await app!.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button, clickCount: 1 });
}

async function hover(selector: string) {
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await centre(selector)) });
}

async function escape() {
	for (const type of ["keyDown", "keyUp"]) await app!.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
	await pause(400);
}

/** Every open menu's rows, first menu first, with whether each row's icon is an application's own image. */
function menus(): Promise<{ label: string; image: boolean }[][]> {
	return app!.evaluate(`[...document.querySelectorAll('[role="menu"], [aria-label="打开方式"]')].map((menu) =>
		[...menu.querySelectorAll("button")].map((b) => ({ label: b.innerText.trim(), image: Boolean(b.querySelector("img")) })))`);
}

async function shot(name: string) {
	await pause(450);
	const { data } = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

const labels = (menu: { label: string }[] | undefined) => (menu ?? []).map((row) => row.label);

try {
	await mkdir(OUT, { recursive: true });
	server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		req.resume();
		req.on("end", () => {
			const index = turns++;
			const tool = index < FILES.length ? { name: "write", input: { path: FILES[index], content: `# ${FILES[index]}\n\nline ${index}\n` } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", {
				index: 0,
				delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: `需求文档在 [${FILES[0]}](${FILES[0]})，另有一份 [notes.md](notes.md)。` },
			});
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			res.end();
		});
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 880, x: 40, y: 40 }));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off", appearance: { ...settings.appearance, theme: "light", reduceMotion: "on" } }));
		},
	});
	await app.evaluate("document.fonts.ready");
	if (phase === "after") stopRecording = await startRecording(PORT, frames);

	await press('[data-ly-row="qa-short"] > button', "left");
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'写一份需求文档'}])`);
	await until(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]').length >= ${FILES.length}`);
	await until(`document.querySelector('[data-ly-file-link] a')`);
	await pause(800);

	console.log("① 右键卡片上的文件行");
	const row = `[data-turn-delivery] [data-delivery-file$="${FILES[0]}"]`;
	await press(row, "right");
	await pause(500);
	const onRow = await menus();
	const rowLabels = labels(onRow[0]);
	check(
		"卡片文件行右键弹出菜单：打开、在编辑器中打开、打开方式、在访达中显示、复制路径",
		rowLabels[0] === "打开" && /^在 .+ 中打开$/.test(rowLabels[1] ?? "") && rowLabels.includes("打开方式") && rowLabels.includes("在访达中显示") && rowLabels.includes("复制路径"),
		JSON.stringify(rowLabels),
	);
	await shot("01_卡片文件行右键");

	console.log("② 悬停「打开方式」，列出这台机器上装着的应用");
	await hover('[data-ly-open-with] button');
	await pause(700);
	const withSub = await menus();
	const apps = withSub[1] ?? [];
	check(
		"「打开方式」子菜单列出本机应用（带各自图标），最后是用默认应用打开",
		apps.length >= 1 && apps.at(-1)?.label === "用默认应用打开",
		apps.map((one) => `${one.label}${one.image ? "🖼" : ""}`).join("、") || "（子菜单没打开）",
	);
	await shot("02_打开方式子菜单");

	console.log("③ 菜单开着时，指针停到另一行上，预览不会弹出来把菜单挤掉");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await centre(`[data-turn-delivery] [data-delivery-file$="${FILES[1]}"]`)) });
	await pause(1000);
	const covered = await app.evaluate<{ preview: boolean; menu: boolean }>(`({ preview: Boolean(document.querySelector('[aria-label="文件变更预览"]')), menu: Boolean(document.querySelector('[role="menu"]')) })`);
	check("悬停别的行时菜单还在、没有弹出预览", covered.menu && !covered.preview, JSON.stringify(covered));
	await escape();

	console.log("④ 打开差异面板，右键文件标题行");
	await press(row, "left");
	await until(`document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff] .ly-pin > div')`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await pause(600);
	await press('[data-dock-pane="delivery"] [data-delivery-diff] .ly-pin > div', "right");
	await pause(500);
	const onHeader = labels((await menus())[0]);
	check("差异面板的文件标题行右键：同一份菜单，没有「打开」", onHeader.length > 0 && !onHeader.includes("打开") && onHeader.includes("在访达中显示"), JSON.stringify(onHeader));
	await shot("03_差异面板标题行右键");
	await escape();

	console.log("⑤ 右键回复里的文件链接");
	await press("[data-ly-file-link] a", "right");
	await pause(500);
	const onLink = labels((await menus())[0]);
	check("回复里的文件链接右键：打开 + 同一份菜单", onLink[0] === "打开" && onLink.includes("打开方式") && onLink.includes("在访达中显示"), JSON.stringify(onLink));
	await shot("04_回复里的文件链接右键");
	await escape();
	await pause(800);
} catch (error) {
	check("探针跑完", false, String(error));
} finally {
	await stopRecording?.();
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
	await app?.stop();
	if (server) await closeListeningServer(server);
	if (frames.length) {
		const video = join(OUT, `${stamp}_文件右键菜单_${passed}of${results.length}.mp4`);
		await encode(frames, video);
		console.log(`   🎬 ${video}`);
	}
	if (passed !== results.length) process.exitCode = 1;
}
