/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 拉取模型的弹窗，在真窗口里从头到尾走一遍：取消勾选就是移除、敲名字就能加、加完能直接测生图。
 *
 * 一个本地假接口顶替中转：`/v1/models` 列出四个 gemini-3.8-flash 和一个生图模型（就是 relay 放开
 * 权限之后的样子），`/v1/images/generations` 画一张真的 PNG 回来。供应商里预先配好四个 flash 和一个
 * 接口已经不再列出的旧模型，于是「未列出」「将移除」「手动添加」「全都加过了」每一种都是真状态。
 *
 * 用法：先在 packages/desktop 跑 `pnpm build`，再
 * `node --experimental-strip-types e2e/fetch-models-demo.ts [输出目录]`
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra拉取模型测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9871;
const FLASH = ["gemini-3.8-flash-high", "gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-tiered"];
const IMAGE = "gemini-3.1-flash-image";
const STALE = "gemini-3.7-flash-high";
const TYPED = "nano-banana-pro";

const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

/** A real PNG, so the test draw decodes a picture rather than trusting a byte count. */
function png(width: number, height: number): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // truecolour
	const rows: Buffer[] = [];
	for (let y = 0; y < height; y++) {
		const row = Buffer.alloc(1 + width * 3);
		for (let x = 0; x < width; x++) {
			const inside = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (width / 4) ** 2;
			row[1 + x * 3] = inside ? 245 : Math.round(60 + (140 * x) / width);
			row[2 + x * 3] = inside ? 158 : Math.round(90 + (100 * y) / height);
			row[3 + x * 3] = inside ? 66 : 200;
		}
		rows.push(row);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.concat(rows))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const drawn: string[] = [];
const endpoint = createServer((req, res) => {
	let body = "";
	req.on("data", (part: Buffer) => (body += part.toString()));
	req.on("end", () => {
		if (req.url?.endsWith("/v1/models")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ data: [...FLASH, IMAGE].map((id) => ({ id })) }));
			return;
		}
		if (req.url?.endsWith("/v1/images/generations")) {
			drawn.push((JSON.parse(body) as { model: string }).model);
			// Long enough that the row's spinner is on screen in the recording.
			setTimeout(() => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ data: [{ b64_json: png(512, 512).toString("base64") }] }));
			}, 1500);
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message: "not here" } }));
	});
});
await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}`;

const model = (modelId: string) => ({
	id: `relay/${modelId}`,
	providerId: "relay",
	modelId,
	name: modelId,
	contextWindow: 200_000,
	maxOutputTokens: 65_536,
	supportsThinking: true,
	supportsImages: true,
	supportsTools: true,
	metadataSource: "manual",
});

function seeder(theme: "light" | "dark") {
	return async (home: string) => {
		const project = join(home, "proj");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "README.md"), "# proj\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				appearance: { theme },
				providers: [{ id: "relay", name: "新供应商", api: "openai-responses", baseUrl: base, apiKey: "sk-test", enabled: true, models: [...FLASH, STALE].map(model) }],
				mcpServers: [],
				projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: `relay/${FLASH[0]}`,
				permissionMode: "auto",
				thinking: "off",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
			}),
		);
	};
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

async function until(expression: string, ms = 20_000) {
	for (let i = 0; i < ms / 100; i++) {
		if (await app!.evaluate(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}
/** Real mouse, after asking where it would land: a dialog row under the scrim answers "covered". */
async function clickAt(expression: string, label = expression) {
	await until(expression);
	const at = await app!.evaluate<{ x: number; y: number }>(`(() => {
		const el = ${expression};
		el.scrollIntoView({ block: "nearest", behavior: "instant" });
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		${landsOn(label)}
		return { x, y };
	})()`);
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app!.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
}
async function key(name: string, code: number, text?: string) {
	await app!.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
	await app!.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
}
/** One character at a time, so the recording shows typing rather than a value appearing. */
async function typeSlowly(text: string) {
	for (const char of text) {
		await app!.send("Input.insertText", { text: char });
		await pause(45);
	}
}
async function hold(ms = 1000) {
	await pause(ms);
}
async function shot(name: string) {
	const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_${name}.png`), Buffer.from(picture.data, "base64"));
}
const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
const byText = (selector: string, text: string) =>
	`[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.textContent || "").trim() === ${JSON.stringify(text)})`;
const row = (id: string) => q(`[data-ly-fetch-row="${id}"]`);

