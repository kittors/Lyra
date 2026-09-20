/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 上一轮还在跑的时候又发一条：那一条在屏幕上是什么样子。
 *
 * 用户说的是反馈，不是丢消息：新气泡发出去之后，它底下应该有一行「在等上一轮」，而不是直接
 * 一个转圈——转圈说的是「正在想你这条」，可这会儿 agent 还在写上一条。等真轮到它，那一行才
 * 该换成正常的 `Thinking…`。
 *
 * 所以这里不问 store，只按人看得见的东西读：转录里从上到下依次是什么，队列条上有没有东西，
 * 转圈站在谁下面。
 *
 * 假模型先吐一句就卡住，闸门由探针决定什么时候放——那段「卡住」正是要观察的窗口。
 *
 * 用法：node --experimental-strip-types e2e/pending-turn-probe.ts
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const PORT = 9751;
const MODEL_PORT = 9752;
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra等待反馈测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

let app: RunningApp;
let model: Server;
const open = new Set<ServerResponse>();
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  ——  ${saw}`}`);
}

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

let requests = 0;
let release: (() => void) | null = null;
const held = new Promise<void>((resolve) => {
	release = resolve;
});

function startModel(): Server {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => { body += String(chunk); });
		req.on("end", () => {
			void (async () => {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
				open.add(res);
				res.on("close", () => open.delete(res));
				sse(res, { type: "message_start", message: { id: `msg_${requests++}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "第一轮开始写了" } });

				// 拟标题那一次不带工具定义，别让它把闸门用掉——见 `fake-model-probe-pitfalls`。
				if (body.includes("todo_write")) await held;

				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，第一轮写完了。" } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "message_stop" });
				res.end();
			})();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);

async function until(expression: string, ms = 20000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

async function settle(frames = 40): Promise<void> {
	await evaluate(`new Promise(resolve=>{let n=${frames};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`);
}

/**
 * 屏幕上从上到下都有什么。
 *
 * 只收三类：人说的话、模型写的正文、转圈那一行。按 y 排序而不是按 DOM 顺序——要回答的问题
 * 是「转圈站在谁下面」，那是画出来的位置，不是树里的位置。
 */
const SKELETON = `(() => {
	const rows = [];
	const seen = new Set();
	const push = (kind, text, el) => {
		const r = el.getBoundingClientRect();
		if (r.height === 0) return;
		rows.push({ kind, text: (text || '').trim().slice(0, 40), y: Math.round(r.top) });
	};
	for (const el of document.querySelectorAll('[data-question-index]')) {
		push('人说的', el.textContent, el);
		seen.add(el);
	}
	for (const el of document.querySelectorAll('[data-ly-transcript-rows] > *')) {
		if (seen.has(el) || el.querySelector('[data-question-index]')) continue;
		const t = (el.textContent || '').trim();
		if (t) push('模型写的', t, el);
	}
	/*
	 * 认 \`data-ly-running\`，不认那句话。
	 *
	 * 第一版拿 /Thinking|Mulling|…/ 去找，一行都没捞到——界面是中文的，那些短语按语言换。
	 * 报出来像是「底下什么都没有」，而实际上那一行一直在，只是探针看不见它。
	 */
	const spin = document.querySelector('[data-ly-running]');
	if (spin) push(spin.hasAttribute('data-ly-awaiting-turn') ? '等待那行' : '转圈那行', spin.textContent, spin);
	rows.sort((a, b) => a.y - b.y);
	const queue = document.querySelector('[data-composer-queue]');
	const queued = queue ? [...queue.querySelectorAll('.ly-queue-row')].map((r) => (r.textContent || '').trim().slice(0, 30)) : [];
	return { rows, queued, hasQueueBar: Boolean(queue) };
})()`;

interface Skeleton {
	rows: { kind: string; text: string; y: number }[];
	queued: string[];
	hasQueueBar: boolean;
}

function show(title: string, skeleton: Skeleton): void {
	console.log(`\n${title}`);
	console.log("   屏幕上从上到下：");
	for (const row of skeleton.rows) console.log(`      [${row.y.toString().padStart(4)}] ${row.kind}：${row.text}`);
	console.log(`   队列条：${skeleton.hasQueueBar ? (skeleton.queued.length ? skeleton.queued.join(" / ") : "（画出来了但空着）") : "没有"}`);
}

async function type(text: string): Promise<void> {
	await evaluate(`(() => {
		const box = document.querySelector('main textarea');
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
		setter.call(box, ${JSON.stringify(text)});
		box.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	})()`);
	await settle(10);
	await evaluate(`(() => {
		const box = document.querySelector('main textarea');
		box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		return true;
	})()`);
}

async function main(): Promise<void> {
	model = startModel();
	app = await startApp({ port: PORT, seed: (home) => seedInteractions(home, MODEL_PORT) });
	const frames: Frame[] = [];
	const stopRecording = await startRecording(PORT, frames);
	try {
		await until(`document.querySelector('[data-ly-row="qa-short"] > button')`, 30000);
		await evaluate(`(() => { const b = document.querySelector('[data-ly-row="qa-short"] > button'); if (b) b.click(); return !!b; })()`);
		await settle(30);

		console.log("【一】发第一条，让 agent 开始写（假模型写一句就卡住）");
		await type("第一条消息");
		await until(`[...document.querySelectorAll('button[aria-label]')].some((b) => /停止|Stop/.test(b.getAttribute('aria-label') || ''))`, 20000);
		await settle(30);
		show("此时（agent 正在写第一轮）：", await evaluate<Skeleton>(SKELETON));

		console.log("\n【二】上一轮还卡着，再发第二条 —— 它该落在队列条上");
		await type("第二条消息");
		await settle(60);
		const queued = await evaluate<Skeleton>(SKELETON);
		show("发完第二条：", queued);
		check("第二条落在队列条上，没挤进转录", queued.queued.length === 1, queued.queued.join("/") || "队列条是空的");

		/*
		 * 把它从队列条上「插进这一轮」——这就是用户看到的那一刻。
		 *
		 * 这一步带的是 `deliver: "steer"`，所以界面不排队、直接发：气泡当场画进转录。而后台这会儿
		 * 正忙着写上一条，收到之后只是把它记下来，**不会广播「我受理了」**。于是气泡在转录里站着，
		 * 底下那行小字说的是什么，就是这次要验的东西。
		 */
		console.log("\n【三】把它插进这一轮：气泡进转录，可后台还在写上一条");
		await evaluate(`(() => { const b = document.querySelector('[data-queue-steer]'); if (b) b.click(); return !!b; })()`);
		await settle(60);
		// 门槛是 400ms，等够再读——见 `RunningIndicator` 里 `AWAIT_GRACE_MS`。
		await new Promise((r) => setTimeout(r, 900));
		await settle(30);
		const pending = await evaluate<Skeleton>(SKELETON);
		show("插进去之后：", pending);
		const last = pending.rows[pending.rows.length - 1];
		check("第二条的气泡进了转录", pending.rows.some((r) => r.kind === "人说的" && r.text.includes("第二条消息")), "转录里找不到它");
		check(
			"气泡底下是「等上一条回复完成」，不是「正在想」",
			last?.kind === "等待那行" && /等上一条回复完成/.test(last.text),
			last ? `最底下是：${last.kind}「${last.text}」` : "最底下什么都没有",
		);
		const marked = await evaluate<boolean>(`Boolean(document.querySelector('[data-ly-awaiting-turn]'))`);
		check("那一行带着「还没轮到」的标记", marked, "没有 data-ly-awaiting-turn");

		console.log("\n【四】放行第一轮，看它换成正常的「正在想」");
		release?.();
		await settle(150);
		const after = await evaluate<Skeleton>(SKELETON);
		show("第一轮收尾之后：", after);
		const stillWaiting = await evaluate<boolean>(`Boolean(document.querySelector('[data-ly-awaiting-turn]'))`);
		check("轮到它了，「等上一条」那行退场", !stillWaiting, "还挂着「等上一条回复完成」");
		check("第二条真的被答了", after.rows.filter((r) => r.kind === "模型写的" && /第一轮写完了/.test(r.text)).length >= 2, "只看到一条回答");
	} finally {
		await stopRecording();
		for (const res of open) res.destroy();
		await app?.stop().catch(() => {});
		await new Promise<void>((resolve) => model.close(() => resolve()));
		const passed = checks.filter((c) => c.ok).length;
		const out = join(OUT_DIR, `${STAMP}_等待上一条_${passed}of${checks.length}.mp4`);
		if (frames.length > 0) await encode(frames, out, 60, 1200);
		console.log(`\n${passed}/${checks.length} 项通过`);
		console.log(frames.length > 0 ? `视频：${out}` : "没有采到帧，视频没生成");
		if (passed !== checks.length) process.exitCode = 1;
	}
}

main().catch(async (error: unknown) => {
	console.error(error);
	for (const res of open) res.destroy();
	await app?.stop().catch(() => {});
	model?.close();
	process.exitCode = 1;
});
