/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 提问卡：等待行、选中底、推荐居中、收起动画、键盘、其他输入、底栏不挡、多选项滚动虚化。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/ask-user-card-demo.ts`
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra提问卡测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9793;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const FEW = [
	{ label: "React + TypeScript + Tailwind CSS", description: "生态最广、成熟度最高，专为组件设计，首选推荐。", recommended: true },
	{ label: "Vue 3 + TypeScript + UnoCSS", description: "写法更现代，SFC 体验较好，国内产业受众广。" },
	{ label: "React + Vanilla Extract" },
];
const FEW_LABELS = FEW.map((option) => option.label);
const MANY = Array.from({ length: 16 }, (_, index) => `方案 ${index + 1}：${"补充说明让这一行足够长，好看出等宽和换行。".repeat(2)}`);
const LONG_QUESTION = "完整问题起点\n" + "请检查所有环境、原始路径与中文输入法行为。 VeryLongPathSegment_without_breaks_".repeat(12) + "\n完整问题终点";
const LONG_OPTIONS = Array.from({ length: 8 }, (_, index) => `继续检查 ${index + 1}：${"保留必要的原始上下文以及验证记录。".repeat(4)}`);

function cardModel() {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", () => {
			const body: unknown = JSON.parse(raw);
			assert.ok(body && typeof body === "object" && "messages" in body && Array.isArray(body.messages));
			const content = JSON.stringify(body.messages.slice(-3));
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (content.includes('"tool_result"')) reply(res, "已收到回答。");
			else if (content.includes("ASK_MANY")) reply(res, "", { id: "q-many", question: "选项很多的时候，列表自己滚，底栏的发送取消跳过都还在。", options: MANY, allowSkip: true });
			else if (content.includes("ASK_LONG")) reply(res, "", { id: "q-long", question: LONG_QUESTION, options: LONG_OPTIONS, allowSkip: true });
			else if (content.includes("ASK_MULTI")) reply(res, "", { id: "q-multi", question: "可以多选。", options: ["A 项", "B 项", "C 项"], selectionMode: "multi", allowSkip: true });
			else if (content.includes("ASK_FEW")) reply(res, "", { id: "q-few", question: "搭一套自己的前端样式组件库，开始动手前你选哪条技术栈？", options: FEW, allowSkip: true });
			else reply(res, "先说一句。");
		});
	});
	return server;
}

function reply(res: ServerResponse, text: string, question?: { id: string; question: string; options: Array<string | { label: string; description?: string; recommended?: boolean }>; allowSkip?: boolean; selectionMode?: "single" | "multi" }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "ask-card", role: "assistant", content: [], usage: { input_tokens: 80, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: question ? { type: "tool_use", id: question.id, name: "ask_user", input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: question ? { type: "input_json_delta", partial_json: JSON.stringify({ question: question.question, options: question.options, allowCustomInput: true, allowSkip: question.allowSkip !== false, selectionMode: question.selectionMode ?? "single" }) } : { type: "text_delta", text } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: question ? "tool_use" : "end_turn" }, usage: { output_tokens: 16 } });
	emit("message_stop", {});
	res.end();
}

async function seed(home: string, modelPort: number): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# ask card\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = {
		id: "ask-card",
		title: "提问卡",
		cwd,
		projectId,
		projectName: "提问卡",
		createdAt: 1,
		updatedAt: 2,
		modelId: "qa/model",
		messageCount: 2,
		usage,
		seq: 3,
	};
	await writeFile(join(home, "sessions", projectId, "ask-card.jsonl"), [
		JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
		JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "你好，我想做个前端样式库。" }], timestamp: 1 }, seq: 1, ts: 1 }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "可以。先选定技术栈。" }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: 2 }, seq: 2, ts: 2 }),
		JSON.stringify({ type: "meta", meta, seq: 3, ts: 3 }),
	].join("\n") + "\n");
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		providers: [{ id: "qa", name: "隔离测试模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${modelPort}`, apiKey: "test", enabled: true,
			models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }] }],
		defaultModelId: "qa/model",
		mcpServers: [],
		hooks: [],
		permissionMode: "full",
		thinking: "off",
		projectMemory: false,
		appearance: { theme: "light", reduceMotion: "off" },
		projects: [{ id: projectId, path: cwd, name: "提问卡", pinned: true, lastOpenedAt: 1 }],
		sync: { enabled: false },
	}));
}

