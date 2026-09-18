/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 用户消息上的撤回：截断这一轮，把原文接回输入框，不立刻再问模型。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/message-undo-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra用户消息撤回测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9785;
const SESSION = "undo-demo";
const FIRST = "先看一下 README 里怎么写启动步骤。";
const SECOND = "漏了一张截图，刚才那句不算。";
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
			await mkdir(cwd, { recursive: true });
			await writeFile(join(cwd, "README.md"), "# undo demo\n");
			const usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			const user = (text: string, ts: number) => ({
				role: "user",
				content: [{ type: "text", text }],
				timestamp: ts,
			});
			const assistant = (text: string, ts: number) => ({
				role: "assistant",
				content: [{ type: "text", text }],
				api: "anthropic-messages",
				provider: "qa",
				model: "qa",
				usage,
				stopReason: "stop",
				timestamp: ts,
			});
			const messages = [
				user(FIRST, 10),
				assistant("启动步骤在 README 第二节。", 11),
				user(SECOND, 20),
				assistant("好，那一句我先放下。", 21),
			];
			const meta = {
				id: SESSION,
				title: "撤回演示",
				projectId,
				projectName: "撤回演示",
				cwd,
				createdAt: 1,
				updatedAt: 2,
				modelId: "qa/model",
				messageCount: messages.length,
				usage,
				seq: messages.length + 1,
			};
			await mkdir(join(home, "sessions", projectId), { recursive: true });
			await writeFile(
				join(home, "sessions", projectId, `${SESSION}.jsonl`),
				[
					JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
					...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
					JSON.stringify({ type: "meta", meta, seq: meta.seq, ts: 2 }),
				].join("\n") + "\n",
			);
			await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
			await writeFile(
				join(home, "settings.json"),
				JSON.stringify({
					providers: [],
					defaultModelId: "qa/model",
					permissionMode: "full",
					projectMemory: false,
					thinking: "off",
					sync: { enabled: false },
					projects: [{ id: projectId, path: cwd, name: "撤回演示", pinned: true, lastOpenedAt: 1 }],
				}),
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
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
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

	await until(`Boolean(document.querySelector('[data-ly-row="${SESSION}"]'))`);
	await click(`[data-ly-row="${SESSION}"] > button`);
	await until(`document.body.innerText.includes(${JSON.stringify(SECOND)})`);
	await hold(1200);

	const first = await app.evaluate<[number, number]>(
		`(()=>{const r=document.querySelector('[data-question-index="0"]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: first[0], y: first[1] });
	await hold(700);
	await click('[data-question-index="0"] [data-message-undo]');
	await until(`document.querySelector('[role="dialog"]')?.innerText.includes('撤销这轮对话')`);
	const dialog = await app.evaluate<string>(`document.querySelector('[role="dialog"]')?.innerText??''`);
	check("older messages ask before cutting the tail", dialog.includes("之后的所有回复"), { dialog: dialog.slice(0, 80) });
	await hold(1100);
	await app.evaluate(`(document.querySelector('[role="dialog"] button[aria-label="取消"]') ?? document.querySelector('[role="dialog"] button'))?.click()`);
	await until(`!document.querySelector('[role="dialog"]')`);
	check("cancel leaves both turns in place", await app.evaluate(`document.body.innerText.includes(${JSON.stringify(SECOND)})`), {});

	const last = await app.evaluate<[number, number]>(
		`(()=>{const r=document.querySelector('[data-question-index="2"]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: last[0], y: last[1] });
	await hold(700);
	await click('[data-question-index="2"] [data-message-undo]');
	await until(`document.querySelector('main textarea')?.value.includes(${JSON.stringify(SECOND)})`);
	const after = await app.evaluate<{ text: string; second: boolean; dialog: boolean; catch: boolean }>(`(()=>{
		const text=document.querySelector('main textarea')?.value??'';
		return {
			text,
			second:document.body.innerText.includes(${JSON.stringify(SECOND)}) && text.includes(${JSON.stringify(SECOND)}),
			dialog:Boolean(document.querySelector('[role="dialog"]')),
			catch:Boolean(document.querySelector('.ly-composer-catch')),
		};
	})()`);
	check("last user message undoes without a dialog and returns to the composer", !after.dialog && after.text.includes(SECOND) && !(await app.evaluate(`Boolean(document.querySelector('[data-question-index="2"]'))`)), after);
	await hold(1600);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_用户消息撤回_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
