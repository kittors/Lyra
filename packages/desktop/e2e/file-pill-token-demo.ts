/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 量两件用户看得见的事：文件链接图标是否在胶囊里面，输入框附件标记左右是否对称。
 *
 * 造一份现成会话再起窗口，不调模型。附件用拖进输入框的真 PNG，走的是同一条 drop。
 *
 * 用法：node --experimental-strip-types e2e/file-pill-token-demo.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9488;
const SESSION = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const LONG = "docs/issue/2026-09-16-2220-01-tasklist-false-paused-on-unfinished-plan.md";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(join(cwd, "docs/issue"), { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");
	await writeFile(join(cwd, LONG), "# issue\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	const now = Date.now();
	const meta = {
		id: SESSION,
		title: "文件胶囊与附件标记",
		cwd,
		projectId,
		projectName: "演示工程",
		createdAt: now,
		updatedAt: now,
		modelId: "qa/qa",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 0,
	};
	const tick = String.fromCharCode(96);
	const reply = [
		`📄 **Issue 文档**：[${tick}${LONG}${tick}](${LONG}:1)`,
		"",
		"短路径：[README.md](README.md)",
		"",
		"后面再跟一行普通文字，用来比对基线。",
	].join("\n");
	const lines = [
		{ seq: 1, ts: now, type: "meta", meta },
		{ seq: 2, ts: now, type: "message", message: { role: "user", content: [{ type: "text", text: "给出文件链接" }], timestamp: now } },
		{
			seq: 3,
			ts: now,
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "text", text: reply }],
				api: "openai-responses",
				provider: "qa",
				model: "qa",
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, total: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: now,
			},
		},
		{ seq: 4, ts: now, type: "meta", meta: { ...meta, messageCount: 2 } },
	];
	await writeFile(join(dir, `${SESSION}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

	const real = JSON.parse(await readFile(join(homedir(), ".lyra", "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: now }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820, x: 80, y: 60 }));
}

const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

let app: RunningApp;

async function main() {
	const outDir = join(homedir(), "Desktop", "Lyra文件胶囊与附件标记测试");
	await mkdir(outDir, { recursive: true });
	const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const stop = await startRecording(PORT, frames);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);
		await app.evaluate(`document.querySelector(".group\\\\/session")?.setAttribute("data-probe","")`);
		const session = await app.evaluate<{ x: number; y: number } | null>(
			`(()=>{const el=document.querySelector("[data-probe]");if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		if (session) {
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", {
					type,
					...session,
					...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
				});
			}
		}
		await pause(1600);

		const found = await app.evaluate<number>(`document.querySelectorAll("[data-ly-file-link]").length`);
		check("seeded reply rendered file links", found >= 2, { found });
		if (found === 0) {
			console.log(await app.evaluate<string>(`document.body.innerText.slice(0, 500)`));
		}

		const pills = await app.evaluate<Array<{
			label: string;
			iconInside: boolean;
			codeTransparent: boolean;
			chipPainted: boolean;
			actionsDocked: boolean;
			iconMid: number;
			labelMid: number;
			width: number;
			height: number;
			parentWidth: number;
			cap: number;
			ellipsis: boolean;
		}>>(`(() => {
			const transparent = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
			return [...document.querySelectorAll("[data-ly-file-link]")].map((wrap) => {
				const link = wrap.querySelector("a");
				const icon = link?.querySelector("svg");
				const code = wrap.querySelector("code");
				const actions = wrap.querySelector("[data-ly-file-actions]");
				const name = wrap.querySelector("[data-ly-file-name]");
				const wrapBox = wrap.getBoundingClientRect();
				const iconBox = icon?.getBoundingClientRect();
				const actionBox = actions?.getBoundingClientRect();
				const parent = wrap.closest("p") ?? wrap.parentElement;
				const parentBox = parent?.getBoundingClientRect();
				const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
				let textNode = null;
				let node;
				while ((node = walker.nextNode())) {
					if (node.parentElement?.closest("svg")) continue;
					if (node.textContent.trim()) { textNode = node; break; }
				}
				let labelBox = null;
				if (textNode) {
					const range = document.createRange();
					range.selectNodeContents(textNode);
					labelBox = range.getBoundingClientRect();
				}
				const pad = 0.75;
				const cap = 20 * Number.parseFloat(getComputedStyle(wrap).fontSize);
				return {
					label: (link?.innerText ?? "").trim(),
					iconInside: Boolean(iconBox && iconBox.left >= wrapBox.left - pad && iconBox.right <= wrapBox.right + pad && iconBox.top >= wrapBox.top - pad && iconBox.bottom <= wrapBox.bottom + pad),
					codeTransparent: !code || transparent(getComputedStyle(code).backgroundColor),
					chipPainted: !transparent(getComputedStyle(wrap).backgroundColor),
					actionsDocked: !actionBox || (actionBox.left >= wrapBox.left - pad && actionBox.right <= wrapBox.right + pad),
					iconMid: iconBox ? +(iconBox.top + iconBox.height / 2).toFixed(2) : -1,
					labelMid: labelBox ? +(labelBox.top + labelBox.height / 2).toFixed(2) : -1,
					width: +wrapBox.width.toFixed(2),
					height: +wrapBox.height.toFixed(2),
					parentWidth: parentBox ? +parentBox.width.toFixed(2) : -1,
					cap: +cap.toFixed(2),
					ellipsis: Boolean(name && name.scrollWidth - name.clientWidth > 1),
				};
			});
		})()`);

		console.log("文件胶囊：", JSON.stringify(pills, null, 2));
		for (const pill of pills) {
			check(`file pill icon sits inside chip (${pill.label.slice(0, 24)})`, pill.iconInside && pill.chipPainted && pill.codeTransparent, pill);
			check(`hover actions stay inside the chip box (${pill.label.slice(0, 24)})`, pill.actionsDocked, pill);
			check(`file pill icon aligns with label (${pill.label.slice(0, 24)})`, Math.abs(pill.iconMid - pill.labelMid) < 1.2, { delta: +(pill.iconMid - pill.labelMid).toFixed(2) });
		}
		const longPill = pills.find((pill) => pill.label.includes("unfinished-plan"));
		const shortPill = pills.find((pill) => pill.label === "README.md");
		if (longPill) {
			check("long file pill stays one filename under the shared max width", !longPill.label.includes("/") && longPill.width <= longPill.cap + 0.6, { label: longPill.label, width: longPill.width, cap: longPill.cap });
			check("long file name ellipsizes instead of wrapping", longPill.ellipsis, { ellipsis: longPill.ellipsis, width: longPill.width });
		}
		if (longPill && shortPill) {
			check("long and short file pills share one line height", Math.abs(longPill.height - shortPill.height) <= 1, { long: longPill.height, short: shortPill.height });
		}

		const hoverTarget = await app.evaluate<{ x: number; y: number } | null>(
			`(()=>{const wrap=document.querySelector("[data-ly-file-link]");if(!wrap)return null;wrap.scrollIntoView({block:"center",behavior:"instant"});const r=wrap.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		const restWidth = pills[0]?.width ?? 0;
		if (hoverTarget) {
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverTarget });
			await pause(900);
			const hoverWidth = await app.evaluate<number>(`document.querySelector("[data-ly-file-link]")?.getBoundingClientRect().width ?? -1`);
			check("hover actions do not widen the chip", Math.abs(hoverWidth - restWidth) <= 0.6, { restWidth, hoverWidth });
		}

		const narrow = await app.evaluate<{ width: number; height: number; ellipsis: boolean } | null>(`(() => {
			const wrap = document.querySelector("[data-ly-file-link]");
			const name = wrap?.querySelector("[data-ly-file-name]");
			const parent = wrap?.closest("p");
			if (!wrap || !name || !parent) return null;
			parent.style.maxWidth = "220px";
			const box = wrap.getBoundingClientRect();
			return {
				width: +box.width.toFixed(2),
				height: +box.height.toFixed(2),
				ellipsis: name.scrollWidth - name.clientWidth > 1,
			};
		})()`);
		console.log("窄栏：", JSON.stringify(narrow));
		if (narrow) {
			check("narrow column keeps a single-line ellipsized chip", narrow.height <= 20 && narrow.ellipsis && narrow.width <= 220.6, narrow);
		}

		await app.evaluate(`(async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 48;
			canvas.height = 48;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#7c3aed";
			ctx.fillRect(0, 0, 48, 48);
			const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
			const input = document.querySelector("main input[type=file]");
			const dt = new DataTransfer();
			dt.items.add(new File([blob], "截屏.png", { type: "image/png" }));
			input.files = dt.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		})()`);
		for (let i = 0; i < 40; i++) {
			if (await app.evaluate<boolean>(`Boolean(document.querySelector("main .ly-composer .ly-attachment-token"))`)) break;
			await pause(100);
		}
		await pause(400);
		await app.evaluate(`(() => {
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, field.value + " 这个显示我总感觉很难看哎");
			field.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await pause(800);

		const token = await app.evaluate<{
			present: boolean;
			leftPad: number;
			rightPad: number;
			delta: number;
			bracketEm: number;
			mirrorHeight: number;
			fieldHeight: number;
		} | null>(`(() => {
			const field = document.querySelector("main textarea");
			const mirror = document.querySelector("main .ly-composer [data-command-mirror]");
			const token = document.querySelector("main .ly-composer .ly-attachment-token");
			const paint = token?.querySelector(".ly-token-paint");
			const first = paint?.querySelector(".ly-token-bracket");
			if (!field || !mirror || !token || !paint || !first) return null;
			const paintBox = paint.getBoundingClientRect();
			const icon = getComputedStyle(first, "::before");
			const iconLeft = first.getBoundingClientRect().left + Number.parseFloat(icon.left || "0");
			const walker = document.createTreeWalker(paint, NodeFilter.SHOW_TEXT);
			let textNode = null;
			let node;
			while ((node = walker.nextNode())) {
				if (node.parentElement?.closest(".ly-token-bracket")) continue;
				if (node.textContent.trim()) { textNode = node; break; }
			}
			if (!textNode) return null;
			const range = document.createRange();
			range.selectNodeContents(textNode);
			const textBox = range.getBoundingClientRect();
			const leftPad = +(iconLeft - paintBox.left).toFixed(2);
			const rightPad = +(paintBox.right - textBox.right).toFixed(2);
			const size = Number.parseFloat(getComputedStyle(mirror).fontSize);
			return {
				present: true,
				leftPad,
				rightPad,
				delta: +Math.abs(leftPad - rightPad).toFixed(2),
				bracketEm: +((first.getBoundingClientRect().width / size)).toFixed(2),
				mirrorHeight: Math.round(mirror.getBoundingClientRect().height),
				fieldHeight: field.scrollHeight,
			};
		})()`);

		console.log("附件标记：", JSON.stringify(token, null, 2));
		check("composer attachment token is painted", Boolean(token?.present), token);
		if (token) {
			check("composer token left and right pads match", token.delta <= 1.5, { leftPad: token.leftPad, rightPad: token.rightPad, delta: token.delta });
			check("opening bracket still occupies one em", Math.abs(token.bracketEm - 1) <= 0.08, { bracketEm: token.bracketEm });
			check("mirror and textarea stay the same height", Math.abs(token.mirrorHeight - token.fieldHeight) <= 1, { mirrorHeight: token.mirrorHeight, fieldHeight: token.fieldHeight });
		}

		const composer = await app.evaluate<{ x: number; y: number }>(
			`(()=>{const r=document.querySelector("main .ly-composer").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+40};})()`,
		);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...composer });
		await pause(1200);
	} catch (error) {
		check("verification script completed", false, String(error));
		throw error;
	} finally {
		await stop();
		await app.stop();
		const pass = checks.filter((item) => item.ok).length;
		const name = `${stamp}_文件胶囊与附件标记_${pass}of${checks.length}`;
		await writeFile(join(outDir, `${name}.json`), JSON.stringify({ checks }, null, 2));
		if (frames.length) await encode(frames, join(outDir, `${name}.mp4`), 60);
		console.log(`Evidence: ${join(outDir, name)} (${frames.length} frames)`);
		if (checks.some((item) => !item.ok)) process.exitCode = 1;
	}
}

await main();
