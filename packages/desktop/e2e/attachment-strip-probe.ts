/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * 附件在界面上到底长什么样：输入框上方一张，发出去以后一张。
 *
 * 复现客户报的那一条——两张图、一段录屏、一份 PDF 一起拖进去，一个字没打。三件事要在真窗口里
 * 看，测试替不了：正文里有没有凭空多出 `【文件名】`，那一排附件齐不齐，以及发出去以后同一个文
 * 件是不是只出现了一次。
 *
 * 不是测试——`node e2e/attachment-strip-probe.ts`——但和测试一起放在这儿，因为它用同一套方式
 * 起窗口。跑的是 `out/` 里的产物，所以改完代码要先 `pnpm build`。
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODEL = "claude-opus-4-6-thinking";
const MODEL_PORT = 9581;

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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 920, x: 0, y: 0 }));
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
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "high", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

/**
 * 四个文件，一次拖进去。
 *
 * 走 `drop` 而不是去戳那个 `<input type=file>`：拖放是客户实际做的动作，而且 `ComposerShell`
 * 的 `onDrop` 就是附件进来的那扇门。图片用 canvas 现画，带个大字，这样截图里一眼能认出哪张是
 * 哪张——一个 1×1 的空 PNG 是看不出缩略图对不对的。
 */
const DROP = `(async () => {
	const draw = async (label, colour) => {
		const canvas = document.createElement("canvas");
		canvas.width = 320; canvas.height = 200;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = colour; ctx.fillRect(0, 0, 320, 200);
		ctx.fillStyle = "#ffffff"; ctx.font = "bold 96px sans-serif";
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText(label, 160, 100);
		return await new Promise((done) => canvas.toBlob(done, "image/png"));
	};

	const dt = new DataTransfer();
	dt.items.add(new File([await draw("A", "#3b5bdb")], "截屏2026-09-11 17.36.45.png", { type: "image/png" }));
	dt.items.add(new File([new Uint8Array([0, 1, 2, 3])], "录屏2026-09-11 17.37.06.mov", { type: "video/quicktime" }));
	dt.items.add(new File([await draw("B", "#0b7285")], "HLri6IQWoAAX73p.jpeg", { type: "image/jpeg" }));
	dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], "品类实验室_AI智能分析平台_技术架构白皮书_专业重构版.pdf", { type: "application/pdf" }));
	// 一份真能读成文本的，它的正文会进提示词——但绝不该铺进气泡，编辑一次之后也不该。
	dt.items.add(new File(["## 交接说明 这一段是文件正文，气泡里一个字都不该出现。".repeat(24)], "交接说明.md", { type: "text/markdown" }));

	const shell = document.querySelector("main .ly-composer");
	shell.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	return true;
})()`;

/** 输入框这一侧的读数：正文里有没有记号，那一排齐不齐。 */
const READ_COMPOSER = `(() => {
	const field = document.querySelector("main textarea");
	const shell = field.closest(".ly-composer");
	const strip = shell.querySelector("[data-ly-attachments]");
	const heights = [...strip.children].map((row) => [...row.children].map((cell) => Math.round(cell.getBoundingClientRect().height)));
	// 越界的那一个：叉从前浮在格子外面，换行之后正压在上一行缩略图的下缘上。
	const overflow = [...strip.querySelectorAll("*")].filter((el) => {
		const r = el.getBoundingClientRect(), s = strip.getBoundingClientRect();
		return r.width > 0 && (r.left < s.left - 0.5 || r.right > s.right + 0.5 || r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5);
	}).length;
	return {
		draft: field.value,
		bracketsInDraft: (field.value.match(/【/g) || []).length,
		rowHeights: heights,
		raggedRows: heights.filter((row) => new Set(row).size > 1).length,
		overflowing: overflow,
	};
})()`;

