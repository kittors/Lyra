/* oxlint-disable no-console -- 一支说出它看见了什么的探针 */
/**
 * 消息发出去之后，气泡里那几枚标记还剩什么。
 *
 * 客户截了一张图：发出去的气泡里，标记的底色没了，只剩图标和一行字；右键点上去，浮出来的是一个空
 * 的圆角灰框，正好盖住刚说的那句话。两件事都只在**发送之后**才现形——输入框那一侧一直是对的，所以
 * 盯着输入框的探针全绿。
 *
 * 这支专管气泡那一侧，而且非走真文件不可：`DataTransfer` 现造的 `File` 在磁盘上没有对应物，附件因
 * 此没有路径，而「打开 / 在访达中显示 / 复制路径」三行全靠路径。少了它，菜单空不空根本测不出来。
 *
 * `node e2e/bubble-menu-probe.ts [输出前缀]`，跑 `out/` 里的产物——改完代码要先 `pnpm build`。
 * `LYRA_THEME=dark` 换暗色跑一遍：底色是「色相由门类给、明度由主题给」，只看一张等于只验了一半。
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const MODEL = "claude-opus-4-6-thinking";
const MODEL_PORT = 9585;
const PORT = 9478;

function startModel() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			const sse = (p: unknown) => res.write(`event: ${(p as { type: string }).type}\ndata: ${JSON.stringify(p)}\n\n`);
			sse({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 900, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } });
			sse({ type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

/** 这一趟的临时 home，跑完要去里面把转录读出来对账。 */
let HOME = "";