/** What the dialog says right now, read off what is drawn. */
function dialogState() {
	return app!.evaluate<{
		configured: string[];
		available: string[];
		states: Record<string, string>;
		tags: Record<string, string>;
		images: string[];
		summary: string;
		apply: { text: string; disabled: boolean; danger: boolean };
		add: string | null;
		empty: string | null;
	}>(`(() => {
		const rows = [...document.querySelectorAll("[data-ly-fetch-row]")];
		const ids = (group) => [...document.querySelectorAll('[data-ly-fetch-group="' + group + '"] [data-ly-fetch-row]')].map((el) => el.dataset.lyFetchRow);
		const apply = document.querySelector("[data-ly-fetch-apply]");
		return {
			configured: ids("configured"),
			available: ids("available"),
			states: Object.fromEntries(rows.map((el) => [el.dataset.lyFetchRow, el.dataset.lyFetchState])),
			tags: Object.fromEntries(rows.map((el) => [el.dataset.lyFetchRow, [...el.querySelectorAll("span.rounded")].map((t) => t.textContent.trim()).filter(Boolean).join(",")])),
			images: rows.filter((el) => el.querySelector("[aria-label='生图模型']")).map((el) => el.dataset.lyFetchRow),
			summary: document.querySelector("[data-ly-fetch-summary]")?.textContent.trim() ?? "",
			apply: { text: apply?.textContent.trim() ?? "", disabled: Boolean(apply?.disabled), danger: Boolean(apply?.className.includes("danger")) },
			add: document.querySelector("[data-ly-fetch-add]")?.textContent.trim() ?? null,
			empty: document.querySelector("[data-ly-fetch-empty]")?.textContent.trim() ?? null,
		};
	})()`);
}

async function openModels() {
	await clickAt(q("[data-ly-open-settings]"), "设置");
	await until(`Boolean(document.querySelector("nav button"))`);
	await pause(400);
	await clickAt(byText("nav button", "模型设置"), "模型设置");
	await until(q("[data-ly-model-list]"));
	await pause(600);
}
const fetchButton = `[...document.querySelectorAll("main button")].find((b) => (b.textContent || "").trim() === "拉取模型")`;

