/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 真窗口里的「排队假死」，现在是它的守卫。
 *
 * 症状：排队那条被送了出去，却没有任何一轮为它跑起来——队列条走掉了，气泡也画上了，助手那一侧
 * 却永远空着。真窗口里量到的比这还糟：输入框从此永久卡在「停止」上，之后说什么都只能继续排队，
 * 连停止按钮都按不动，只能切走再切回来才解得开。
 *
 * 决定性的证据不在界面上，在这台假模型服务器的账上：**它收到了几个真回合请求**。排队那条要是
 * 真开了一轮，这里必然多一笔；假死的意思就是这笔账不动。
 *
 * 按住回合不放的是末尾那次「规则建议」分类请求（`session-turn.ts` 的 `offerRuleFromCorrection`）
 * ——服务器认出它就拖住几秒，模拟一次真实的网络调用。修好之后该看到两件事：那条请求被主进程
 * 主动掐断（人说了下一句，这次判断作废），以及排队那句几十毫秒内就跑起来，而不是等满几秒。
 *
 * 断言那一半在 `packages/core/test/queue-settling.test.ts`，那四条能红得出来（矩阵验过）。
 * 这一支管的是那四条量不到的：屏幕上到底画成什么样。
 *
 * 跑法：node --experimental-strip-types packages/desktop/e2e/queue-stall-probe.ts
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = process.env.LYRA_E2E_ARTIFACTS ?? join(homedir(), "Desktop", "排队假死测试");
/** 回合末尾那次分类请求要拖多久——一次真实网络调用的量级。 */
const CLASSIFY_HOLD_MS = 6_000;
/** 排队那句话。屏幕上要数它出现几次。 */
const QUEUED = "这个文件是不是可以删除掉了";

let app!: RunningApp;
let server!: Server;
/** 还挂着的真回合，先进先出——探针说停哪一个就停哪一个。 */
const open: { res: ServerResponse }[] = [];
/** 服务器的账：每一笔请求是真回合还是分类器，什么时候来的。 */
const ledger: { kind: "回合" | "分类器"; at: number }[] = [];
/** 分类请求什么时候被掐断的——没被掐断就是 null。 */
let classifyCutAt: number | null = null;
const t0 = Date.now();
const realTurns = () => ledger.filter((r) => r.kind === "回合").length;

