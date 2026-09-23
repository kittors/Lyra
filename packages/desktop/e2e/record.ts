/* oxlint-disable no-console -- probe CLI plumbing that prints what it did */
/**
 * 把一个真窗口录成视频，以及在里面点点划划。
 *
 * 抓全屏会把用户自己的窗口一起录进去，所以画面走 CDP 的 `Page.startScreencast`——它只给这一个页面的
 * 合成帧。`app.send` 是一问一答收不到事件，所以这里自己开一条常驻 WS 来接。
 *
 * 从 `demo-recorder.ts` 里搬出来的：第二个录制器要用同一套东西，而这套东西有好几处是踩出来的
 * （帧要回执、帧按真实时间排、`evaluate` 的 40 秒上限），复制一份等于把那些坑也复制一份。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { evaluateRenderer, type RunningApp } from "./app.ts";

export interface Frame {
	at: number;
	data: Buffer;
}

/**
 * 主界面那一个 webContents，不是碰巧排在前面的那一个。
 *
 * Lyra 跑起来有不止一个 `page` 类型的目标，而且标题和 URL 一模一样——从列表里 `find` 第一个，
 * 有时候拿到的是另一个。录制会因此整趟报废，且不报错：`startScreencast` 在一个什么都不画的
 * webContents 上照样成功，只是一帧都不来。查了半天以为是窗口被挡住，其实是录错了对象。
 *
 * 所以挨个问一句「你身上有主界面吗」。`.ly-shell` 是 `app.ts` 等待启动时认的同一个记号。
 */
async function pageTarget(port: number): Promise<string> {
	const list = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
	}>;
	const pages = list.flatMap((t) => (t.type === "page" && t.webSocketDebuggerUrl ? [t.webSocketDebuggerUrl] : []));
	if (pages.length === 0) throw new Error("没找到页面的调试地址");
	let fallback: string | undefined;
	for (const url of pages) {
		const mark = await evaluateRenderer<{ workspace: boolean; session: boolean; shell: boolean }>(
			url,
			`({
				workspace: Boolean(document.querySelector("[data-ly-workspace-window]")),
				session: Boolean(document.querySelector("[data-ly-session-window]")),
				shell: Boolean(document.querySelector(".ly-shell")),
			})`,
		).catch(() => null);
		if (mark?.workspace) return url;
		if (mark?.shell && !mark.session && !fallback) fallback = url;
	}
	if (fallback) return fallback;
	throw new Error(`${pages.length} 个页面目标里没有一个画着主界面`);
}

/** 开录，返回一个「停」。帧攒进传进来的数组里。 */
export async function startRecording(port: number, frames: Frame[]): Promise<() => Promise<void>> {
	const socket = new WebSocket(await pageTarget(port), { maxPayload: 256 * 1024 * 1024 });
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	let id = 0;
	const send = (method: string, params: Record<string, unknown> = {}) =>
		socket.send(JSON.stringify({ id: ++id, method, params }));

	socket.on("message", (raw: Buffer) => {
		const message = JSON.parse(raw.toString()) as { method?: string; params?: { data: string; sessionId: number } };
		if (message.method !== "Page.screencastFrame" || !message.params) return;
		frames.push({ at: Date.now(), data: Buffer.from(message.params.data, "base64") });
		// 必须回执，否则 Chromium 只发这一帧就停了。
		send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
	});

	send("Page.enable");
	send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
	return async () => {
		send("Page.stopScreencast");
		await new Promise((r) => setTimeout(r, 400));
		socket.close();
	};
}

/**
 * 一条常驻连接，用来「摆一下、拍一张」地逐帧录。
 *
 * `startScreencast` 给的是合成帧，而 macOS 上被别的窗口完全盖住的窗口不合成——那趟录下来只有开头
 * 一帧，之后画面怎么变都没有。量过：连改十次 `opacity`，帧数还是 1。跑测试的时候终端就在窗口前面，
 * 所以这不是偶尔，是常态。
 *
 * `Page.captureScreenshot` 每次强制渲染一帧，遮不遮得住都拍得到，代价是慢——所以连接要常驻：
 * `app.evaluate` 和 `app.send` 每次都新开一条 WebSocket 再关掉（见 `app.ts` 的 `withConnection`，
 * 那是为了远程句柄的生命周期，对一问一答是对的），按帧这么来，开销比拍照本身还大。
 *
 * 拍到的帧仍然打**真实**时间戳，交给下面的 `encode`。所以动画是按真机时间走完的，不是逐格摆出来
 * 再假装连贯：CSS 过渡该用 220ms 就用了 220ms，录出来多快，播出来就多快。
 */
