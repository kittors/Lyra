/* oxlint-disable no-console -- 探针把量到的东西打出来，那就是它的产物 */
/**
 * 侧边聊天执行工具时，状态图标到底按什么顺序画出来。
 *
 * 要查的是：会不会出现「转圈 → 红叉 → 打勾」，也就是中间闪过一个根本没发生的失败。
 *
 * `MessageRow.tsx` 里那一行是嫌疑：
 *     status={run?.status ?? (message.stopReason === "pending" ? "running" : "error")}
 * 工具运行记录还没建立、而消息已经不是 pending 时，兜底落到 `error`。而事件顺序正是
 * `message_end`（消息定稿成 toolUse）先于 `tool_start`（建立记录）——中间那个窗口期就是红叉。
 *
 * 但「代码里存在这个窗口」和「它真的被画出来」是两回事：React 可能把两次更新批处理掉。所以这里
 * 不读 store、不猜时序，用 rAF 逐帧看**画出来的那个图标**——采样会漏掉短暂的一帧，
 * MutationObserver 又会报出没有真正绘制的中间态。同时逐帧截图，合成一段可以直接看的录像。
 */

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra侧边聊天状态测试");
const PORT = 9741;

let app: RunningApp;
let port = 0;
const requests: string[] = [];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, timeout = 10000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(120);
	}
	throw new Error(`等不到：${expression}`);
}

/** 真实鼠标。`evaluate` 里的 `.click()` 打不开这些东西——菜单项尤其。 */
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	const at = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
	await pause(160);
}

