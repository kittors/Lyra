/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 交付卡片点文件进右边这一轮的 diff，点审核进同一块面板里全部文件的 diff。
 * 不是文件预览，也不是 Git。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/delivery-dock-demo.ts`
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra交付卡片停靠测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9781;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

function written(index: number): string {
	return `export const value${index} = ${index};\n`;
}

let app: RunningApp | undefined;
let server: Server | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
let turns = 0;

try {
	server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		req.resume();
		req.on("end", () => {
			const index = turns++;
			const tool = index < 3 ? { name: "write", input: { path: `delivery-${index}.ts`, content: written(index) } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) =>
				res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", {
				message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } },
			});
			emit("content_block_start", {
				index: 0,
				content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" },
			});
			emit("content_block_delta", {
				index: 0,
				delta: tool
					? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) }
					: { type: "text_delta", text: "已完成。" },
			});
			emit("content_block_stop", { index: 0 });
			emit("message_delta", {
				delta: { stop_reason: tool ? "tool_use" : "end_turn" },
				usage: { output_tokens: 20 },
			});
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
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
			await writeFile(
				path,
				JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }),
			);
		},
	});
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", {
				type,
				x: at[0],
				y: at[1],
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	await click('[data-ly-row="qa-short"] > button');
	await app.evaluate(
		`window.lyra.agent.prompt('qa-short',[{type:'text',text:'改三个文件用来验证交付卡片点开停靠栏'}])`,
	);
	try {
		await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 3 个文件')`, 30_000);
	} catch (error) {
		const seen = await app.evaluate<string>(
			`JSON.stringify({card:document.querySelector('[data-turn-delivery]')?.textContent??null,body:document.body.innerText.slice(-800)})`,
		);
		throw new Error(`${String(error)}\n${seen}`, { cause: error });
	}
	await app.evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'center',behavior:'instant'})`);
	await hold(1200);

	const fileName = await app.evaluate<string>(
		`document.querySelector('[data-turn-delivery] [data-delivery-file]')?.getAttribute('data-delivery-file')?.split(/[\\\\/]/).pop() ?? ''`,
	);
	await click('[data-turn-delivery] [data-delivery-file]');
	await until(`document.querySelector('[data-dock-pane="delivery"] .ly-diff-scroll')?.textContent.includes('export const')`);
	// Leave the row so the hover preview does not cover 「审核」 during the hold.
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await until(`!document.querySelector('[aria-label="文件变更预览"]')`);
	const filePane = await app.evaluate<{ modal: boolean; docked: boolean; diffs: number; git: boolean; text: string }>(`(()=>{
		const pane=document.querySelector('[data-dock-pane="delivery"]');
		const conv=document.querySelector('[data-dock-pane="conversation"]');
		const modal=document.querySelector('[data-ly-modal]');
		const p=pane?.getBoundingClientRect(), c=conv?.getBoundingClientRect();
		const docked=Boolean(p&&c&&(p.left>=c.right-12||p.top>=c.bottom-12));
		return {modal:Boolean(modal),docked,diffs:pane?pane.querySelectorAll('[data-delivery-diff]').length:0,git:Boolean(document.querySelector('[data-dock-pane="review"]')),text:(pane?.innerText??'').slice(0,80)};
	})()`);
	check("clicking a file opens this turn's diff, not a file preview or git", !filePane.modal && filePane.docked && filePane.diffs === 1 && !filePane.git && filePane.text.includes(fileName), {
		fileName,
		...filePane,
	});
	await hold(1600);

	await app.evaluate(`document.querySelector('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]').click()`);
	await until(`document.querySelectorAll('[data-dock-pane="delivery"] [data-delivery-diff]').length>=3`);
	const review = await app.evaluate<{ modal: boolean; pane: boolean; docked: boolean; diffs: number; git: boolean }>(`(()=>{
		const pane=document.querySelector('[data-dock-pane="delivery"]');
		const conv=document.querySelector('[data-dock-pane="conversation"]');
		const modal=document.querySelector('[data-ly-modal]');
		const p=pane?.getBoundingClientRect(), c=conv?.getBoundingClientRect();
		const docked=Boolean(p&&c&&(p.left>=c.right-12||p.top>=c.bottom-12));
		return {modal:Boolean(modal),pane:Boolean(pane),docked,diffs:pane?pane.querySelectorAll('[data-delivery-diff]').length:0,git:Boolean(document.querySelector('[data-dock-pane="review"]'))};
	})()`);
	check("review opens every file from this turn, not git", !review.modal && review.pane && review.docked && review.diffs >= 3 && !review.git, review);
	await hold(1600);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	if (server) await closeListeningServer(server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_交付卡片停靠_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
