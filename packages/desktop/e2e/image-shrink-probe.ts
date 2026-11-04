/* oxlint-disable no-console -- probe CLI that prints what the real window sent */
/**
 * What pictures cost a request — measured on the wire, in the real window.
 *
 * A fake Anthropic endpoint records every request body the app sends: its size, how long it took to
 * arrive, and every image in it (format, bytes, pixel size). The script drives the real composer:
 *
 *   1. thirteen large pictures (ten 4K screenshots, three 12 MP photos) attached and sent;
 *   2. the model reads a 4K screenshot from the project with `read`;
 *   3. one more plain message, so the third request shows what the history alone costs.
 *
 * `node --experimental-strip-types e2e/image-shrink-probe.ts <label> [throttle KB/s]`
 *
 * The label names the run (改前 / 改后). A throttle makes the endpoint read the body that slowly, the
 * way a relay with a thin uplink does; without one the numbers are localhost and the transfer time is
 * computed for 15 KB/s from the byte count. Video and screenshots go to ~/Desktop/Lyra图片压缩测试/.
 */

import { createServer, type IncomingMessage } from "node:http";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { imageDimensions } from "../../core/src/images/dimensions.ts";
import { startApp } from "./app.ts";
import { makeImageSamples } from "./image-samples.ts";
import { driver, encode, frameGrabber, pause, type Frame } from "./record.ts";

const LABEL = process.argv[2] ?? "run";
const THROTTLE_KBPS = Number(process.argv[3] ?? 0);
const MODEL = "claude-opus-4-6";
const MODEL_PORT = 9587;
const PORT = 9478;
const OUT = join(homedir(), "Desktop", "Lyra图片压缩测试");
const SAMPLES = "/tmp/lyra-image-samples";
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

interface SeenImage {
	where: "user" | "tool";
	mime: string;
	bytes: number;
	size: string;
}
interface SeenRequest {
	conversation: boolean;
	bytes: number;
	firstByteAt: number;
	lastByteAt: number;
	images: SeenImage[];
	notes: string[];
	lastUserText: string;
}

const requests: SeenRequest[] = [];
const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok || !saw ? "" : `  —— 看到的是：${saw}`}`);
}

function collect(body: { messages?: { role: string; content: unknown }[] }): Pick<SeenRequest, "images" | "notes" | "lastUserText"> {
	const images: SeenImage[] = [];
	const notes: string[] = [];
	let lastUserText = "";
	const visit = (block: Record<string, unknown>, where: SeenImage["where"]) => {
		if (block.type === "image") {
			const source = block.source as { media_type: string; data: string };
			const raw = Buffer.from(source.data, "base64");
			const dims = imageDimensions(new Uint8Array(raw));
			images.push({ where, mime: source.media_type, bytes: raw.length, size: dims ? `${dims.width}x${dims.height}` : "?" });
		} else if (block.type === "text" && typeof block.text === "string") {
			const text = block.text;
			if (text.startsWith("[A reduced copy of an earlier image")) notes.push("gist");
			else if (text.startsWith("[An earlier image")) notes.push("omitted");
			else if (text.startsWith("[Image: original")) notes.push("scaled");
			else if (/^\[(unsupported image|image omitted)/i.test(text)) notes.push(`unsendable: ${text.slice(0, 120)}`);
		} else if (block.type === "tool_result" && Array.isArray(block.content)) {
			for (const inner of block.content as Record<string, unknown>[]) visit(inner, "tool");
		}
	};
	for (const message of body.messages ?? []) {
		const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as Record<string, unknown>[]);
		for (const block of content) visit(block, "user");
		if (message.role === "user") {
			const said = content.filter((b) => b.type === "text" && typeof b.text === "string" && !(b.text as string).startsWith("<env>")).map((b) => b.text as string);
			if (said.length > 0 && !content.some((b) => b.type === "tool_result")) lastUserText = said[said.length - 1];
		}
	}
	return { images, notes, lastUserText };
}

/** Read the body at `THROTTLE_KBPS`, the way a thin uplink delivers it. */
function readBody(req: IncomingMessage): Promise<{ text: string; first: number; last: number }> {
	return new Promise((done) => {
		const chunks: Buffer[] = [];
		let first = 0;
		req.on("data", (chunk: Buffer) => {
			if (!first) first = Date.now();
			chunks.push(chunk);
			if (THROTTLE_KBPS > 0) {
				req.pause();
				setTimeout(() => req.resume(), (chunk.length / (THROTTLE_KBPS * 1024)) * 1000);
			}
		});
		req.on("end", () => done({ text: Buffer.concat(chunks).toString("utf8"), first, last: Date.now() }));
	});
}

function startModel() {
	const server = createServer(async (req, res) => {
		const { text, first, last } = await readBody(req);
		const body = JSON.parse(text) as { tools?: { name: string }[]; messages?: { role: string; content: unknown }[] };
		const conversation = (body.tools ?? []).some((t) => t.name === "read");
		const seen = collect(body);
		requests.push({ conversation, bytes: Buffer.byteLength(text), firstByteAt: first, lastByteAt: last, ...seen });
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
		const sse = (p: { type: string }) => res.write(`event: ${p.type}\ndata: ${JSON.stringify(p)}\n\n`);
		sse({ type: "message_start", message: { id: `m${requests.length}`, role: "assistant", content: [], usage: { input_tokens: 1000, output_tokens: 0 } } } as never);
		// The newest tool result means the read is done; a request to read means call the tool.
		const messages = body.messages ?? [];
		const tail = messages[messages.length - 1];
		const answered = Array.isArray(tail?.content) && (tail.content as { type: string }[]).some((b) => b.type === "tool_result");
		if (conversation && !answered && seen.lastUserText.includes("读一下")) {
			sse({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_${requests.length}`, name: "read", input: {} } } as never);
			sse({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: "shots/big-4k.png" }) } } as never);
			sse({ type: "content_block_stop", index: 0 } as never);
			sse({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } } as never);
		} else {
			const reply = conversation ? (answered ? "看过这张截图了。" : "收到这些图。") : "图片压缩测试";
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } as never);
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } } as never);
			sse({ type: "content_block_stop", index: 0 } as never);
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } } as never);
		}
		sse({ type: "message_stop" });
		res.end();
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(join(project, "shots"), { recursive: true });
	await copyFile(join(SAMPLES, "07-devtools.png"), join(project, "shots", "big-4k.png"));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay", name: "Relay", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
					models: [{ id: `relay/${MODEL}`, providerId: "relay", modelId: MODEL, name: MODEL, contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: true, supportsTools: true }],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			appearance: { theme: "light" },
			uiLocale: "zh-CN",
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "off", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4526, token: null },
		}),
	);
}