/** 气泡这一侧：附件在里面还是外面，同一个文件出现了几次。 */
const READ_BUBBLE = `(() => {
	const message = document.querySelector("[data-question-index]");
	const bubble = message.querySelector(".ly-user-bubble");
	const strip = message.querySelector("[data-ly-attachments]");
	const rows = strip ? [...strip.children] : [];
	const box = strip && strip.getBoundingClientRect();
	const bub = bubble && bubble.getBoundingClientRect();
	return {
		bubbleText: bubble ? bubble.innerText : null,
		bubbleExists: Boolean(bubble),
		inlineChipsInBubble: bubble ? bubble.querySelectorAll("[data-ly-attachment]").length : 0,
		bracketsInBubble: bubble ? (bubble.innerText.match(/【/g) || []).length : 0,
		stripAboveBubble: Boolean(box && bub) && box.bottom <= bub.top + 1,
		/* visual-details.test.ts 按这一条判「图片和它的气泡右边缘齐平」，改完要还站得住。 */
		rightEdgesMatch: Boolean(box && bub) && Math.round(box.right) === Math.round(bub.right),
		thumbnails: strip ? strip.querySelectorAll("img").length : 0,
		stripRowHeights: rows.map((row) => [...row.children].map((cell) => Math.round(cell.getBoundingClientRect().height))),
		names: strip ? [...strip.querySelectorAll("span")].map((s) => s.textContent).filter(Boolean) : [],
	};
})()`;

async function clip(app: Awaited<ReturnType<typeof startApp>>, selector: string, pad = 14) {
	const box = await app.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left) - ${pad}, y: Math.round(r.top) - ${pad}, width: Math.round(r.width) + ${pad * 2}, height: Math.round(r.height) + ${pad * 2} };
	})()`);
	return await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
}

const out = process.argv[2] ?? "/tmp/lyra-attachments";
const model = startModel();
const app = await startApp({ port: 9472, seed });

try {
	await new Promise((r) => setTimeout(r, 1600));
	await app.evaluate(DROP);
	// 一段录屏和一份 PDF 都会弹一条「读不成文本」的提示，等它自己退场再拍。
	await new Promise((r) => setTimeout(r, 5200));

	const composer = await app.evaluate<Record<string, unknown>>(READ_COMPOSER);
	console.log("输入框：", JSON.stringify(composer, null, 1));
	await writeFile(`${out}-composer.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-composer.png`);

	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "这几个文件看一下");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 4500));

	const bubble = await app.evaluate<Record<string, unknown>>(READ_BUBBLE);
	console.log("气泡：", JSON.stringify(bubble, null, 1));
	await writeFile(`${out}-sent.png`, Buffer.from((await clip(app, "[data-question-index]", 18)).data, "base64"));
	console.log(`wrote ${out}-sent.png`);

	/*
	 * 改一个字再发一遍。
	 *
	 * 编辑改的是措辞，不是这条消息附了什么——而附件和 `displayText` 从前不跟着走，于是编辑一次
	 * 附件就从界面上消失一次。这一步要跨 5 层（组件 → store → preload → 主进程 → core），全是
	 * 透传，所以只要有一层漏掉参数，这里就看得见。
	 */
	await app.evaluate(`(() => {
		document.querySelector('[data-question-index] button[aria-label="编辑并重新发送"]').click();
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 700));
	await app.evaluate(`(() => {
		const field = document.querySelector("[data-question-index] textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "改一个字：这几个文件仔细看一下");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 4500));

	const edited = await app.evaluate<Record<string, unknown>>(READ_BUBBLE);
	console.log("编辑后：", JSON.stringify(edited, null, 1));
	await writeFile(`${out}-edited.png`, Buffer.from((await clip(app, "[data-question-index]", 18)).data, "base64"));
	console.log(`wrote ${out}-edited.png`);
} finally {
	await app.stop();
	model.closeAllConnections?.();
	await new Promise<void>((done) => {
		model.close(() => done());
		setTimeout(done, 1500);
	});
}
