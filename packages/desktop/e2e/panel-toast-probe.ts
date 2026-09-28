/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * A toast raised in a popped-out panel window sits in the middle of that window.
 *
 * It sat half a sidebar right of the middle: the toast stack makes room for the sidebar whenever the
 * layout says it is open, and in a panel window — which has no sidebar — the layout still carried
 * the main window's open flag and remembered width. Reproduced the way it was reported: the delivery
 * pane popped out, one file's change undone there, and 「已撤销改动」 measured against the window.
 *
 *   node --experimental-strip-types e2e/panel-toast-probe.ts [--before]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { pause } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra面板窗口提示条测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const PORT = 9438;
const FILES = ["beta-1.md", "beta-2.md"];

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;

async function until(win: { evaluate<T>(expression: string): Promise<T> }, expression: string, ms = 30_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await win.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}

/** A real press in the given window: its own debugger session, its own coordinates. */
async function press(win: AppWindow | RunningApp, selector: string) {
	await until(win, `document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	const at = await win.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	await win.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await win.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await win.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
}

async function panelWindow(ms = 15_000): Promise<AppWindow | null> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const hit = (await app!.windows()).find((w) => w.boot.kind === "panel" && w.boot.panelKind === "delivery");
		if (hit && (await hit.evaluate<boolean>(`Boolean(document.querySelector('[data-delivery-diff]'))`).catch(() => false))) return hit;
		await pause(300);
	}
	return null;
}

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
			const tool = index < FILES.length ? { name: "write", input: { path: FILES[index], content: `# ${FILES[index]}\n\nexport const marker = "beta-${index}";\n` } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "写好了。" } });
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

	await press(app, '[data-ly-row="qa-short"] > button');
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'写两份文档'}])`);
	await until(app, `document.querySelectorAll('[data-turn-delivery] [data-delivery-file]').length >= ${FILES.length}`);
	await press(app, `[data-turn-delivery] [data-delivery-file$="${FILES[0]}"]`);
	await until(app, `document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff]')`);
	await app.evaluate(`document.querySelector('[data-ly-pop-out="delivery"]').closest('button').click()`);
	const win = await panelWindow();
	if (!win) throw new Error("the delivery pane did not pop out");

	console.log("① 在弹出的窗口里撤销这个文件的改动");
	await press(win, '[data-delivery-diff] button[aria-label="撤销此文件的改动"]');
	await until(win, `[...document.querySelectorAll('[data-ly-modal] button')].some((b) => b.innerText.trim() === '撤销改动')`);
	await win.evaluate(`[...document.querySelectorAll('[data-ly-modal] button')].find((b) => b.innerText.trim() === '撤销改动').setAttribute('data-probe-confirm', '')`);
	await press(win, "[data-probe-confirm]");
	await until(win, `[...document.querySelectorAll('[data-ly-toaster] *')].some((e) => e.textContent?.trim() === '已撤销改动')`);
	await pause(600);

	const toast = await win.evaluate<{ window: number; left: number; right: number; stackLeft: string }>(`(() => {
		const stack = document.querySelector('[data-ly-toaster]');
		const card = [...stack.children].find((e) => e.textContent.includes('已撤销改动'));
		const r = card.getBoundingClientRect();
		return { window: window.innerWidth, left: r.left, right: r.right, stackLeft: stack.style.left };
	})()`);
	const offset = Math.round(((toast.left + toast.right) / 2 - toast.window / 2) * 10) / 10;
	check("提示条的中线落在窗口中线上", Math.abs(offset) <= 1, `窗口宽 ${toast.window}px，提示条中线偏 ${offset}px（提示栈左边界 ${toast.stackLeft}）`);
	const { data } = await win.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_面板窗口里的已撤销改动.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
} catch (error) {
	check("探针跑完", false, String(error));
} finally {
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
	await app?.stop();
	if (server) await closeListeningServer(server);
	if (passed !== results.length) process.exitCode = 1;
}
