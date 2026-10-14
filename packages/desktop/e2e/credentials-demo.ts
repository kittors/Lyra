/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * Credentials in a running app: the card, a command that uses the value, the vault page, a reference
 * pasted into a message, and the copy that the main process clears.
 *
 * The model is a fake that records every request it is sent, so "the model never saw it" is checked
 * against what actually reached it, and the profile is searched byte by byte afterwards.
 *
 * Uses the system clipboard; the text that was on it is put back at the end.
 *
 * `pnpm --filter @lyra/desktop build`, then
 * `node --experimental-strip-types packages/desktop/e2e/credentials-demo.ts`
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra安全凭据测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9871;
const ROOT_PASSWORD = "Tr0ub4dor&3-nas";
const ADMIN_PASSWORD = "c0rrect-h0rse-battery";
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

type Block = { type: string; text?: string; tool_use_id?: string; content?: unknown };
type Message = { role: string; content: string | Block[] };

/** Every request body the model was sent, as text: what "the model saw" means. */
const bodies: string[] = [];

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((block: Block) => (typeof block.text === "string" ? block.text : textOf(block.content))).join("\n");
	return "";
}

function fakeModel() {
	return createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			bodies.push(raw);
			const body = JSON.parse(raw) as { messages: Message[]; tools?: unknown[] };
			res.writeHead(200, { "content-type": "text/event-stream" });
			// A request without tools is the title summariser, not the conversation.
			if (!body.tools?.length) return reply(res, { text: "凭据演示" });
			/*
			 * Routed on whichever came last: a tool's result or the person's words. Not on the last
			 * message alone — the app may put more after what the person said.
			 */
			const resultAt = body.messages.findLastIndex((message) => Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result"));
			// The person's words only: a tool's result quotes references too.
			const saidAt = body.messages.findLastIndex(
				(message) => message.role === "user" && !(Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result")) && /LOGIN_NAS|\[credential:nas-admin\]/.test(textOf(message.content)),
			);
			const results = resultAt >= 0 && Array.isArray(body.messages[resultAt]!.content) ? (body.messages[resultAt]!.content as Block[]) : [];
			const result = resultAt > saidAt ? results.find((block) => block.type === "tool_result") : undefined;
			if (result?.tool_use_id === "cred-1") {
				return reply(res, {
					tool: { id: "bash-1", name: "bash", input: { command: `printf 'env: %s\\n' "$NAS_ROOT"; printf 'askpass: '; "$SSH_ASKPASS" "root@127.0.0.1's password: "`, description: "用 nas-root 跑一次", credentials: ["nas-root"] } },
				});
			}
			if (result?.tool_use_id === "bash-1" || result?.tool_use_id === "bash-2") {
				return reply(res, { text: `命令跑完了。我拿到的输出是：\n\n\`\`\`\n${textOf(result.content).trim()}\n\`\`\`` });
			}
			const said = saidAt > resultAt ? textOf(body.messages[saidAt]!.content) : "";
			if (said.includes("LOGIN_NAS")) {
				return reply(res, {
					tool: { id: "cred-1", name: "request_credential", input: { name: "nas-root", title: "NAS 的 root 密码", purpose: "登录 NAS，看一眼磁盘还剩多少", kind: "password", target: "ssh://root@127.0.0.1" } },
				});
			}
			if (said.includes("[credential:nas-admin]")) {
				return reply(res, {
					tool: { id: "bash-2", name: "bash", input: { command: `printf 'user: %s\\n' "$NAS_ADMIN_USERNAME"; printf 'askpass: '; "$SSH_ASKPASS" "admin@nas.local's password: "`, description: "用 nas-admin 跑一次", credentials: ["nas-admin"] } },
				});
			}
			reply(res, { text: "好的。" });
		});
	});
}

function reply(res: ServerResponse, step: { text?: string; tool?: { id: string; name: string; input: object } }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `m-${bodies.length}`, role: "assistant", content: [], usage: { input_tokens: 80, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: step.tool ? { type: "tool_use", id: step.tool.id, name: step.tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: step.tool ? { type: "input_json_delta", partial_json: JSON.stringify(step.tool.input) } : { type: "text_delta", text: step.text ?? "" } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: step.tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 16 } });
	emit("message_stop", {});
	res.end();
}