await mkdir(out, { recursive: true });
try {
	app = await startApp({ port: PORT, seed: seeder("light") });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");
	await openModels();
	await hold(900);
	await shot("01_拉取前的模型列表");

	// 1. 打开：已有的五个在上面（旧模型标「未列出」），接口新列出的生图模型在下面、默认勾上。
	await clickAt(fetchButton, "拉取模型");
	await until(q("[data-ly-fetch-row]"));
	await hold(1200);
	const opened = await dialogState();
	check(
		"打开：已有五个全勾着，接口不再列出的旧模型标「未列出」，新列出的生图模型在「可添加」里默认勾上并带生图标记",
		opened.configured.length === 5 && opened.configured.every((id) => opened.states[id] === "keep") && opened.tags[STALE] === "未列出" &&
			opened.available.join() === IMAGE && opened.states[IMAGE] === "add" && opened.images.includes(IMAGE) &&
			opened.apply.text === "添加 1 个" && !opened.apply.disabled,
		opened,
	);
	await shot("02_打开弹窗_生图模型默认勾上");

	// 2. 取消勾选旧模型：这一按就是移除——行上写「将移除」，按钮变成「应用 2 项更改」。
	await clickAt(`${row(STALE)}.querySelector('[role="checkbox"]')`, STALE);
	await hold(1000);
	const removing = await dialogState();
	check(
		"取消勾选已有的旧模型：行上写「将移除」，页脚「新增 1 个 · 移除 1 个」，按钮「应用 2 项更改」",
		removing.states[STALE] === "remove" && removing.tags[STALE] === "将移除" && /新增 1 个.*移除 1 个/.test(removing.summary) && removing.apply.text === "应用 2 项更改",
		{ state: removing.states[STALE], tag: removing.tags[STALE], summary: removing.summary, apply: removing.apply.text },
	);
	await shot("03_取消勾选就是移除");

	// 3. 接口没列出的名字：敲进搜索框，回车就加进来，带「手动添加」。
	await clickAt(q("[data-ly-modal] input"), "搜索框");
	await typeSlowly(TYPED);
	await until(q("[data-ly-fetch-add]"));
	await hold(900);
	const offered = await dialogState();
	await shot("04_敲一个没列出的名字");
	await key("Enter", 13, "\r");
	await until(`${row(TYPED)}?.dataset.lyFetchState === "add"`);
	await hold(1000);
	const typed = await dialogState();
	check(
		"敲一个接口没列出的名字：先给出「添加」，回车后成为勾着的一行，标「手动添加」，名字认得出是生图模型",
		offered.add?.includes(TYPED) === true && typed.states[TYPED] === "add" && typed.tags[TYPED] === "手动添加" && typed.images.includes(TYPED) && typed.add === null,
		{ offered: offered.add, state: typed.states[TYPED], tag: typed.tags[TYPED], image: typed.images.includes(TYPED) },
	);
	await shot("05_回车加进来");

	// 4. 按厂商搜：google 只剩 gemini；Escape 先清空搜索，不关弹窗。
	for (let i = 0; i < TYPED.length; i++) await key("Backspace", 8);
	await typeSlowly("google");
	await hold(900);
	const vendor = await dialogState();
	check(
		"搜「google」找得到 gemini、找不到 nano-banana",
		[...vendor.configured, ...vendor.available].length === 6 && ![...vendor.configured, ...vendor.available].includes(TYPED),
		[...vendor.configured, ...vendor.available],
	);
	await shot("06_按厂商搜索");
	await key("Escape", 27);
	await hold(700);
	const cleared = await dialogState();
	check("Escape 先清空搜索、弹窗还在", cleared.configured.length === 5 && cleared.available.length === 2, { configured: cleared.configured.length, available: cleared.available });
	check(
		"应用之前：新增 2 个、移除 1 个，按钮「应用 3 项更改」",
		/新增 2 个.*移除 1 个/.test(cleared.summary) && cleared.apply.text === "应用 3 项更改",
		{ summary: cleared.summary, apply: cleared.apply.text },
	);
	await shot("07_应用之前");

	// 5. 应用：一次保存，列表里多了两个、少了一个；默认模型不动。
	await clickAt(q("[data-ly-fetch-apply]"), "应用");
	await until(`!document.querySelector("[data-ly-fetch-row]")`);
	await until(`document.querySelector('[data-ly-model-row="${IMAGE}"]')`);
	await hold(1200);
	const listed = await app.evaluate<string[]>(`[...document.querySelectorAll("[data-ly-model-row]")].map((el) => el.dataset.lyModelRow)`);
	const saved = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")) as {
		providers: { models: { modelId: string; supportsTools: boolean; supportsThinking: boolean }[] }[];
		defaultModelId: string | null;
		imageModelId?: string | null;
	};
	const stored = saved.providers[0].models.map((one) => one.modelId);
	const image = saved.providers[0].models.find((one) => one.modelId === IMAGE);
	check(
		"应用后：列表和 settings.json 都是「四个 flash + 生图 + 手动加的」，旧模型没了，默认对话模型没被改",
		listed.join() === [...FLASH, TYPED, IMAGE].join() && stored.join() === listed.join() && saved.defaultModelId === `relay/${FLASH[0]}` && image?.supportsTools === false && image?.supportsThinking === false,
		{ listed, stored, defaultModelId: saved.defaultModelId, imageCaps: image && { tools: image.supportsTools, thinking: image.supportsThinking } },
	);
	await shot("08_应用之后的模型列表");

	// 6. 生图模型直接测：▶ 真发一次 /v1/images/generations，回来的是一张能解码的图。
	await app.evaluate(`document.querySelector('[data-ly-model-row="${IMAGE}"]').scrollIntoView({ block: "center" })`);
	await clickAt(`document.querySelector('[data-ly-model-row="${IMAGE}"]').closest(".group\\\\/row").querySelector('button[aria-label="试画一张"], button[aria-label*="画"]')`, "测生图");
	await until(`[...document.querySelector('[data-ly-model-row="${IMAGE}"]').closest(".group\\\\/row").querySelectorAll("[data-ly-tip]")].some((el) => /512×512/.test(el.dataset.lyTip))`, 30_000);
	await hold(1200);
	const verdict = await app.evaluate<string>(`[...document.querySelector('[data-ly-model-row="${IMAGE}"]').closest(".group\\\\/row").querySelectorAll("[data-ly-tip]")].map((el) => el.dataset.lyTip).find((tip) => /512/.test(tip)) ?? ""`);
	check("测生图：真的请求了生图接口，回来一张 512×512 的图", drawn.includes(IMAGE) && /512×512/.test(verdict), { drawn, verdict });
	await shot("09_测生图通过");

	// 7. 再拉一次：全都加过了——没有改动、按钮灰着，下面一句话告诉人去哪儿加没列出的。
	await clickAt(fetchButton, "拉取模型");
	await until(q("[data-ly-fetch-row]"));
	await hold(1100);
	const again = await dialogState();
	check(
		"再拉一次：列出的都在、没有改动、按钮灰着，提示去搜索框加（不再是只能点取消的死胡同）",
		again.available.length === 0 && again.apply.disabled && again.summary === "没有改动" && (again.empty ?? "").includes("在上面输入名字") && again.tags[TYPED] === "未列出",
		{ available: again.available, apply: again.apply, summary: again.summary, empty: again.empty, typedTag: again.tags[TYPED] },
	);
	await shot("10_再拉一次_全都已添加");
	await key("Escape", 27);
	await until(`!document.querySelector("[data-ly-fetch-row]")`);
	await hold(600);
	await stopRecording();
	stopRecording = undefined;
	await app.stop();
	app = undefined;

	// 8. 深色：只拍打开弹窗那一张。
	app = await startApp({ port: PORT, seed: seeder("dark") });
	await app.evaluate("document.fonts.ready");
	await openModels();
	await clickAt(fetchButton, "拉取模型");
	await until(q("[data-ly-fetch-row]"));
	await clickAt(`${row(STALE)}.querySelector('[role="checkbox"]')`, STALE);
	await pause(900);
	await shot("11_深色_弹窗");
} catch (error) {
	console.error(error instanceof Error ? error.stack : error);
	checks.push({ name: "脚本跑完", ok: false, measured: String(error) });
} finally {
	await stopRecording?.().catch(() => {});
	await app?.stop().catch(() => {});
	endpoint.close();
}

const passed = checks.filter((one) => one.ok).length;
if (frames.length > 0) {
	const video = join(out, `${stamp}_拉取模型弹窗_${passed}of${checks.length}.mp4`);
	await encode(frames, video, 30, 2500);
	console.log(`video: ${video}`);
}
console.log(`\n${passed}/${checks.length} passed · ${out}`);
process.exitCode = passed === checks.length ? 0 : 1;