export async function frameGrabber(port: number): Promise<{
	evaluate: <T>(expression: string) => Promise<T>;
	shot: () => Promise<Buffer>;
	/**
	 * 随便发一条 CDP 命令，走的是这条常驻连接。
	 *
	 * 需要它是因为有些命令**必须连着发**：`DOM.getDocument` 给的 `nodeId` 只在发出它的那个会话里
	 * 有效，而 `app.send` 每次都新开一条连接再关掉——第二条命令拿着上一条的 nodeId 过去，得到的是
	 * 「Could not find node with given id」。往 `<input type=file>` 里塞一个真文件正好要这么三步。
	 */
	send: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
	close: () => void;
}> {
	const socket = new WebSocket(await pageTarget(port), { maxPayload: 256 * 1024 * 1024 });
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	let id = 0;
	const waiting = new Map<number, { done: (value: unknown) => void; fail: (error: Error) => void }>();
	socket.on("message", (raw: Buffer) => {
		const message = JSON.parse(raw.toString()) as { id?: number; error?: { message: string }; result?: unknown };
		if (message.id === undefined) return;
		const pending = waiting.get(message.id);
		if (!pending) return;
		waiting.delete(message.id);
		if (message.error) pending.fail(new Error(message.error.message));
		else pending.done(message.result);
	});
	const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
		new Promise<T>((done, fail) => {
			const at = ++id;
			waiting.set(at, { done: done as (value: unknown) => void, fail });
			socket.send(JSON.stringify({ id: at, method, params }));
		});
	return {
		evaluate: async <T>(expression: string): Promise<T> => {
			const answer = await call<{
				result?: { value: T };
				exceptionDetails?: { text: string; exception?: { description?: string } };
			}>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
			if (answer.exceptionDetails) {
				// `text` 单说就是一句「Uncaught」，出了什么事全在 description 里。
				const { text, exception } = answer.exceptionDetails;
				throw new Error(`${text}${exception?.description ? `\n${exception.description}` : ""}\n表达式：${expression.slice(0, 200)}`);
			}
			return answer.result?.value as T;
		},
		shot: async () =>
			Buffer.from((await call<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 92 })).data, "base64"),
		send: <T,>(method: string, params: Record<string, unknown> = {}) => call<T>(method, params),
		close: () => socket.close(),
	};
}

/**
 * 帧按**真实到达时间**合成，不是按固定 fps 排。
 *
 * 屏幕录制的帧只在画面变化时产生，当成等间隔去合成，等待的那几秒会被压成一瞬，节奏就假了。
 *
 * `fps` 给定时，输出转成那个帧率的定帧率视频。**时间轴不变**——每一帧该停多久还是停多久，只是按固定
 * 间隔重新采一遍，不足的地方补上重复帧。要这个是因为有些播放器（和大多数录屏分享的地方）对变帧率的
 * 素材处理得很差：明明录到了每一帧，播出来却是一顿一顿的。不给就维持变帧率，文件更小。
 */