const server = cardModel();
let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	app = await startApp({ port: PORT, seed: (home) => seed(home, address.port) });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 25_000) {
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
	async function point(selector: string) {
		return app!.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	}
	async function click(selector: string) {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
		await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await point(selector);
		await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
		for (const type of ["mousePressed", "mouseReleased"]) await app!.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	async function key(name: string, code: number, text?: string) {
		await app!.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
		await app!.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
	}
	async function ask(prompt: string) {
		await click("main textarea");
		await app!.evaluate(`(()=>{const field=document.querySelector("main textarea");const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;setter.call(field,${JSON.stringify(prompt)});field.dispatchEvent(new Event("input",{bubbles:true}));})()`);
		await key("Enter", 13, "\r");
		await until("document.querySelector('[data-approval-card]')");
		await hold(900);
	}
	async function idle() {
		await until("!document.querySelector('[data-approval-card]') && !document.querySelector('button[aria-label=\"停止\"]')");
		await hold(700);
	}
	async function measure() {
		return app!.evaluate<{
			waiting: { mood: string | null; text: string; dash: boolean };
			indexes: string[];
			marks: number;
			labels: string[];
			widths: number[];
			recommended: { mid: number; stackMid: number } | null;
			other: boolean;
			footer: { skip: boolean; cancel: boolean; send: boolean; top: number; covered: boolean; rule: string };
			row: { border: string; fill: string; bubble: string };
			card: { top: number; bottom: number; height: number };
			fade: { top: number; bottom: number; scrollTop: number; max: number };
			viewport: number;
		}>(`(()=>{
			const line=document.querySelector('[data-ly-running]');
			const card=document.querySelector('[data-approval-card]');
			const cr=card.getBoundingClientRect();
			const options=[...document.querySelectorAll('[data-ly-question-option]')];
			const submit=card.querySelector('button[type=submit]');
			const sr=document.querySelector('.ly-approval-scroll');
			const view=sr?.querySelector('.ly-scroll-view');
			const style=view?getComputedStyle(view):null;
			const footerTop=submit.getBoundingClientRect().top;
			const scrollBottom=sr.getBoundingClientRect().bottom;
			const rec=document.querySelector('[data-ly-question-recommended]');
			const stack=rec?.previousElementSibling;
			const rr=rec?.getBoundingClientRect();
			const srStack=stack?.getBoundingClientRect();
			return {
				waiting:{mood:line?.getAttribute('data-ly-mood')??null,text:line?.textContent??'',dash:Boolean(line?.querySelector('.ly-dash'))},
				indexes:[...document.querySelectorAll('[data-ly-question-option] [data-ly-question-index]')].map(e=>e.textContent||''),
				marks:document.querySelectorAll('[data-ly-choice-kind]').length,
				labels:[...document.querySelectorAll('[data-ly-question-label]')].map(e=>e.textContent||''),
				widths:options.map(e=>Math.round(e.getBoundingClientRect().width)),
				recommended:rr&&srStack?{mid:Math.round((rr.top+rr.bottom)/2),stackMid:Math.round((srStack.top+srStack.bottom)/2)}:null,
				other:Boolean(document.querySelector('[data-ly-question-other] input[aria-label="自定义回答"]')),
				footer:{
					skip:[...card.querySelectorAll('button')].some(b=>/跳过/.test(b.textContent||'')),
					cancel:[...card.querySelectorAll('button')].some(b=>/取消/.test(b.textContent||'')),
					send:Boolean(submit),
					top:Math.round(footerTop),
					covered:footerTop+1<scrollBottom,
					rule:getComputedStyle(card.querySelector('[data-ly-question-footer]')).borderTopWidth,
				},
				row:{
					border:getComputedStyle(options[0]??card).borderTopWidth,
					fill:getComputedStyle(options[0]??card).backgroundColor,
					bubble:getComputedStyle(document.querySelector('.ly-user-bubble')??card).backgroundColor,
				},
				card:{top:Math.round(cr.top),bottom:Math.round(cr.bottom),height:Math.round(cr.height)},
				fade:{
					top:style?parseFloat(style.getPropertyValue('--ly-fade-top')):0,
					bottom:style?parseFloat(style.getPropertyValue('--ly-fade-bottom')):0,
					scrollTop:view?.scrollTop??0,
					max:view?view.scrollHeight-view.clientHeight:0,
				},
				viewport:innerHeight,
			};
		})()`);
	}

	await click('[data-ly-row="ask-card"] > button');
	await hold(600);

	await ask("ASK_FEW");
	const few = await measure();
	check("waiting line is dashed, not Wrestling", few.waiting.mood === "waiting" && few.waiting.dash && /等待你的回答/.test(few.waiting.text) && !/Wrestling/.test(few.waiting.text), few.waiting);
	check("rows have no index and no drawn mark", few.indexes.length === 0 && few.marks === 0 && few.labels.join("|") === FEW_LABELS.join("|"), { indexes: few.indexes, marks: few.marks, labels: few.labels });
	check("recommended chip is vertically centered on its copy", few.recommended !== null && Math.abs(few.recommended.mid - few.recommended.stackMid) <= 2, few.recommended);
	check("option rows share one width", few.widths.length === 3 && few.widths.every((width) => Math.abs(width - (few.widths[0] ?? 0)) <= 1), few.widths);
	check("other row and footer stay on the card", few.other && few.footer.skip && few.footer.cancel && few.footer.send && !few.footer.covered && few.card.bottom <= few.viewport, few.footer);
	check("rows are a wash without a hairline", few.footer.rule === "0px" && few.row.border === "0px" && few.row.fill !== "rgba(0, 0, 0, 0)", { footer: few.footer.rule, row: few.row });
	check("option wash matches the user bubble", few.row.fill === few.row.bubble, few.row);
	const fold = await app.evaluate<{ start: number; end: number; mid: number; open: string | null }>(`new Promise(resolve=>{
		const reveal=document.querySelector('[data-approval-card] .ly-reveal');
		const start=reveal.getBoundingClientRect().height;
		document.querySelector('[data-approval-card] button[aria-expanded="true"]')?.click();
		const heights=[];
		const begun=performance.now();
		function sample(){
			heights.push(reveal.getBoundingClientRect().height);
			if(performance.now()-begun<260) return requestAnimationFrame(sample);
			resolve({start:Math.round(start),end:Math.round(heights.at(-1)??0),mid:Math.round(heights[Math.floor(heights.length/2)]??0),open:reveal.getAttribute('data-open')});
		}
		requestAnimationFrame(sample);
	})`);
	check("folding the card shrinks across frames", fold.open === "false" && fold.mid < fold.start - 8 && fold.end < fold.mid, fold);
	await hold(500);
	await app.evaluate(`document.querySelector('[data-approval-card] button[aria-expanded="false"]')?.click()`);
	await until(`document.querySelector('[data-approval-card] .ly-reveal')?.getAttribute('data-open')==='true'`);
	await hold(700);
	await app.evaluate(`document.querySelector('[data-ly-question-form]').focus()`);
	await key("2", 50, "2");
	await hold(800);
	const picked = await app.evaluate<boolean>(`document.querySelectorAll('[data-ly-question-option] input')[1]?.checked===true`);
	check("digit 2 selects the second row", picked, picked);
	await key("0", 48, "0");
	await hold(700);
	const otherOn = await app.evaluate<{ checked: boolean; focused: boolean }>(`(()=>{const input=document.querySelector('input[aria-label="自定义回答"]');return {checked:document.querySelector('[data-ly-question-other] input')?.checked===true,focused:document.activeElement===input};})()`);
	check("digit 0 focuses Other", otherOn.checked && otherOn.focused, otherOn);
	await app.send("Input.insertText", { text: "我自己写一套 Web Components" });
	await hold(900);
	await click('button[aria-label="发送回答"]');
	await idle();

	await ask("ASK_MANY");
	const manyStart = await measure();
	check("many options start with a bottom fade", manyStart.fade.max > 40 && manyStart.fade.bottom > 0 && manyStart.fade.top === 0 && !manyStart.footer.covered, manyStart.fade);
	check("sixteen rows stay equal width without indexes", manyStart.indexes.length === 0 && manyStart.labels.length === 16 && manyStart.widths.every((width) => Math.abs(width - (manyStart.widths[0] ?? 0)) <= 1), { count: manyStart.labels.length, widths: manyStart.widths.slice(0, 3) });
	const viewport = await app.evaluate<{ x: number; y: number }>("(()=>{const r=document.querySelector('.ly-approval-scroll').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...viewport });
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...viewport, deltaX: 0, deltaY: 220 });
	await until("document.querySelector('.ly-approval-scroll > .ly-scroll-view').scrollTop>30");
	await hold(900);
	const manyMid = await measure();
	check("scrolling options fades both edges and keeps footer clear", manyMid.fade.top > 0 && manyMid.fade.bottom > 0 && !manyMid.footer.covered && manyMid.card.bottom <= manyMid.viewport, { fade: manyMid.fade, footer: manyMid.footer, card: manyMid.card });
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...viewport, deltaX: 0, deltaY: 2400 });
	await until("document.querySelector('.ly-approval-scroll > .ly-scroll-view').scrollHeight-document.querySelector('.ly-approval-scroll > .ly-scroll-view').clientHeight-document.querySelector('.ly-approval-scroll > .ly-scroll-view').scrollTop<8");
	await hold(800);
	const manyEnd = await measure();
	check("end of the list fades only the top", manyEnd.fade.top > 0 && manyEnd.fade.bottom === 0 && !manyEnd.footer.covered, manyEnd.fade);
	await click("[data-ly-question-option]:last-of-type");
	await hold(600);
	await click('button[aria-label="确认选择"]');
	await idle();

	await ask("ASK_LONG");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 800, deviceScaleFactor: 1, mobile: false });
	await until("innerWidth===375");
	await hold(1000);
	const compact = await measure();
	check("long card stays in a 375 window and does not cover buttons", compact.card.top >= 0 && compact.card.bottom <= 800 && !compact.footer.covered && compact.other && compact.footer.skip, compact.card);
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
	await until("innerWidth===1280");
	await hold(700);
	await click("[data-ly-question-option]");
	await click('button[aria-label="确认选择"]');
	await idle();

	await ask("ASK_MULTI");
	await click("[data-ly-question-option]");
	await click("[data-ly-question-option]:nth-of-type(2)");
	await hold(700);
	const multi = await app.evaluate<number>("document.querySelectorAll('[data-ly-question-option] input:checked').length");
	check("multi-select keeps two rows on", multi === 2, multi);
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:"dark"}});})()`);
	await until("document.documentElement.style.colorScheme==='dark'");
	await hold(1200);
	await click('button[aria-label="确认选择"]');
	await idle();
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_提问卡_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 30);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