async function seed(home: string): Promise<void> {
	HOME = home;
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
			appearance: { theme: process.env.LYRA_THEME === "dark" ? "dark" : "light" },
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "high", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

/** 一张真图，给气泡外那一排用。 */
const DROP_IMAGE = `(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 320; canvas.height = 200;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#3b5bdb"; ctx.fillRect(0, 0, 320, 200);
	ctx.fillStyle = "#ffffff"; ctx.font = "bold 96px sans-serif";
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	ctx.fillText("A", 160, 100);
	const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
	const dt = new DataTransfer();
	dt.items.add(new File([blob], "image.png", { type: "image/png" }));
	document.querySelector("main .ly-composer").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	return true;
})()`;

/**
 * 气泡里每一枚标记，画成了什么样。
 *
 * 读的是算完的样式，不是「class 加上了没有」：底色画没画出来，只有 `backgroundColor` 答得了——这一
 * 条正是坏掉的那一条，而 class 一直都在。
 */
const READ_MARKS = `(() => {
	const bubble = document.querySelector("[data-question-index] .ly-user-bubble");
	if (!bubble) return { bubble: false };
	const marks = [...bubble.querySelectorAll(".ly-attachment-token")];
	return {
		bubble: true,
		text: bubble.innerText,
		marks: marks.map((mark) => {
			const paint = getComputedStyle(mark);
			const icon = getComputedStyle(mark, "::before");
			const box = mark.getBoundingClientRect();
			return {
				label: mark.textContent,
				kind: mark.getAttribute("data-kind"),
				background: paint.backgroundColor,
				// 底色画出来没有：完全透明就是没有。
				painted: paint.backgroundColor !== "rgba(0, 0, 0, 0)",
				radius: paint.borderTopLeftRadius,
				iconPainted: icon.backgroundImage !== "none" && icon.width !== "auto",
				at: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) },
			};
		}),
	};
})()`;

/** 菜单里那几行。一行都没有的时候，要能分清是「没弹」还是「弹了一个空框」。 */
const READ_MENU = `(() => {
	const menu = document.querySelector('[role="menu"], [role="dialog"]');
	if (!menu) return { open: false, emptyBox: document.querySelectorAll("body > div .fixed").length };
	const rows = [...menu.querySelectorAll("button")];
	const box = menu.getBoundingClientRect();
	return {
		open: true,
		rows: rows.map((row) => ({ label: (row.innerText || "").trim(), disabled: row.disabled === true })),
		// 空框就是这个样子：框在，里面一行都没有。
		size: Math.round(box.width) + "x" + Math.round(box.height),
	};
})()`;

const out = process.argv[2] ?? "/tmp/lyra-bubble";
const model = startModel();
const app = await startApp({ port: PORT, seed });
const wire = await frameGrabber(PORT);

async function shot(name: string, selector: string) {
	const box = await wire.evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left) - 20, y: Math.round(r.top) - 20, width: Math.round(r.width) + 40, height: Math.round(r.height) + 40 };
	})()`);
	if (!box) return;
	const picture = await wire.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	await writeFile(`${out}-${name}.png`, Buffer.from(picture.data, "base64"));
	console.log(`wrote ${out}-${name}.png`);
}

/** 右键点在某个坐标上，等菜单，读它。 */
async function rightClick(at: { x: number; y: number }) {
	await wire.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await new Promise((r) => setTimeout(r, 200));
	for (const type of ["mousePressed", "mouseReleased"]) {
		await wire.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "right", clickCount: 1 });
	}
	await new Promise((r) => setTimeout(r, 700));
	const menu = await wire.evaluate<Record<string, unknown>>(READ_MENU);
	return menu;
}

async function dismiss() {
	await wire.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await wire.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await new Promise((r) => setTimeout(r, 400));
}

try {
	await new Promise((r) => setTimeout(r, 1800));

	/*
	 * 两份真文件走「+」那个入口进来。
	 *
	 * 三条命令必须走同一条连接：`DOM.getDocument` 给的 `nodeId` 只在发出它的那个会话里有效。
	 */
	const sheet = join(tmpdir(), "陈列道具导入模板.csv");
	const note = join(tmpdir(), "交接说明.md");
	await writeFile(sheet, "门店,数量\n花园里店,12\n");
	await writeFile(note, "# 交接说明\n这一段是正文。\n");
	const doc = await wire.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
	const input = await wire.send<{ nodeId: number }>("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'main input[type="file"]' });
	await wire.send("DOM.setFileInputFiles", { files: [sheet, note], nodeId: input.nodeId });
	await new Promise((r) => setTimeout(r, 2200));

	await wire.evaluate(DROP_IMAGE);
	await new Promise((r) => setTimeout(r, 2000));

	/*
	 * 发出去之前，先在输入框那一侧右键同一份文件。
	 *
	 * 定位用：气泡里菜单空掉有两种可能，路径压根没取到，或者取到了而没跟着消息走。这一问把两者分
	 * 开——这边有「打开」而那边没有，说明断在发送这一程。
	 */
	const before = await wire.evaluate<{ x: number; y: number } | null>(`(() => {
		const marks = [...document.querySelectorAll("main .ly-composer .ly-attachment-token")];
		const target = marks.find((m) => m.textContent.includes("陈列道具"));
		if (!target) return null;
		const r = target.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (before) {
		console.log("发送前，输入框里那一枚：", JSON.stringify(await rightClick(before)));
		await dismiss();
	}

	// 打一句话，然后发出去。
	await wire.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, field.value + " 照着这份表格改一版");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 4200));

	const marks = await wire.evaluate<{ bubble: boolean; text?: string; marks?: { label: string; kind: string; painted: boolean; at: { x: number; y: number } }[] }>(READ_MARKS);
	console.log("气泡里那几枚：", JSON.stringify(marks, null, 1));
	await shot("bubble", "[data-question-index]");

	for (const mark of marks.marks ?? []) {
		const menu = await rightClick(mark.at);
		console.log(`右键「${mark.label.trim()}」（${mark.kind}）：`, JSON.stringify(menu));
		await shot(`menu-${mark.kind}`, "body");
		await dismiss();
	}

	/* 气泡外那一排上的缩略图，右键同样要有菜单。 */
	const tile = await wire.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-question-index] [data-ly-attachment]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (tile) {
		console.log("右键气泡外那一格：", JSON.stringify(await rightClick(tile)));
		await shot("menu-tile", "body");
		await dismiss();
	} else {
		console.log("气泡外那一排上一个格子都没有");
	}

	/*
	 * 存进转录里的那一份，附件带了哪几个字段。
	 *
	 * 界面上少一行菜单有两种来路：路径压根没跟着消息走，或者走了而没读到。直接看落盘的那一份，两者
	 * 一句话分清——而这是界面问不出来的。
	 */
	const { readdir, readFile } = await import("node:fs/promises");
	const root = join(HOME, "sessions");
	const walk = async (dir: string): Promise<string[]> => {
		const out: string[] = [];
		for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			const here = join(dir, entry.name);
			if (entry.isDirectory()) out.push(...(await walk(here)));
			else if (entry.name.endsWith(".jsonl")) out.push(here);
		}
		return out;
	};
	for (const file of await walk(root)) {
		for (const line of (await readFile(file, "utf8")).split("\n")) {
			if (!line.includes('"attachments"')) continue;
			const parsed = JSON.parse(line) as { message?: { attachments?: unknown[] }; attachments?: unknown[] };
			console.log("转录里存的附件：", JSON.stringify(parsed.message?.attachments ?? parsed.attachments));
		}
	}
} finally {
	wire.close();
	await app.stop();
	model.closeAllConnections?.();
	await new Promise<void>((done) => {
		model.close(() => done());
		setTimeout(done, 1500);
	});
}
