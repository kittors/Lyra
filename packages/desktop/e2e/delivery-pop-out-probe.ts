/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * The delivery pane, popped out into its own window, shows the change it showed docked.
 *
 * It popped out as 「文件变更」 over an empty state: the window is a second renderer with a fresh
 * `useDeliveryReview`, and the pop-out hands it only the conversation, not the turn or the file.
 * Measured in the panel window itself: the diff sections it paints, what they contain, and the title.
 * Then a second file row is clicked in the main window, and the popped-out pane has to follow it.
 *
 *   node --experimental-strip-types e2e/delivery-pop-out-probe.ts [--before]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { pause } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra弹出文件变更测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const PORT = 9435;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const FILES = ["claude-usage-monitor-prd.md", "notes.md"];
const body = (index: number) => `# Document ${index}\n\nexport const marker${index} = "delivery-${index}";\n`;

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;

async function until(expression: string, ms = 30_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app!.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}

async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	const at = await app!.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app!.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

/** The popped-out delivery window, once its restore button has painted — React is mounted by then. */
async function panelWindow(ms = 15_000): Promise<AppWindow | null> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const hit = (await app!.windows()).find((w) => w.boot.kind === "panel" && w.boot.panelKind === "delivery");
		if (hit && (await hit.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-restore-panel]'))`).catch(() => false))) return hit;
		await pause(300);
	}
	return null;
}

interface Painted {
	title: string;
	diffs: string[];
	text: string;
	empty: boolean;
}

function painted(win: AppWindow): Promise<Painted> {
	return win.evaluate<Painted>(`(() => {
		return {
			title: (document.querySelector('[data-ly-panel-window-title]')?.innerText ?? '').trim(),
			diffs: [...document.querySelectorAll('[data-delivery-diff]')].map((s) => s.getAttribute('data-delivery-diff').split(/[\\\\/]/).pop()),
			text: [...document.querySelectorAll('[data-delivery-diff]')].map((s) => s.innerText).join(' ').slice(0, 400),
			empty: !document.querySelector('[data-delivery-diff]'),
		};
	})()`);
}

async function shoot(win: AppWindow | RunningApp, name: string) {
	await pause(500);
	const { data } = await win.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
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
			const tool = index < FILES.length ? { name: "write", input: { path: FILES[index], content: body(index) } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "文档写好了。" } });
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

	console.log("① 一轮写了两个文件，点第一个文件行，差异开在停靠栏里");
	await click('[data-ly-row="qa-short"] > button');
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'写两份文档'}])`);
	await until(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]').length >= ${FILES.length}`);
	await click(`[data-turn-delivery] [data-delivery-file$="${FILES[0]}"]`);
	await until(`document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff]')`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await shoot(app, "01_停靠栏里的文件变更");

	console.log("② 点「在新窗口中打开」");
	await app.evaluate(`document.querySelector('[data-ly-pop-out="delivery"]').closest('button').click()`);
	const win = await panelWindow();
	check("弹出了一个 delivery 面板窗口", Boolean(win), win ? `boot.panelKind=${win.boot.panelKind}` : "没等到面板窗口");
	if (win) {
		await win.evaluate(`new Promise((resolve)=>{const end=Date.now()+5000;const step=()=>{if(document.querySelector('[data-delivery-diff]')||Date.now()>end)resolve();else requestAnimationFrame(step);};step();})`);
		const first = await painted(win);
		check("弹出的窗口画出了那个文件的差异，不是空状态", !first.empty && first.diffs.length === 1 && first.diffs[0] === FILES[0], `画出的文件：${JSON.stringify(first.diffs)}${first.empty ? "（空状态）" : ""}`);
		check("差异里是这一轮写进去的内容", first.text.includes("marker0"), first.text.slice(0, 120) || "（没有内容）");
		check("窗口标题是文件名，不是「文件变更」", first.title.includes(FILES[0]), `标题：${JSON.stringify(first.title)}`);
		await shoot(win, "02_弹出的窗口");

		console.log("③ 回主窗口点第二个文件，弹出的窗口跟着换");
		await click(`[data-turn-delivery] [data-delivery-file$="${FILES[1]}"]`);
		await win.evaluate(`new Promise((resolve)=>{const end=Date.now()+5000;const step=()=>{const s=document.querySelector('[data-delivery-diff]');if((s&&s.getAttribute('data-delivery-diff').endsWith(${JSON.stringify(FILES[1])}))||Date.now()>end)resolve();else requestAnimationFrame(step);};step();})`);
		const second = await painted(win);
		check("主窗口点了另一个文件，弹出的窗口跟着换过去", second.diffs.length === 1 && second.diffs[0] === FILES[1] && second.text.includes("marker1"), `画出的文件：${JSON.stringify(second.diffs)}；标题：${JSON.stringify(second.title)}`);
		await shoot(win, "03_主窗口换了文件之后");
	}
} catch (error) {
	check("探针跑完", false, String(error));
} finally {
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
	await app?.stop();
	if (server) await closeListeningServer(server);
	if (passed !== results.length) process.exitCode = 1;
}