async function dirBytes(dir: string): Promise<number> {
	const names = await readdir(dir).catch(() => [] as string[]);
	let total = 0;
	for (const name of names) total += (await stat(join(dir, name))).size;
	return total;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

const samples = makeImageSamples(SAMPLES);
await mkdir(OUT, { recursive: true });
const model = startModel();
const app = await startApp({ port: PORT, seed });
const ui = driver(app);
const grab = await frameGrabber(PORT);
const frames: Frame[] = [];
const recorder = { on: true };
const film = (async () => {
	while (recorder.on) {
		frames.push({ at: Date.now(), data: await grab.shot() });
		await pause(150);
	}
})();
const shot = async (name: string) => writeFile(join(OUT, `${STAMP}_${LABEL}_${name}.png`), Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));

/** Put files on the composer through its own file input — the same path as choosing them with 「+」. */
async function attach(paths: string[]) {
	const doc = await grab.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
	const picker = await grab.send<{ nodeId: number }>("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'main input[type="file"]' });
	await grab.send("DOM.setFileInputFiles", { files: paths, nodeId: picker.nodeId });
}
const tiles = () => app.evaluate<number>(`document.querySelectorAll("main [data-ly-attachment]").length`);

async function turn(text: string, conversationRequests: number) {
	/*
	 * Typed at the caret, after the attachment marks. Setting the field's whole value would wipe the
	 * marks, and a mark removed from the sentence takes its attachment with it — the first draft of this
	 * probe sent "看看这些图" with no pictures at all.
	 */
	await app.evaluate(`(() => { const field = document.querySelector("main textarea"); field.focus(); field.setSelectionRange(field.value.length, field.value.length); })()`);
	await grab.send("Input.insertText", { text });
	await pause(400);
	const pressedAt = Date.now();
	await ui.submit();
	const end = Date.now() + 600_000;
	while (requests.filter((r) => r.conversation).length < conversationRequests && Date.now() < end) await pause(200);
	// The fake answers in milliseconds, so 「停止」 can come and go between two polls: wait for quiet instead.
	let quiet = 0;
	while (quiet < 6 && Date.now() < end) {
		const busy = await app.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="停止"]'))`);
		quiet = busy ? 0 : quiet + 1;
		await pause(250);
	}
	return pressedAt;
}