async function seed(home: string, modelPort: number): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# nas\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = { id: "cred-demo", title: "凭据演示", cwd, projectId, projectName: "NAS", createdAt: 1, updatedAt: 2, modelId: "qa/model", messageCount: 2, usage, seq: 3 };
	await writeFile(
		join(home, "sessions", projectId, "cred-demo.jsonl"),
		[
			JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
			JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "我家里有台 NAS。" }], timestamp: 1 }, seq: 1, ts: 1 }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "好，需要登录的时候我会问你要密码。" }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: 2 }, seq: 2, ts: 2 }),
			JSON.stringify({ type: "meta", meta, seq: 3, ts: 3 }),
		].join("\n") + "\n",
	);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [
				{
					id: "qa",
					name: "隔离测试模型",
					api: "anthropic-messages",
					baseUrl: `http://127.0.0.1:${modelPort}`,
					apiKey: "test",
					enabled: true,
					models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }],
				},
			],
			defaultModelId: "qa/model",
			mcpServers: [],
			hooks: [],
			permissionMode: "full",
			thinking: "off",
			projectMemory: false,
			appearance: { theme: "light", reduceMotion: "off" },
			projects: [{ id: projectId, path: cwd, name: "NAS", pinned: true, lastOpenedAt: 1 }],
			sync: { enabled: false },
		}),
	);
}

/** Every file in the profile that holds one of `values`, by path. Nothing is printed but the path. */
async function filesHolding(root: string, values: string[]): Promise<string[]> {
	const hits: string[] = [];
	const needles = values.map((value) => Buffer.from(value));
	async function walk(dir: string) {
		for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && (await stat(path)).size < 64 * 1024 * 1024) {
				const bytes = await readFile(path).catch(() => Buffer.alloc(0));
				if (needles.some((needle) => bytes.includes(needle))) hits.push(relative(root, path));
			}
		}
	}
	await walk(root);
	return hits;
}

const clipboardText = () => execFileSync("pbpaste", { encoding: "utf8" });
const userClipboard = clipboardText();

const server = fakeModel();
let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const shots: { name: string; data: Buffer }[] = [];

