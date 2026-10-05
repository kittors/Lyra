/* oxlint-disable no-console -- the probe's output is what it measured */
/**
 * An escalation card in a real window: no "stop asking", and nothing an earlier version remembered
 * answers it.
 *
 * The profile starts with `escalate:danger-full-access:echo hi` in `alwaysAllow` — what clicking
 * "stop asking" on an escalation card used to leave behind — and the fake model then asks for
 * exactly that escalation. Before the fix no card was drawn at all: the gate found the line and the
 * command ran unconfined. A command `auto` stops on its own is the control, because the card is
 * shared: it has to keep all three answers.
 *
 * Measured from what is drawn, not from what was sent: the buttons' own text, and the list the
 * settings page shows.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

/** Where the screenshots go: the first argument, as `audit-regression.mjs` passes it, or the desktop. */
const OUT = process.argv[2] ?? join(homedir(), "Desktop", "Lyra提权审批测试");
const LEGACY = "escalate:danger-full-access:echo hi";
/** Outside the workspace so `auto` asks, and absent so nothing is deleted even if it ran. */
const NONEXISTENT = join(homedir(), ".lyra-e2e-nonexistent-escalation-probe");

/** One tool call per trigger word; a tool result, or anything else, gets a line of text. */
const CALLS: Record<string, Record<string, unknown>> = {
	ESCALATE_PROBE: { command: "echo hi", description: "写出构建产物", escalate: "danger-full-access", justification: "构建产物要写到工作区外面的 ../dist" },
	COMMAND_PROBE: { command: `rm -rf ${NONEXISTENT}`, description: "清理临时目录" },
};

function model() {
	return createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", () => {
			const body = JSON.parse(raw) as { messages: unknown[]; tools?: unknown[] };
			// The provider appends an environment message after the prompt or the tool result. A
			// request without tools is the title being drafted, which must not get a tool call.
			const recent = JSON.stringify(body.messages.slice(-3));
			const trigger = body.tools?.length && !recent.includes('"tool_result"')
				? Object.keys(CALLS).find((word) => recent.includes(word))
				: undefined;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: "probe", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
			if (trigger) {
				emit("content_block_start", { index: 0, content_block: { type: "tool_use", id: `call-${trigger}`, name: "bash", input: {} } });
				emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(CALLS[trigger]) } });
			} else {
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "好的。" } });
			}
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: trigger ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } });
			emit("message_stop", {});
			res.end();
		});
	});
}

let app: RunningApp;

async function until(what: string, condition: () => Promise<boolean>) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(`Timed out waiting for ${what}`);
}

async function settle() {
	await app.evaluate("Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
}

/** A real press where the element is drawn, after checking that the point lands on it. */
async function click(selector: string) {
	const at = () => app.evaluate<{ x: number; y: number; lands: boolean } | null>(`(()=>{
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el || !el.checkVisibility()) return null;
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		return { x, y, lands: el.contains(document.elementFromPoint(x, y)) };
	})()`);
	await until(`${selector} to be clickable`, async () => (await at())?.lands === true);
	await settle();
	const point = await at();
	if (!point) throw new Error(`${selector} disappeared`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
	}
}

async function say(text: string) {
	await click("main textarea");
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}

interface Card { title: string; reason: string; detail: string; buttons: string[]; overflowX: number }

async function card(): Promise<Card | null> {
	return app.evaluate<Card | null>(`(()=>{
		const card = document.querySelector('[data-approval-card]');
		if (!card || !card.checkVisibility()) return null;
		const view = card.querySelector('.ly-scroll-view');
		return {
			title: card.querySelector('[data-approval-title]')?.textContent?.trim() ?? '',
			reason: card.querySelector('.ly-approval-scroll p')?.textContent?.trim() ?? '',
			detail: card.querySelector('pre')?.textContent?.trim() ?? '',
			buttons: [...card.querySelectorAll('[data-ly-permission-choices] button')].map((b) => (b.textContent || '').trim()),
			overflowX: view ? view.scrollWidth - view.clientWidth : 0,
		};
	})()`);
}

/** Refuse the card on screen and wait for the turn it held up to finish. */
async function refuse() {
	await click("[data-ly-permission-choices] button");
	await until("the card to go", async () => (await card()) === null);
	await until("the turn to end", () => app.evaluate<boolean>("!document.querySelector('[data-ly-running]')"));
}

async function shot(name: string) {
	await mkdir(OUT, { recursive: true });
	await settle();
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	return file;
}

async function main() {
	const server = model();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");

	app = await startApp({
		port: 9716,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const file = join(home, "settings.json");
			const settings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
			// `auto`: the mode where an escalation is the only thing between the model and an unconfined run.
			await writeFile(file, JSON.stringify({
				...settings, permissionMode: "auto", thinking: "off", projectMemory: false,
				alwaysAllow: [LEGACY, "npm test"], appearance: { theme: "dark", reduceMotion: "on" },
			}));
		},
	});
	try {
		await app.evaluate("document.fonts.ready");
		await click('[data-ly-row="qa-short"] > button');

		await say("ESCALATE_PROBE 把构建产物写出去");
		await until("the escalation card", async () => (await card()) !== null);
		const escalation = (await card())!;
		const escalationShot = await shot("1-提权卡片");
		await refuse();

		await say("COMMAND_PROBE 清理一下临时目录");
		await until("the command card", async () => (await card()) !== null);
		const command = (await card())!;
		const commandShot = await shot("2-普通命令对照");
		await refuse();

		const stored = await app.evaluate<string[]>("window.lyra.settings.get().then((s) => s.alwaysAllow)");
		const opened = await app.evaluate<boolean>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const hit = (text) => {
				const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
				el?.click();
				return Boolean(el);
			};
			if (!hit("访问授权")) {
				document.querySelector("[data-ly-open-settings]")?.click();
				await wait(1300);
				if (!hit("访问授权")) return false;
			}
			await wait(900);
			return true;
		})()`);
		const listed = await app.evaluate<string[]>("[...document.querySelectorAll('main .font-mono.break-all')].map((el) => el.textContent.trim())");
		const listShot = await shot("3-访问授权列表");

		console.log(JSON.stringify({ escalation, command, stored, opened, listed }, null, 2));
		console.log("截图:", escalationShot, commandShot, listShot);
		const checks: [string, boolean][] = [
			["设置里留着旧版本记下的提权，卡片照样弹出来", escalation.detail === "echo hi"],
			["提权卡片只有「拒绝」和「允许一次」", escalation.buttons.join("|") === "拒绝|允许一次"],
			["提权卡片领头的是模型给的理由", escalation.reason.includes("../dist")],
			["提权卡片没有横向溢出", escalation.overflowX === 0],
			["普通命令的卡片三个答案都在", command.buttons.join("|") === "拒绝|以后不再问|允许一次"],
			["设置读出来已经没有那条提权", !stored.includes(LEGACY) && stored.includes("npm test")],
			["访问授权页打开了", opened],
			["访问授权页只列出真正生效的那条", listed.join("|") === "npm test"],
		];
		console.log("\n=== 判定 ===");
		let bad = 0;
		for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? "✔" : "✘"} ${name}`); }
		console.log(bad === 0 ? "\n全部成立" : `\n${bad} 条不成立`);
		if (bad) process.exitCode = 1;
	} finally {
		await app.stop();
		await closeListeningServer(server);
	}
}

await main();