let failed = false;
try {
	await pause(2000);
	await ui.until(`document.querySelector('main input[type="file"]')`, 30000);
	await shot("01_空白输入框");

	// 1. Thirteen pictures, eight then five (the composer takes eight at a time).
	const attachStart = Date.now();
	await attach(samples.slice(0, 8).map((s) => s.path));
	await ui.until(`document.querySelectorAll("main [data-ly-attachment]").length >= 8`, 60000);
	await attach(samples.slice(8).map((s) => s.path));
	await ui.until(`document.querySelectorAll("main [data-ly-attachment]").length >= 12`, 60000);
	await pause(1500);
	const attachMs = Date.now() - attachStart;
	const attached = await tiles();
	await shot("02_放进十三张图");
	console.log(`放进去：${attached} 格，用时 ${attachMs} ms`);

	const pressed1 = await turn("看看这些图", 1);
	await pause(800);
	await shot("03_发出去之后");
	const bubbleTiles = await app.evaluate<number>(`document.querySelectorAll("main [data-ly-attachment]").length`);
	const bubbleImages = await app.evaluate<number>(`[...document.querySelectorAll("main [data-ly-attachment] img")].filter((img) => img.complete && img.naturalWidth > 0).length`);
	console.log(`气泡外那一排：${bubbleTiles} 格，画出来的图 ${bubbleImages} 张`);

	// The stored copy, opened in the viewer: the fitted picture, not the 4K original and not a broken tile.
	await ui.click("main [data-ly-attachment] img");
	await ui.until(`[...document.querySelectorAll('[role="dialog"] img')].some((img) => img.complete && img.naturalWidth > 0)`, 20000);
	await pause(900);
	const viewed = await app.evaluate<{ w: number; h: number }>(`(() => { const img = [...document.querySelectorAll('[role="dialog"] img')].find((i) => i.naturalWidth > 0); return { w: img.naturalWidth, h: img.naturalHeight }; })()`);
	await shot("04_查看器打开存储的那一份");
	console.log(`查看器里的图：${viewed.w}x${viewed.h}`);

	// Annotate → 完成: the marked copy goes back to the composer, fitted on the way (`attachToComposer`).
	await ui.click('[role="dialog"] button[aria-label="标注"]');
	await pause(1200);
	await ui.click('[role="dialog"] button[aria-label="完成"]');
	// The composer's own shell, found from its field: the transcript above holds thirteen tiles of its own.
	await ui.until(`document.querySelector("main textarea")?.closest(".ly-composer")?.querySelector("[data-ly-attachment] img")`, 20000);
	await pause(1500);
	const marked = await app.evaluate<{ tiles: number; w: number; h: number; kb: number; mime: string }>(`(async () => {
		const shell = document.querySelector("main textarea")?.closest(".ly-composer");
		const img = shell?.querySelector("[data-ly-attachment] img");
		if (!img) return { tiles: 0, w: 0, h: 0, kb: 0, mime: "" };
		if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
		const src = img.currentSrc || img.src;
		const kb = src.startsWith("data:") ? Math.round((src.length - src.indexOf(",") - 1) * 0.75 / 1024) : -1;
		return { tiles: shell.querySelectorAll("[data-ly-attachment]").length, w: img.naturalWidth, h: img.naturalHeight, kb, mime: src.slice(5, src.indexOf(";")) };
	})()`);
	await shot("05_标注图交回输入框");
	console.log(`标注图回到输入框：${marked.tiles} 格，${marked.w}x${marked.h}，${marked.mime}，${marked.kb} KB`);

	// 2. The model reads a 4K screenshot from the project; the marked copy rides along.
	const pressed2 = await turn("读一下 shots/big-4k.png", 3);
	await pause(800);

	// 3. A 7 MB 4K screenshot pasted, and one more question: what the history costs now.
	const pasteBase64 = (await readFile(join(SAMPLES, "09-web-photo.png"))).toString("base64");
	await app.evaluate(`(() => {
		const bin = atob(${JSON.stringify(pasteBase64)});
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], "粘贴的截图.png", { type: "image/png" }));
		const field = document.querySelector("main textarea");
		field.focus();
		field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
	})()`);
	await ui.until(`document.querySelector("main textarea")?.closest(".ly-composer")?.querySelector("[data-ly-attachment] img")`, 30000);
	await pause(1200);
	await shot("06_粘贴一张七兆的截图");
	const pressed3 = await turn("继续，这张呢", 4);
	await pause(800);
	await shot("07_三轮之后");

	const convo = requests.filter((r) => r.conversation);
	const pressedAt = [pressed1, pressed2, pressed2, pressed3];
	console.log(`\n== ${LABEL}：对话请求 ${convo.length} 个（另有 ${requests.length - convo.length} 个拟标题等辅助请求）`);
	const rows = convo.map((r, i) => {
		const imageBytes = r.images.reduce((sum, img) => sum + img.bytes, 0);
		return {
			request: i + 1,
			body: r.bytes,
			images: r.images.length,
			imageBytes,
			notes: r.notes.length,
			sendMs: r.lastByteAt - (pressedAt[i] ?? r.firstByteAt),
			transferMs: r.lastByteAt - r.firstByteAt,
			at15KBps: Math.round(r.bytes / (15 * 1024)),
			sizes: r.images.map((img) => `${img.where}:${img.mime.replace("image/", "")}:${img.size}:${kb(img.bytes)}`),
		};
	});
	for (const row of rows) {
		console.log(`#${row.request} 请求体 ${mb(row.body)}，图 ${row.images} 张共 ${mb(row.imageBytes)}，说明 ${row.notes} 条；按下到收齐 ${row.sendMs} ms，传输 ${row.transferMs} ms；15 KB/s 下约 ${row.at15KBps} 秒`);
		console.log(`    ${row.sizes.join("  ")}`);
	}
	for (const [i, r] of convo.entries()) {
		const kinds = new Map<string, number>();
		for (const note of r.notes) kinds.set(note.startsWith("unsendable") ? note : note, (kinds.get(note) ?? 0) + 1);
		if (kinds.size) console.log(`    #${i + 1} 说明：${[...kinds].map(([k, n]) => `${k}×${n}`).join("，")}`);
	}
	const media = await dirBytes(join(app.home, "session-media"));
	console.log(`session-media 落盘：${mb(media)}`);
	const largestBody = Math.max(...rows.map((r) => r.body));
	const largestImage = Math.max(0, ...convo.flatMap((r) => r.images.map((img) => img.bytes)));
	await writeFile(
		join(OUT, `${STAMP}_${LABEL}_请求体.json`),
		JSON.stringify({ label: LABEL, throttleKBps: THROTTLE_KBPS, attachMs, attached, bubbleTiles, bubbleImages, viewed, marked, sessionMediaBytes: media, largestBody, largestImage, requests: rows, notes: convo.map((r) => r.notes) }, null, 2),
	);

	check("十三张图都进了输入框", attached >= 12, String(attached));
	check("对话请求有四个（发图、调 read、read 之后、再一句）", convo.length === 4, String(convo.length));
	// Before, the HEIC was a file chip here (nothing could draw it); fitted on the way in, it is a JPEG like the rest.
	check("发出去之后气泡外那一排图都画出来了", bubbleTiles >= 13 && bubbleImages >= (LABEL === "改前" ? 12 : 13), `${bubbleTiles} 格 / ${bubbleImages} 张`);
	check("查看器打开的是存储的那一份，长边不超过 2000", viewed.w > 0 && Math.max(viewed.w, viewed.h) <= 2000, `${viewed.w}x${viewed.h}`);
	check("标注图回到了输入框，长边不超过 2000", marked.tiles >= 1 && Math.max(marked.w, marked.h) <= 2000 && marked.w > 0, JSON.stringify(marked));
	if (LABEL !== "改前") {
		const imageLimit = 3_932_160;
		check("每张发出去的图都不超过 3.75 MiB（base64 5 MiB）", convo.every((r) => r.images.every((img) => img.bytes <= imageLimit)), kb(largestImage));
		check("每张发出去的图长边都不超过 2000", convo.every((r) => r.images.every((img) => img.size !== "?" && Math.max(...img.size.split("x").map(Number)) <= 2000)), convo.flatMap((r) => r.images.map((i) => i.size)).join(","));
		check("HEIC 被转成模型认得的格式发出去，不再是一句 unsupported", convo[0].images.length === 13 && !convo[0].notes.some((n) => n.startsWith("unsendable")), `${convo[0].images.length} 张，${convo[0].notes.join("|")}`);
		check("第一轮请求体小于 6 MB（改前 24.23 MB）", rows[0].body < 6 * 1024 * 1024, mb(rows[0].body));
		check("后几轮旧图降级：有缩略图说明", convo.slice(1).some((r) => r.notes.includes("gist")), convo.map((r) => r.notes.join("|")).join(" ; "));
		check("最后一轮请求体小于 6 MB（改前 25.67 MB）", rows[rows.length - 1].body < 6 * 1024 * 1024, mb(rows[rows.length - 1].body));
		check("read 读进来的 4K 截图带了坐标换算说明", convo[2].notes.includes("scaled"), convo[2].notes.join("|"));
		check("session-media 落盘小于 8 MB（改前 19.27 MB）", media < 8 * 1024 * 1024, mb(media));
	}
} catch (error) {
	failed = true;
	console.error(error);
	await shot("失败现场").catch(() => {});
} finally {
	recorder.on = false;
	await film;
	const passed = checks.filter((c) => c.ok).length;
	await encode(frames, join(OUT, `${STAMP}_${LABEL}_发送十三张大图_${passed}of${checks.length}.mp4`), 10).catch((e) => console.error("encode", e));
	grab.close();
	await app.stop();
	model.close();
	console.log(`\n${failed ? "中途失败" : "完成"}：${passed}/${checks.length}`);
	process.exitCode = failed || passed < checks.length ? 1 : 0;
}