try {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	app = await startApp({ port: PORT, seed: (home) => seed(home, address.port) });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");
	const running = app;

	async function until(expression: string, ms = 30_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await running.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await running.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function shot(name: string) {
		const picture = await running.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		shots.push({ name, data: Buffer.from(picture.data, "base64") });
	}
	/** A real pointer: moved there, the landing checked, then pressed. */
	async function click(selector: string) {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
		await running.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await running.evaluate<{ x: number; y: number; lands: boolean }>(
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,lands:Boolean(hit&&(el===hit||el.contains(hit)))};})()`,
		);
		if (!at.lands) throw new Error(`the pointer would not land on ${selector}`);
		await running.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
		await pause(120);
		for (const type of ["mousePressed", "mouseReleased"]) await running.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	async function typeText(text: string) {
		for (const char of text) {
			await running.send("Input.insertText", { text: char });
			await pause(35);
		}
	}
	async function key(name: string, code: number, extra: Record<string, unknown> = {}) {
		await running.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name === "Enter" ? "Enter" : `Key${name.toUpperCase()}`, windowsVirtualKeyCode: code, ...extra });
		await running.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name === "Enter" ? "Enter" : `Key${name.toUpperCase()}`, windowsVirtualKeyCode: code, ...extra });
	}
	const screenText = () => running.evaluate<string>("document.body.innerText");

	// ── 1. The card ────────────────────────────────────────────────────────────
	await click('[data-ly-row="cred-demo"] > button');
	await hold(700);
	await click("main textarea");
	await typeText("LOGIN_NAS 帮我看看 NAS 的磁盘还剩多少");
	await hold(400);
	await key("Enter", 13, { text: "\r" });
	await until("document.querySelector('[data-ly-credential-card]')");
	await hold(1200);
	await shot("01_凭据卡片");
	const card = await running.evaluate<{ title: string; purpose: string; fact: string; focused: boolean; always: boolean }>(`(()=>{
		const card=document.querySelector('[data-approval-card]');
		return {
			title:card.querySelector('[data-approval-title]')?.textContent||'',
			purpose:card.querySelector('[data-ly-credential-purpose]')?.textContent||'',
			fact:card.querySelector('[data-ly-credential-fact]')?.textContent||'',
			focused:document.activeElement===card.querySelector('input[data-ly-secret-input]'),
			always:[...card.querySelectorAll('button')].some(b=>/不再/.test(b.textContent||'')),
		};
	})()`);
	check("card shows the model's purpose apart from the enforced target", card.title === "NAS 的 root 密码" && card.purpose === "登录 NAS，看一眼磁盘还剩多少" && card.fact.includes("ssh://root@127.0.0.1"), card);
	check("the password box has the focus and there is no 'never ask'", card.focused && !card.always, card);
	await typeText(ROOT_PASSWORD);
	await hold(600);
	const dots = await running.evaluate<string>(`document.querySelector('input[data-ly-secret-input]').type`);
	check("what is typed shows as dots", dots === "password", dots);
	await click("[data-ly-credential-remember]");
	await hold(600);
	await click("[data-ly-credential-submit]");
	await until("!document.querySelector('[data-ly-credential-card]')");
	await until(`[...document.querySelectorAll('main')].some(m=>m.textContent.includes('我拿到的输出是'))`, 60_000);
	await hold(1500);
	await shot("02_命令输出里只有引用");
	const first = await screenText();
	check("the command's output reached the model as references", first.includes("env: [credential:nas-root]") && first.includes("askpass: [credential:nas-root]"), first.slice(first.indexOf("我拿到的输出是"), first.indexOf("我拿到的输出是") + 120));
	check("the password is nowhere on screen", !first.includes(ROOT_PASSWORD), null);

	// ── 2. The vault ──────────────────────────────────────────────────────────
	await click('[data-ly-rail-item="vault"]');
	await until("document.querySelector('[data-ly-vault-row=\"nas-root\"]')");
	await hold(1200);
	// Asked of what is under the pointer: a folded list is still laid out, only clipped away.
	const folded = await running.evaluate<boolean>(`(()=>{const row=document.querySelector('[data-ly-row="cred-demo"]');if(!row)return true;const r=row.getBoundingClientRect();const hit=document.elementFromPoint(r.x+Math.min(r.width/2,40),r.y+r.height/2);return !(hit&&row.contains(hit));})()`);
	check("the vault folds the conversation list away, like 创作", folded, folded);
	const savedRow = await running.evaluate<string>(`document.querySelector('[data-ly-vault-row="nas-root"]')?.textContent||''`);
	check("the card's 'save to vault' put it on the list", savedRow.includes("NAS 的 root 密码") && savedRow.includes("ssh://root@127.0.0.1"), savedRow);
	await shot("03_保险箱列表");
	await click("[data-ly-vault-add]");
	await until("document.querySelector('[data-ly-vault-editor=\"add\"]')");
	const segmented = await running.evaluate<{ frame: number; segments: number }>(`(()=>{const f=document.querySelector('[data-ly-vault-editor] [data-segmented]');const s=[...f.querySelectorAll('[data-segment]')];return {frame:Math.round(f.getBoundingClientRect().width),segments:Math.round(s.at(-1).getBoundingClientRect().right-s[0].getBoundingClientRect().left)};})()`);
	check("the kind switch is as wide as its four segments", Math.abs(segmented.frame - segmented.segments) <= 6, segmented);
	await hold(700);
	await click('[data-ly-vault-editor] [data-segment="login"]');
	await hold(500);
	await click("[data-ly-vault-title]");
	await typeText("NAS admin");
	const suggested = await running.evaluate<string>(`document.querySelector('[data-ly-vault-name]').value`);
	check("the reference name follows the title", suggested === "nas-admin", suggested);
	const nameBox = await running.evaluate<{ box: number; title: number; gap: number }>(`(()=>{const input=document.querySelector('[data-ly-vault-name]');const end=document.querySelector('[data-ly-vault-name-end]');return {box:Math.round(input.closest('[data-ly-field]').getBoundingClientRect().height),title:Math.round(document.querySelector('[data-ly-vault-title]').getBoundingClientRect().height),gap:Math.round(end.getBoundingClientRect().left-input.getBoundingClientRect().right)};})()`);
	check("the reference box is a field like the others and its bracket follows the name", nameBox.box === nameBox.title && nameBox.gap >= 0 && nameBox.gap <= 3, nameBox);
	await click('[data-ly-credential-field="username"] input');
	await typeText("admin");
	await click('[data-ly-credential-field="password"] input');
	await typeText(ADMIN_PASSWORD);
	await click("[data-ly-vault-target]");
	await typeText("ssh://admin@nas.local");
	await hold(900);
	await shot("04_手动添加");
	await click("[data-ly-vault-save]");
	await until("document.querySelector('[data-ly-vault-row=\"nas-admin\"]') && !document.querySelector('[data-ly-vault-editor]')");
	await hold(1000);
	const rows = await running.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-vault-row]')].map(r=>r.textContent||'')`);
	check("the list shows names, kinds, usernames and targets — no value", rows.length === 2 && rows.some((row) => row.includes("admin") && row.includes("ssh://admin@nas.local")) && !rows.join("").includes(ADMIN_PASSWORD) && !rows.join("").includes(ROOT_PASSWORD), rows);

	await click('[data-ly-vault-row="nas-admin"] [data-ly-vault-copy-value]');
	await pause(400);
	check("copying the value puts it on the system clipboard", clipboardText() === ADMIN_PASSWORD, "(compared, not printed)");
	const copiedLabel = await running.evaluate<string>(`document.querySelector('[data-ly-vault-row="nas-admin"] [data-ly-vault-copy-value]').getAttribute('aria-label')`);
	check("and says when it will be cleared", copiedLabel === "已复制，30 秒后从剪贴板清除", copiedLabel);
	await hold(900);
	await click('[data-ly-vault-row="nas-admin"] [data-ly-vault-copy-reference]');
	await pause(400);
	check("copying the reference puts the mark on the clipboard", clipboardText() === "[credential:nas-admin]", clipboardText());
	await hold(900);

	// ── 3. A reference pasted into a message ─────────────────────────────────
	await click('[data-ly-rail-item="chat"]');
	await until(`document.querySelector('[data-ly-row="cred-demo"]')?.checkVisibility()`);
	await hold(700);
	await click("main textarea");
	await key("v", 86, { modifiers: 4, commands: ["paste"] });
	await pause(300);
	let pasted = await running.evaluate<string>(`document.querySelector('main textarea').value`);
	const byShortcut = pasted.includes("[credential:nas-admin]");
	if (!byShortcut) {
		// Some CDP builds ignore the paste command; insert what the clipboard holds instead.
		await running.send("Input.insertText", { text: clipboardText() });
		pasted = await running.evaluate<string>(`document.querySelector('main textarea').value`);
	}
	await typeText(" 用这个登录看看");
	await hold(900);
	check("the reference pasted into the composer", pasted.includes("[credential:nas-admin]"), { pasted, byShortcut });
	await key("Enter", 13, { text: "\r" });
	let cardSeen = false;
	for (let i = 0; i < 300; i++) {
		if (await running.evaluate<boolean>("Boolean(document.querySelector('[data-ly-credential-card]'))")) cardSeen = true;
		const done = await running.evaluate<boolean>(`[...document.querySelectorAll('main')].some(m=>(m.textContent.match(/我拿到的输出是/g)||[]).length>=2)`);
		if (done) break;
		await pause(100);
	}
	await hold(1500);
	await shot("05_贴引用直接用上");
	const second = await screenText();
	check("a pasted reference hands the saved credential over without a card", !cardSeen, { cardSeen });
	check("the username comes through, the password as a reference", second.includes("user: admin") && second.includes("askpass: [credential:nas-admin]") && !second.includes(ADMIN_PASSWORD), second.slice(second.lastIndexOf("我拿到的输出是"), second.lastIndexOf("我拿到的输出是") + 120));

	await stopRecording();
	stopRecording = undefined;

	// ── 4. What reached the model, and what is on disk ─────────────────────────
	const leaked = bodies.filter((body) => body.includes(ROOT_PASSWORD) || body.includes(ADMIN_PASSWORD)).length;
	check("no request to the model carried either password", leaked === 0 && bodies.length >= 5, { requests: bodies.length, leaked });
	check("the masked output did reach the model", bodies.some((body) => body.includes("[credential:nas-root]")) && bodies.some((body) => body.includes("[credential:nas-admin]")), null);
	const onDisk = await filesHolding(running.home, [ROOT_PASSWORD, ADMIN_PASSWORD]);
	check("no file in the profile holds either password in the clear", onDisk.length === 0, onDisk);

	// The clipboard copy clears itself after 30 seconds, if nothing else was copied since.
	await click('[data-ly-rail-item="vault"]');
	await until("document.querySelector('[data-ly-vault-row=\"nas-admin\"]')?.checkVisibility()");
	// The page plays its arrival when it is shown again; a press during it can land on the moving row.
	await pause(1200);
	await click('[data-ly-vault-row="nas-admin"] [data-ly-vault-copy-value]');
	let before = false;
	for (let i = 0; i < 30 && !before; i++) {
		await pause(100);
		before = clipboardText() === ADMIN_PASSWORD;
	}
	const label = await running.evaluate<string>(`document.querySelector('[data-ly-vault-row="nas-admin"] [data-ly-vault-copy-value]').getAttribute('aria-label')`);
	await pause(31_000);
	check("the copied value is cleared from the clipboard after 30 s", before && clipboardText() === "", { before, label, after: clipboardText().length });
	check("verification script completed", true, null);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(server);
	execFileSync("pbcopy", { input: userClipboard });
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_凭据卡片与保险箱_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	for (const picture of shots) await writeFile(join(out, `${stamp}_${picture.name}.png`), picture.data);
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 30, 2500);
	console.log(`Evidence: ${join(out, name)} (${frames.length} frames, ${shots.length} screenshots)`);
	// Test values only: what the fake model was sent, to see why a step went another way.
	if (process.env.DUMP_REQUESTS) await writeFile(process.env.DUMP_REQUESTS, JSON.stringify(bodies.map((body) => JSON.parse(body) as unknown), null, 1));
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
