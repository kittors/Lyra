/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 点交付卡片上的文件行，悬停预览不能闪一下。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/delivery-hover-click-demo.ts`
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra交付点击悬停闪烁测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9783;
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
		`window.lyra.agent.prompt('qa-short',[{type:'text',text:'改三个文件用来验证点文件不闪悬停预览'}])`,
	);
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 3 个文件')`, 30_000);
	await app.evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'center',behavior:'instant'})`);
	await hold(1200);

	const rows = await app.evaluate<string[]>(
		`[...document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)')].map((e,i)=>{e.setAttribute('data-hover-click',String(i));return e.getAttribute('data-delivery-file')?.split(/[\\\\/]/).pop()??''})`,
	);
	check("delivery card lists the three written files", rows.length === 3, { rows });

	const flashes: boolean[] = [];
	for (let i = 0; i < rows.length; i++) {
		await app.evaluate(`(()=>{window.__deliveryPreviewFlashed=false;window.__deliveryPreviewWatch?.disconnect();const watch=new MutationObserver(()=>{if(document.querySelector('[aria-label="文件变更预览"]'))window.__deliveryPreviewFlashed=true});watch.observe(document.body,{childList:true,subtree:true});window.__deliveryPreviewWatch=watch})()`);
		await click(`[data-hover-click="${i}"]`);
		const flashed = await app.evaluate<boolean>(
			`(()=>{window.__deliveryPreviewWatch.disconnect();return window.__deliveryPreviewFlashed})()`,
		);
		flashes.push(flashed);
		await until(`document.querySelector('[data-dock-pane="delivery"]')?.innerText.includes(${JSON.stringify(rows[i])})`);
		await hold(900);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
		await hold(400);
	}
	check("clicking each file row never paints the hover preview", flashes.every((item) => item === false), { flashes });

	const hoverAt = await app.evaluate<[number, number]>(
		`(()=>{const r=document.querySelector('[data-hover-click="0"]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverAt[0], y: hoverAt[1] });
	const started = Date.now();
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`);
	const waited = Date.now() - started;
	check("resting on a row still opens the hover preview", waited >= 500, { waited });
	await hold(1400);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await until(`!document.querySelector('[aria-label="文件变更预览"]')`);
	await hold(800);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	if (server) await closeListeningServer(server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_点文件不闪悬停预览_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