export async function encode(frames: Frame[], out: string, fps?: number, maxHoldMs = 0): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-demo-"));
	const lines: string[] = [];
	for (const [index, frame] of frames.entries()) {
		const file = join(dir, `${String(index).padStart(6, "0")}.jpg`);
		await writeFile(file, frame.data);
		const next = frames[index + 1];
		// 最后一帧多留一秒，免得画面戛然而止。
		const raw = next ? Math.max(0.016, (next.at - frame.at) / 1000) : 1;
		const seconds = maxHoldMs > 0 ? Math.min(raw, maxHoldMs / 1000) : raw;
		lines.push(`file '${file}'`, `duration ${seconds.toFixed(3)}`);
	}
	// concat 解复用器要求最后一帧再写一次，否则它的 duration 被忽略。
	if (frames.length > 0) lines.push(`file '${join(dir, `${String(frames.length - 1).padStart(6, "0")}.jpg`)}'`);
	const list = join(dir, "frames.txt");
	await writeFile(list, lines.join("\n"));

	await mkdir(join(out, "..").replace(/\/\.\.$/, ""), { recursive: true }).catch(() => {});
	await new Promise<void>((done, fail) => {
		const ff = spawn(
			"ffmpeg",
			[
				"-y", "-f", "concat", "-safe", "0", "-i", list,
				...(fps ? ["-vsync", "cfr", "-r", String(fps)] : ["-vsync", "vfr"]),
				// yuv420p + 偶数边长，否则 QuickTime 和多数播放器不认。
				"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
				"-c:v", "libx264", "-preset", "slow", "-crf", "18",
				"-movflags", "+faststart",
				out,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let err = "";
		ff.stderr.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-4000); });
		/*
		 * 没装 ffmpeg 的机器——CI 就是——录像只是做不出来，测试本身已经跑完了。
		 *
		 * 原来没接 `error`：spawn 报 ENOENT 成了未捕获异常，`after` 钩子把整个文件判红，而那个文件
		 * 里的每一条用例都是绿的。录像是给人看的证据，不是断言。
		 */
		ff.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") return fail(error);
			console.warn(`这台机器没有 ffmpeg，录像没有合成：${out}`);
			done();
		});
		ff.once("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg 失败：\n${err}`))));
	});
	await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 在窗口里点点划划
// ---------------------------------------------------------------------------

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 一套绑在某个窗口上的操作。 */
export function driver(app: RunningApp) {
	/*
	 * 从 Node 侧短轮询，不在页面里挂长 promise。
	 *
	 * `app.evaluate` 自己 40 秒超时（见 `app.ts`），而一轮真实对话要跑好几分钟——把等待写在页面里，
	 * 等到的是那条超时，不是那一轮。
	 */
	async function until(expression: string, ms = 300000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
			await pause(250);
		}
		throw new Error(`等不到：${expression}`);
	}

	const box = (selector: string) =>
		app.evaluate<{ x: number; y: number }>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);

	/** 真鼠标，不是 `.click()`——后者在这个界面里打不开会话行一类的东西。 */
	async function click(selector: string) {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 20000);
		const point = await box(selector);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", {
				type, ...point,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
	}

	async function hover(selector: string) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await box(selector)) });
	}

	/** 给一个元素挂个记号，好让后面用一个稳定的选择器找到它。 */
	async function mark(selector: string, attribute: string) {
		await app.evaluate(
			`(()=>{document.querySelector('[${attribute}]')?.removeAttribute('${attribute}');const el=document.querySelector(${JSON.stringify(selector)});if(el)el.setAttribute('${attribute}','');})()`,
		);
	}

	/** 按文字找按钮并挂记号——界面上很多按钮没有别的抓手。 */
	async function markByText(pattern: string, attribute: string) {
		await app.evaluate(
			`(()=>{document.querySelector('[${attribute}]')?.removeAttribute('${attribute}');[...document.querySelectorAll("button")].find((b)=>${pattern}.test(b.innerText.trim()))?.setAttribute('${attribute}','');})()`,
		);
	}

	async function type(text: string) {
		await app.evaluate(`(()=>{
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, ${JSON.stringify(text)});
			field.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
	}

	async function submit() {
		await app.evaluate(`(()=>{
			const field = document.querySelector("main textarea");
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		})()`);
	}

	async function key(name: string, code: number) {
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
	}

	/** 等这一轮跑完——「停止」按钮出现过，然后消失并保持三秒。 */
	async function settled(ms = 300000) {
		const end = Date.now() + ms;
		let started = false;
		let quiet = 0;
		while (Date.now() < end) {
			const turning = await app.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="停止"]'))`);
			if (turning) { started = true; quiet = 0; }
			else if (started && ++quiet > 12) return;
			await pause(250);
		}
	}

	return { until, click, hover, mark, markByText, type, submit, key, settled };
}
