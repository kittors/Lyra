/* oxlint-disable no-console -- a recorder that says what it did and where it put the film */
/**
 * 把附件那一排录下来：放进去、滚起来、点开、删掉、发出去。
 *
 * `node --experimental-strip-types e2e/attachment-demo.ts [输出目录]`
 *
 * 探针（`attachment-strip-probe.ts`）答的是「停下来的时候每个数对不对」，这一支答的是另一半：过程
 * 里有没有哪一帧是跳的。两件事都要——逐格都对、滚起来仍然可能在某一帧闪一下，而那种闪只在连着看的
 * 时候才现形。这一次要看的动态有四样：
 *
 *   放进去   附件进条的同时，正文里落下一枚标记，光标接在它后面
 *   滚起来   撑出输入框之后横着拨，左右两头的渐隐此消彼长
 *   停上去   叉和「更多」淡进来，最靠边那一格的叉不该被裁掉
 *   删掉     标记跟着从句子里消失，同门类里排在它后面的那些重新编号
 *
 * 逐帧拍，不用 `startScreencast`：被别的窗口盖住的窗口不合成，那趟录下来只有开头一帧。帧打的是真实
 * 时间戳，所以 CSS 那 220ms 的过渡录出来就是 220ms。
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const MODEL = "claude-opus-4-6-thinking";
const MODEL_PORT = 9583;
const PORT = 9474;

function startModel() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			const sse = (p: unknown) => res.write(`event: ${(p as { type: string }).type}\ndata: ${JSON.stringify(p)}\n\n`);
			sse({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 1200, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到，我看一下这几个文件。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
			sse({ type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 860, x: 60, y: 60 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay", name: "Relay", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages",
					apiKey: "not-a-key", enabled: true,
					models: [{
						id: `relay/${MODEL}`, providerId: "relay", modelId: MODEL, name: MODEL,
						contextWindow: 200000, maxOutputTokens: 8192,
						supportsThinking: true, supportsImages: true, supportsTools: true,
					}],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			// 客户报这件事的截图是浅色的，片子要对得上。
			appearance: { theme: process.env.LYRA_THEME === "dark" ? "dark" : "light" },
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "high", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

/** 一张带大字的图，好让片子里认得出哪张是哪张。 */
const DRAW = `async (label, colour) => {
	const canvas = document.createElement("canvas");
	canvas.width = 320; canvas.height = 200;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = colour; ctx.fillRect(0, 0, 320, 200);
	ctx.fillStyle = "#ffffff"; ctx.font = "bold 96px sans-serif";
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	ctx.fillText(label, 160, 100);
	return await new Promise((done) => canvas.toBlob(done, "image/png"));
}`;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const out = process.argv[2] ?? join(homedir(), "Desktop");
const model = startModel();
const app = await startApp({ port: PORT, seed });
const grab = await frameGrabber(PORT);
const frames: Frame[] = [];

/** 拍够 `ms` 毫秒。一次 `shot` 本身要三五十毫秒，帧率是这么来的，不用自己算。 */
async function film(ms: number) {
	const end = Date.now() + ms;
	do {
		frames.push({ at: Date.now(), data: await grab.shot() });
	} while (Date.now() < end);
}

try {
	await pause(1800);
	await film(700);

	/* 一、放三个进去：一张图、一份表格、一份 PDF。标记同时落进正文。 */
	await grab.evaluate(`(async () => {
		const draw = ${DRAW};
		const dt = new DataTransfer();
		dt.items.add(new File([await draw("A", "#3b5bdb")], "截屏 2026-09-13 10.02.11.png", { type: "image/png" }));
		dt.items.add(new File([new Uint8Array([80, 75, 3, 4])], "陈列道具导入模板(花园里店).xlsx", { type: ${JSON.stringify(XLSX)} }));
		dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], "品类实验室_技术架构白皮书.pdf", { type: "application/pdf" }));
		document.querySelector("main .ly-composer").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
		return true;
	})()`);
	await film(2600);

	/* 二、接着标记往下打字——那一枚是句子的一部分，不是旁边的装饰。 */
	for (const piece of ["照着 ", "这份表格 ", "改一版，", "配图用第一张"]) {
		await grab.evaluate(`(() => {
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, field.value + ${JSON.stringify(piece)});
			field.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
		await film(420);
	}
	await film(900);

	/* 三、再放五份进去，把这一排撑出输入框。新的排在最右，所以它自己滚过去。 */
	await grab.evaluate(`(() => {
		const dt = new DataTransfer();
		for (let i = 0; i < 5; i++) {
			dt.items.add(new File([new Uint8Array([80, 75, 3, 4])], "陈列道具导入模板(花园里店).xlsx", { type: ${JSON.stringify(XLSX)} }));
		}
		document.querySelector("main .ly-composer").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
		return true;
	})()`);
	await film(2600);

	/* 四、用滚轮往左拨：右边那头化开，左边那头收掉。 */
	const track = await grab.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main .ly-composer [data-ly-attachments-track]").getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...track });
	for (let i = 0; i < 14; i++) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...track, deltaX: 0, deltaY: -130 });
		await film(90);
	}
	await film(800);

	/* 五、停在一格上：叉和「更多」淡进来。 */
	const first = await grab.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main .ly-composer [data-ly-attachment]").getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...first });
	await film(1500);

	/* 六、点开「更多」：做不到的事画成灰的，并且说出为什么。 */
	const more = await grab.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main .ly-composer [data-ly-attachment] [data-ly-hover-reveal]:last-of-type button").getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...more, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
	await film(2600);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await film(700);

	/*
	 * 七、取下那份表格：正文里指着它的标记跟着走，排在它后面的重新编号。
	 *
	 * 取的是「表格 1」，后面还有四份表格——所以这一下同时看得到两件事：标记消失，和「表格 2」成为
	 * 新的「表格 1」。
	 */
	await grab.evaluate(`document.querySelector("main .ly-composer [data-ly-attachments-track]").scrollLeft = 0`);
	await film(700);
	const cross = await grab.evaluate<{ x: number; y: number }>(`(() => {
		const tiles = [...document.querySelectorAll("main .ly-composer [data-ly-attachment]")];
		const target = tiles.find((tile) => {
			const body = tile.querySelector(".ly-attachment-body");
			return body && (body.getAttribute("aria-label") || "").includes("陈列道具");
		});
		const r = target.querySelector('[data-ly-hover-reveal] button[aria-label^="移除"]').getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...cross });
	await film(800);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...cross, button: "left", clickCount: 1 });
	}
	await film(2400);

	/* 八、发出去：气泡外面那一排铺开，句子里那几枚标签还在。 */
	await grab.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await film(4200);

	const file = join(out, process.env.LYRA_THEME === "dark" ? "Lyra-附件-暗色.mp4" : "Lyra-附件.mp4");
	await encode(frames, file, 30);
	console.log(`${frames.length} 帧 → ${file}`);
} finally {
	grab.close();
	await app.stop();
	model.closeAllConnections?.();
	await new Promise<void>((done) => {
		model.close(() => done());
		setTimeout(done, 1500);
	});
}
