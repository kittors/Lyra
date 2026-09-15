/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一轮在**看不见的那个会话里**跑完之后，切回去还转不转圈。
 *
 * 症状：转录末尾已经有了收尾的那一行（用时、速度），下面却还挂着「Thinking…」和一个转圈，输入框
 * 右边是停止按钮而不是发送。磁盘上那个会话最后一条是 `agent_end / done`——也就是说**事情早就做完
 * 了，只有界面不知道**。
 *
 * 为什么要专门构造「切走再切回」：`applyAgentEvent` 对不在屏幕上的那个会话会提前拐弯，走的是
 * `cachedEvent` 那条路；而那条路有个前提——**这个会话得在缓存里**。不在缓存里时，`agent_end` 只
 * 刷新了侧边栏的列表，运行状态没有任何地方接住。逐层读代码每一层看起来都对，所以这里不再读，
 * 直接把那个时序摆出来。
 *
 * 假模型收到请求之后先吐一句，然后**故意拖住**，给探针留出切走、切回的时间，最后才收尾。
 *
 * 用法：node --experimental-strip-types e2e/background-end-probe.ts
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const PORT = 9707;
const MODEL_PORT = 9708;

let app: RunningApp;
let model: Server;
const open = new Set<ServerResponse>();
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— ${saw}`}`);
}

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

let requests = 0;
/** 拖住那一轮的闸门：探针切走之后才放行。 */
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
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "开始干活了" } });

				// 拟标题那一次不带工具定义，别让它把闸门用掉。
				if (body.includes("todo_write")) await held;

				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，做完了。" } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "message_stop" });
				res.end();
			})();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 20000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

async function settle(frames = 40): Promise<void> {
	await evaluate(`new Promise(resolve=>{let n=${frames};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`);
}

/** 屏幕上现在是不是「在跑」的样子——按人看得见的东西读，不问 store。 */
const LOOKS_RUNNING = `(() => {
	const stop = [...document.querySelectorAll('button[aria-label]')].some((b) => /停止|Stop/.test(b.getAttribute('aria-label') || ''));
	const indicator = [...document.querySelectorAll('*')].some((e) => e.children.length === 0 && /Thinking|Mulling|Pondering|Turning it over|Chewing on it|Working it out/.test(e.textContent || ''));
	return { stop, indicator };
})()`;

async function openRow(id: string): Promise<void> {
	await evaluate(`(() => { const b = document.querySelector('[data-ly-row="${id}"] > button'); if (b) b.click(); return !!b; })()`);
	await settle(30);
}

async function main(): Promise<void> {
	model = startModel();
	app = await startApp({ port: PORT, seed: (home) => seedInteractions(home, MODEL_PORT) });
	try {
		await until(`document.querySelector('[data-ly-row="qa-short"] > button')`, 30000);
		await openRow("qa-short");

		console.log("【一】在 qa-short 里发一条，让它跑起来");
		await evaluate(`(() => {
			const box = document.querySelector('main textarea');
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
			setter.call(box, '跑一轮');
			box.dispatchEvent(new Event('input', { bubbles: true }));
			return true;
		})()`);
		await settle(10);
		await evaluate(`(() => {
			const box = document.querySelector('main textarea');
			box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			return true;
		})()`);

		await until(`${LOOKS_RUNNING}.stop === true`, 20000);
		console.log("   跑起来了（输入框变成了停止按钮）");

		console.log("\n【二】切到另一个会话，让那一轮在看不见的地方收尾");
		await openRow("qa-long");
		await settle(30);
		release?.();
		// 给收尾一点时间落到磁盘和各处状态上。
		await new Promise((r) => setTimeout(r, 2500));

		console.log("\n【三】切回去，看它还转不转圈");
		await openRow("qa-short");
		await settle(60);
		const looks = await evaluate<{ stop: boolean; indicator: boolean }>(LOOKS_RUNNING);
		console.log(`   停止按钮还在：${looks.stop}   运行指示器还在：${looks.indicator}`);

		check("切回去之后输入框回到发送态，不是停止", !looks.stop, "还是停止按钮——界面以为它还在跑");
		check("切回去之后没有转圈的运行指示器", !looks.indicator, "「Thinking…」还挂在转录末尾");
		/*
		 * 这一场没能复现用户截到的样子，那不是白跑——它排除了一整条路。
		 *
		 * 「切走、在后台收尾、再切回」这条时序是干净的：`cachedEvent` 会清 `running`，切回来时
		 * `readSelectedSession` 又从主进程读了一次权威值。用户那一轮跑了一小时十三分，中间大概率断过
		 * 重连，触发条件比这特殊得多。
		 *
		 * 与其继续猜是哪一条事件在什么时候丢的，根上的毛病是**`running` 完全靠事件流维持、从不对账**
		 * ——任何一次丢失、乱序或窗口重建都会让它永久停在「正在跑」，而界面上没有任何入口能把它按回去。
		 * 那道对账（`store.reconcileRunning`）由 `test/reconcile-running.test.ts` 验：它不关心事件为
		 * 什么丢，只验「主进程说没跑时，界面会不会跟着回来」。
		 */
	} finally {
		for (const res of open) res.destroy();
		await app?.stop().catch(() => {});
		await new Promise<void>((resolve) => model.close(() => resolve()));
	}

	const passed = checks.filter((c) => c.ok).length;
	console.log(`\n${passed}/${checks.length} 项通过`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	for (const res of open) res.destroy();
	await app?.stop().catch(() => {});
	model?.close();
	process.exitCode = 1;
});