/** 按可见文字找一个元素并点它，靠一个临时属性把选择器钉住。 */
async function label(text: string, scope = "button") {
	const match = `(e.textContent || '').trim().startsWith(${JSON.stringify(text)})`;
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&${match})`);
	await app.evaluate(`(()=>{
		document.querySelector('[data-qa-target]')?.removeAttribute('data-qa-target');
		[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&${match}).setAttribute('data-qa-target','');
	})()`);
	await click("[data-qa-target]");
}

/** 侧边聊天那一轮先发工具调用，拿到工具结果后再收尾。 */
function model() {
	return createServer((req, res) => {
		let raw = "";
		req.on("data", (c) => { raw += c; });
		req.on("end", () => {
			const body = raw;
			requests.push(body.slice(0, 200));
			// 侧边聊天那一轮认得出：只有它带着 `dispatch_task` 这个工具定义。
			const isSide = body.includes("dispatch_task");
			const hasResult = body.includes("tool_result") || body.includes("toolResult");
			const tool = isSide && !hasResult;
			/*
			 * 主会话那一轮慢一点，真实模型本来就有首字延迟。
			 *
			 * 不是为了制造时序——派出去的活要真的花点时间，任务条和工具卡才有机会各自更新，
			 * 中间那个窗口期才看得见。瞬间返回的假模型会把所有事挤进同一批渲染。
			 */
			const delay = isSide ? 0 : 1500;
			setTimeout(() => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
				emit("message_start", { message: { id: "qa", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
				if (tool) {
					/*
					 * 一次三个工具调用——这才是最可能撞上那个窗口的形状。
					 *
					 * 工具是挨个跑的，而消息在第一个开跑之前就已经 `message_end` 定稿成 toolUse。
					 * 于是后两张卡片处在「消息不是 pending 了，自己的运行记录还没建立」这个状态里，
					 * 正是 `run?.status ?? (... : "error")` 兜底到 error 的条件。
					 */
					const calls = [
						{ id: "call-side-1", name: "dispatch_task", input: { instruction: "看一下 README 写了什么" } },
						{ id: "call-side-2", name: "read_main_chat", input: { mode: "recent" } },
						{ id: "call-side-3", name: "read_main_chat", input: { mode: "recent" } },
					];
					calls.forEach((call, index) => {
						emit("content_block_start", { index, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } });
						emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) } });
						emit("content_block_stop", { index });
					});
				} else {
					emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
					emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "好了。" } });
					emit("content_block_stop", { index: 0 });
				}
				emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
				emit("message_stop", {});
				res.end();
			}, delay);
		});
	});
}

async function seed(home: string) {
	await seedInteractions(home, port);
	const path = join(home, "settings.json");
	const settings = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	/*
	 * 一个 before-tool 钩子，把那个窗口按住 1.2 秒。
	 *
	 * 这是产品自带的功能，不是改代码：钩子跑在 `tool-run.ts:157`，而 `tool_start` 在 238 行才发出去。
	 * 于是「消息已定稿、运行记录还没建立」这段被原样拉长——闪现的那一帧和它慢放之后是同一件事，
	 * 只是终于看得见了。谁都能在设置里配一个钩子，那时看到的就是这个。
	 */
	const hooks = [{ id: "slowmo", command: "sleep 1.2", tools: [], event: "before-tool", enabled: true, blocking: false }];
	await writeFile(path, JSON.stringify({ ...settings, hooks, thinking: "off", projectMemory: false, permissionMode: "full", appearance: { theme: "light", reduceMotion: "off" } }));
}

/**
 * 每一绘制帧里，侧边面板上那张工具卡画的是什么。
 *
 * 认的是图标自己的 class（`text-ok/75` 是打勾，`text-danger/85` 是红叉），不是 store 里的值——
 * 要量的就是「画出来的」那一个。
 */
const WATCH = `(() => {
  window.__probe = [];
  /* 两个时钟的对照点：状态用 performance.now 记，录像帧用 Date.now 记，事后要把红叉那一刻对回帧上。 */
  window.__t0 = { perf: performance.now(), wall: Date.now() };
  let last = "";
  /* StatusSpinner 画出来是 svg.ly-dash——它的 class 里没有 animate/spin，认错就会把转圈读成「没状态」。 */
  const cardState = (card) => {
    const svgs = [...card.querySelectorAll('svg')].map(s => s.getAttribute('class') || '');
    const all = svgs.join(' ');
    const spinner = svgs.some(c => c.includes('ly-dash'));
    if (all.includes('text-danger/85')) return spinner ? 'X+转圈' : 'X';
    if (all.includes('text-ok/75')) return spinner ? '勾+转圈' : '勾';
    if (spinner) return '转圈';
    return '无状态';
  };
  /*
   * 状态类图标，不分是工具卡的还是任务条的——用户看见的那个未必在工具卡上。
   * 任务条的行没有可读属性，而这次不改源码，所以按 lucide 自己的 class 认。
   */
  const STATUS = ['circle-x', 'circle-check', 'triangle-alert', 'ban', 'circle-dashed', 'clock', 'check'];
  const read = () => {
    const pane = document.querySelector('[data-dock-pane="chat"]');
    if (!pane) return 'no-pane';
    const cards = [...pane.querySelectorAll('button[aria-expanded]')];
    const tool = cards.length ? cards.map(cardState).join(',') : '无卡片';
    const icons = [...pane.querySelectorAll('svg')].map(s => {
      const c = s.getAttribute('class') || '';
      if (c.includes('ly-dash')) return '转圈';
      const m = c.match(/lucide-([a-z-]+)/);
      return m && STATUS.includes(m[1]) ? m[1] : '';
    }).filter(Boolean).join(',');
    return '工具[' + tool + '] 图标[' + (icons || '-') + ']';
  };
  /*
   * 红叉那一帧，把卡片原样克隆下来钉在屏幕上。
   *
   * 它只存在几十毫秒，录像拍不到，事后按时间戳也对不回去（screencast 帧带的是收到的时刻，
   * 不是画面的时刻）。克隆的是那一刻真实渲染出来的节点本身——不是重画一个像它的东西。
   */
  const freeze = () => {
    if (window.__frozen) return;
    window.__frozen = true;
    const pane = document.querySelector('[data-dock-pane="chat"]');
    const cards = [...pane.querySelectorAll('button[aria-expanded]')].filter(c => (c.innerHTML || '').includes('text-danger/85'));
    if (!cards.length) { window.__frozen = false; return; }
    const box = document.createElement('div');
    box.id = '__frozen';
    box.style.cssText = 'position:fixed;left:40px;top:120px;z-index:99999;background:#fff;border:3px solid #e5484d;border-radius:12px;padding:10px 12px;width:460px;box-shadow:0 12px 40px rgba(0,0,0,.28);font:13px -apple-system,sans-serif';
    const title = document.createElement('div');
    title.textContent = '↓ 这三张卡片是红叉那一帧的真实节点（克隆自 ' + Math.round(performance.now()) + 'ms）';
    title.style.cssText = 'color:#e5484d;font-weight:600;margin-bottom:8px';
    box.appendChild(title);
    for (const c of cards) box.appendChild(c.cloneNode(true));
    document.body.appendChild(box);
  };
  const tick = () => {
    const now = read();
    if (now !== last) { window.__probe.push({ state: now, at: Math.round(performance.now()) }); last = now; }
    if (now.includes('X')) freeze();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

async function main() {
	await mkdir(OUT, { recursive: true });
	const server = model();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");
	port = address.port;

	app = await startApp({ port: PORT, seed });
	await app.evaluate("document.fonts.ready");
	await pause(1300);

	// 打开一个会话。
	await app.evaluate(`(()=>{const b=document.querySelector('[data-ly-row="qa-long"] > button'); if(b) b.click(); return !!b;})()`);
	await pause(900);

	// 打开侧边聊天：面板菜单里那一项。真实鼠标，不是 evaluate 里的 .click()。
	await click('button[aria-label="面板"]');
	await pause(600);
	await label("侧边聊天", '[role="menuitem"]');
	await until(`Boolean(document.querySelector('[data-dock-pane="chat"] textarea'))`, 15000);
	await pause(800);
	const paneUp = await app.evaluate<boolean>(`Boolean(document.querySelector('[data-dock-pane="chat"]'))`);
	console.log("侧边聊天面板打开:", paneUp);
	if (!paneUp) throw new Error("侧边聊天没打开，后面的都白测");

	/*
	 * 让整台机器按比例慢下来，而不是插截图进去。
	 *
	 * 上一版用 frameGrabber 逐帧强拍，红叉就不见了——每次 captureScreenshot 都占着主线程强制渲染
	 * 一帧，把 React 的更新节奏整个打乱。观测干扰了被观测的竞态，量到的「没问题」是假的。
	 *
	 * CPU 降速不抢主线程的活，只把所有时序一起拉长，竞态窗口跟着按比例变宽——这正是慢机器或高
	 * 负载下用户看到的那一幕，不是人为造出来的假象。
	 */
	const frames: Frame[] = [];
	const stopRecording = await startRecording(PORT, frames);
	await app.evaluate(WATCH);

	// 在侧边聊天里发一句话，触发它调工具。真实输入 + 真实回车。
	await click('[data-dock-pane="chat"] textarea');
	await app.send("Input.insertText", { text: "看一下主会话最近说了什么" });
	await pause(300);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });

	// 降速之后什么都慢，给足时间。
	await pause(16000);
	const states = await app.evaluate<{ state: string; at: number }[]>(`window.__probe`);
	const t0 = await app.evaluate<{ perf: number; wall: number }>(`window.__t0`);
	await stopRecording();
	const froze = await app.evaluate("Boolean(document.getElementById('__frozen'))");
	console.log("红叉那一帧已冻结在屏幕上:", froze);
	const shot = join(OUT, froze ? "红叉那一帧（冻结）.png" : "结束时的侧边聊天.png");
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(shot, Buffer.from(data, "base64"));
	await app.stop();
	await closeListeningServer(server);

	console.log("\n=== 逐帧画出来的状态序列 ===");
	for (const s of states) console.log(`  ${String(s.at).padStart(6)}ms  ${s.state}`);

	const painted = states.map((s) => s.state);
	const errorAt = painted.findIndex((s) => s.includes("[X") || s.includes(",X") || s.includes("circle-x"));
	const doneAt = painted.findIndex((s) => s.includes("勾") || s.includes("circle-check"));
	const badFlash = errorAt >= 0 && doneAt > errorAt;

	console.log("\n=== 判定 ===");
	console.log(`${badFlash ? "✘" : "✔"} ${badFlash ? "复现：红叉出现在打勾之前，闪了一次假失败" : "没有复现：没有「先红叉后打勾」"}`);
	if (badFlash) {
		const flash = states[doneAt].at - states[errorAt].at;
		console.log(`   红叉停留约 ${flash}ms（第 ${errorAt + 1} 个状态 → 第 ${doneAt + 1} 个状态）`);
	}
	console.log(`   请求数 ${requests.length}，截图 ${shot}`);

	if (frames.length) {
		const video = join(OUT, "侧边聊天工具状态.mp4");
		await encode(frames, video, 30);
		console.log(`   录像 ${video}（${frames.length} 帧）`);

		/*
		 * 把红叉那一刻的真实画面单独抠出来。
		 *
		 * 85ms 在一段 30fps 的录像里是两三帧，播过去根本看不清。而这一帧不是放慢也不是摆拍——
		 * 它就是录制时拍到的那一张，只是按时间戳找回来了。
		 */
		if (badFlash) {
			const toWall = (perf: number) => t0.wall + (perf - t0.perf);
			const from = toWall(states[errorAt].at);
			const to = toWall(states[doneAt].at);
			const hit = frames.filter((f) => f.at >= from - 600 && f.at <= to + 600);
			const picked = hit.length ? hit : [frames.reduce((best, f) => (Math.abs(f.at - from) < Math.abs(best.at - from) ? f : best), frames[0])];
			for (const [index, frame] of picked.slice(0, 12).entries()) {
				const file = join(OUT, `红叉那一刻-${index + 1}（+${Math.round(frame.at - from)}ms）.jpg`);
				await writeFile(file, frame.data);
				console.log(`   ${file}`);
			}
		}
	}
}

await main();