function emit(res: ServerResponse, type: string, data: object) {
	res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

/** 结束最早的那个回合，像模型自己写完了一样。 */
function finishTurn() {
	const held = open.shift();
	if (!held) return false;
	emit(held.res, "content_block_stop", { index: 0 });
	emit(held.res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
	emit(held.res, "message_stop", {});
	held.res.end();
	return true;
}

/** 一整条流，写完就收——分类器那一次走这条路。 */
function answerWhole(res: ServerResponse, text: string) {
	res.writeHead(200, { "content-type": "text/event-stream" });
	emit(res, "message_start", { message: { id: "qa-classify", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
	emit(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	emit(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text } });
	emit(res, "content_block_stop", { index: 0 });
	emit(res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } });
	emit(res, "message_stop", {});
	res.end();
}

async function main() {
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
		req.on("end", () => {
			/*
			 * 分类器那一次认得出来：它的 system prompt 是 `rules/from-correction.ts` 里那段。
			 * 认出来就拖住——这正是主进程「已经说完、还没放手」的那段时间。
			 */
			if (body.includes("你在判断一段对话里")) {
				ledger.push({ kind: "分类器", at: Date.now() - t0 });
				console.log(`  [服务器] +${Date.now() - t0}ms 分类请求进来了，按住 ${CLASSIFY_HOLD_MS}ms 不放`);
				// 被这一端主动断开就是修好了的证据：人说了下一句，这次判断作废，不该再把回合压着。
				res.on("close", () => {
					if (classifyCutAt === null) {
						classifyCutAt = Date.now() - t0;
						console.log(`  [服务器] +${classifyCutAt}ms 分类请求被客户端掐断了 ← 收尾被叫停`);
					}
				});
				setTimeout(() => {
					if (classifyCutAt !== null) return;
					console.log(`  [服务器] +${Date.now() - t0}ms 分类请求自己跑满了`);
					answerWhole(res, '{"isCorrection": false}');
				}, CLASSIFY_HOLD_MS);
				return;
			}
			ledger.push({ kind: "回合", at: Date.now() - t0 });
			console.log(`  [服务器] +${Date.now() - t0}ms 第 ${realTurns()} 个真回合请求进来了`);
			res.writeHead(200, { "content-type": "text/event-stream" });
			emit(res, "message_start", { message: { id: `qa-${realTurns()}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: `第 ${realTurns()} 轮开始了，正在忙。` } });
			open.push({ res });
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	app = await startApp({
		port: 9688,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});
	await mkdir(OUT, { recursive: true });

	await clickAt('[data-ly-row="qa-short"]');

	// 第一句带触发词，回合结束后那个规则分类器才会真的去发一次请求。
	console.log("\n=== 1. 开一轮，让它忙着 ===");
	await send("不要再用 any 了");
	await until(`document.querySelector('[data-composer-send="stop"]')`);
	console.log("真回合请求数：", realTurns(), "｜挂着的：", open.length);

	console.log("\n=== 2. 趁它忙，说下一句——落在队列条上 ===");
	await send(QUEUED);
	await wait(400);
	console.log("队列条：", JSON.stringify(await rows()));
	const before = await questions();
	console.log("转录里的用户消息（末三条）：", JSON.stringify(before.slice(-3)));
	await shot("1-回合跑着，下一句排在条上");

	console.log("\n=== 3. 这一轮说完了（主进程转头去跑分类器，还没放手） ===");
	finishTurn();
	const held = Date.now() - t0;
	await wait(1_500);
	const after = await questions();
	console.log("队列条：", JSON.stringify(await rows()), "← 走掉了，看起来像发出去了");
	console.log("转录里的用户消息（末三条）：", JSON.stringify(after.slice(-3)), "← 气泡也画上去了");
	console.log("真回合请求数：", realTurns(), "｜挂着的：", open.length, "← 决定性：排队那句要是真跑了，这里该是 2");
	console.log("界面在报的状态：", JSON.stringify(await runningLook()));
	await shot("2-这一轮说完了");

	console.log(`\n=== 4. 那次分类请求本来要按住 ${CLASSIFY_HOLD_MS}ms，看排队那句等了多久 ===`);
	const ranAt = ledger.filter((r) => r.kind === "回合")[1]?.at;
	console.log("真回合请求数：", realTurns(), "｜挂着的：", open.length, "← 修好了的话这里该是 2");
	console.log("界面在报的状态：", JSON.stringify(await runningLook()));
	console.log(
		"排队那句等了多久才真的跑起来：",
		ranAt ? `${ranAt - held}ms（从这一轮说完算起）` : "（还没跑）",
		classifyCutAt !== null ? `｜分类请求在 +${classifyCutAt - held}ms 被掐断` : "｜分类请求没被掐断",
	);
	await shot("3-排队那句该跑起来了");

	console.log("\n=== 5. 让这一轮也说完，再发一句「?」 ===");
	finishTurn();
	await wait(1_500);
	console.log("界面在报的状态：", JSON.stringify(await runningLook()), "← 该回到 send 了");
	await send("?");
	await wait(2_000);
	const final = await questions();
	console.log("真回合请求数：", realTurns(), "｜挂着的：", open.length);
	console.log("队列条：", JSON.stringify(await rows()));
	console.log("转录里的用户消息（末四条）：", JSON.stringify(final.slice(-4)));
	await shot("4-全部说完");

	console.log("\n================ 结论 ================");
	const copies = final.filter((t) => t.includes(QUEUED)).length;
	console.log(`服务器的账：${JSON.stringify(ledger)}`);
	console.log(`「${QUEUED}」在屏幕上出现 ${copies} 次（该是 1 次）`);
	const order = final.slice(-3);
	console.log(`末三条的顺序：${JSON.stringify(order)}`);
	const queuedRan = realTurns() >= 2;
	const rightOrder = order[1]?.includes(QUEUED) && order[2]?.includes("?");
	console.log(
		queuedRan && copies === 1 && rightOrder
			? "✅ 修好了：排队那句自己开了一轮、只出现一次、排在「?」前面。"
			: `❌ 还有问题：跑起来=${queuedRan}，出现次数=${copies}，顺序对=${Boolean(rightOrder)}`,
	);
	console.log("\n截图：", OUT);
}

/** 队列条上现在有哪几行。 */
async function rows() {
	return app.evaluate<{ text: string; leaving: boolean }[]>(
		`[...document.querySelectorAll('[data-queue-row]')].map(e=>({text:e.textContent.trim().slice(0,18),leaving:e.hasAttribute('data-leaving')}))`,
	);
}

/** 转录里每一条用户消息画出来的字。 */
async function questions() {
	return app.evaluate<string[]>(
		`[...document.querySelectorAll('[data-dock-pane="conversation"] [data-question-index]')].map(e=>e.textContent.trim().replace(/\\s+/g,' ').slice(0,24))`,
	);
}

/** 界面此刻在报「在跑」还是「停了」——按钮的样子，和转录末尾有没有助手那一侧的动静。 */
async function runningLook() {
	return app.evaluate(
		`(()=>{const pane=document.querySelector('[data-dock-pane="conversation"]');
		const send=pane.querySelector('[data-composer-send]');
		const rows=[...pane.querySelectorAll('[data-flow-row],[data-question-index]')];
		return {发送按钮:send?send.getAttribute('data-composer-send'):'(没有)',
		 转录末尾:rows.length?rows[rows.length-1].textContent.trim().replace(/\\s+/g,' ').slice(0,30):'(空)',
		 队列条几行:document.querySelectorAll('[data-queue-row]').length}})()`,
	);
}

async function until(expression: string) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}))}tick()})`,
	);
}
async function frames(n = 20) {
	await app.evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}
function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function clickAt(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await frames(2);
	const point = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
async function send(text: string) {
	await clickAt('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await frames(3);
}
async function shot(name: string) {
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(image.data, "base64"));
}

try {
	await main();
} finally {
	// 收尾：还挂着的那几个回合放掉，否则窗口关了它们还在等。
	while (finishTurn());
	await app?.stop();
	await closeListeningServer(server);
}
