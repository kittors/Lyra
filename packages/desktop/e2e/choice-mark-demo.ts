/* oxlint-disable no-console -- real-window verification prints measured evidence */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

const out = join(homedir(), "Desktop", "Lyra授权框选项测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
const checks: { name: string; ok: boolean; value: unknown }[] = [];
const check = (name: string, ok: boolean, value: unknown) => {
	checks.push({ name, ok, value });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(value)}`);
};

const model = issueModel();
await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", resolve));
const address = model.server.address();
if (!address || typeof address === "string") throw new Error("No fixture port");
const app = await startApp({ port: 9753, seed: (home) => seedIssues(home, address.port) });
const frames: Frame[] = [];
const stop = await startRecording(9753, frames);
const pause = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression: string) {
	for (let i = 0; i < 150; i++) {
		if (await app.evaluate(expression)) return;
		await pause(100);
	}
	throw new Error(`Missing UI state: ${expression}`);
}
async function click(selector: string) {
	await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.checkVisibility())`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await pause(100);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
}
async function send(text: string) {
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}

try {
	await mkdir(out, { recursive: true });
	await app.evaluate("document.fonts.ready");
	await click('[data-ly-row="issue-demo"] > button');
	await pause();
	model.set("question");
	await send("验证单选授权框的选项标记。");
	await until("Boolean(document.querySelector('[data-ly-choice-kind=radio]'))");
	await pause();
	const single = await app.evaluate<{ kinds: string[]; sizes: number[]; radius: number[]; nativeVisible: boolean }>(`(()=>{
		const marks=[...document.querySelectorAll('[data-ly-choice-kind]')];
		const native=[...document.querySelectorAll('[data-approval-card] input[type=radio], [data-approval-card] input[type=checkbox]')];
		return {
			kinds: marks.map(el=>el.getAttribute('data-ly-choice-kind')??''),
			sizes: marks.map(el=>{const r=el.getBoundingClientRect();return Math.round(r.width*10)/10;}),
			radius: marks.map(el=>parseFloat(getComputedStyle(el).borderRadius)),
			nativeVisible: native.some(el=>getComputedStyle(el).position!=='absolute' && el.getBoundingClientRect().width>8),
		};
	})()`);
	check("single-select paints radio marks", single.kinds.length >= 3 && single.kinds.every((kind) => kind === "radio"), single.kinds);
	check("choice marks stay on the 16px grid", single.sizes.every((size) => Math.abs(size - 16) <= 0.5), single.sizes);
	check("radio marks are circles", single.radius.every((radius) => radius >= 7), single.radius);
	check("native radio is not the visible chrome", single.nativeVisible === false, single.nativeVisible);
	const shot1 = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_single.png`), Buffer.from(shot1.data, "base64"));
	await app.evaluate("[...document.querySelectorAll('[data-approval-card] button')].find(e=>e.textContent.includes('跳过')).click()");
	await until("!document.querySelector('[data-approval-card]')");
	await pause();
	model.set("multi");
	await send("验证多选授权框的选项标记。");
	await until("Boolean(document.querySelector('[data-ly-choice-kind=checkbox]'))");
	await pause();
	await click("[data-approval-card] label:nth-of-type(1)");
	await click("[data-approval-card] label:nth-of-type(2)");
	await pause();
	const multi = await app.evaluate<{ kinds: string[]; on: number; radius: number[]; checked: number }>(`(()=>{
		const marks=[...document.querySelectorAll('[data-ly-choice-kind]')];
		return {
			kinds: marks.map(el=>el.getAttribute('data-ly-choice-kind')??''),
			on: marks.filter(el=>el.getAttribute('data-ly-choice')==='on').length,
			radius: marks.map(el=>parseFloat(getComputedStyle(el).borderRadius)),
			checked: document.querySelectorAll('[data-approval-card] input:checked').length,
		};
	})()`);
	check("multi-select paints checkbox marks", multi.kinds.length >= 3 && multi.kinds.every((kind) => kind === "checkbox"), multi.kinds);
	check("checkbox marks are rounded squares", multi.radius.every((radius) => radius > 3 && radius < 6), multi.radius);
	check("two drawn marks follow two checked inputs", multi.on === 2 && multi.checked === 2, multi);
	const shot2 = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_multi.png`), Buffer.from(shot2.data, "base64"));
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	model.finish();
	await stop();
	await app.stop();
	await closeListeningServer(model.server);
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_授权框选项_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Isolated LYRA_HOME, local SSE model, real Electron window", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
