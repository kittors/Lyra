/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * The vault's add dialog keeps one height while its four kinds are switched.
 *
 * Every painted frame's height of the dialog card is logged from a rAF loop while the segments are
 * pressed with a real pointer, round after round — a jump that lives for one frame is still in the
 * log. Then the window is made short, and the same switching must keep one height that fits it, the
 * form scrolling inside instead of pushing the card past the window.
 *
 * `pnpm --filter @lyra/desktop build`, then
 * `node --experimental-strip-types packages/desktop/e2e/vault-dialog-height-demo.ts [out-dir] [label] [locale]`
 *
 * The label names the files (改动前 / 改动后); a locale other than zh-CN runs the measurement only,
 * without the recording, so all seven languages can be checked in a loop.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra保险箱弹窗测试");
const label = process.argv[3] ?? "改动后";
const locale = process.argv[4] ?? "zh-CN";
const filming = locale === "zh-CN";
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9873;
const KINDS = ["password", "login", "token", "ssh_key"] as const;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			uiLocale: locale,
			providers: [],
			mcpServers: [],
			hooks: [],
			projectMemory: false,
			appearance: { theme: "light", reduceMotion: "off" },
			projects: [],
			sync: { enabled: false },
		}),
	);
}

type Sample = { h: number; layout: number; top: number; kind: string };

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const shots: { name: string; data: Buffer }[] = [];

try {
	app = await startApp({ port: PORT, seed });
	if (filming) stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");
	const running = app;

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await running.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function shot(name: string) {
		if (!filming) return;
		const picture = await running.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		shots.push({ name, data: Buffer.from(picture.data, "base64") });
	}
	/** A real pointer, the landing checked before the press. */
	async function click(selector: string) {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
		const at = await running.evaluate<{ x: number; y: number }>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		await running.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
		await pause(120);
		const lands = await running.evaluate<boolean>(
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const hit=document.elementFromPoint(${at.x},${at.y});return Boolean(hit&&(el===hit||el.contains(hit)));})()`,
		);
		if (!lands) throw new Error(`the pointer would not land on ${selector}`);
		for (const type of ["mousePressed", "mouseReleased"]) await running.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}

	await click('[data-ly-rail-item="vault"]');
	await until("document.querySelector('[data-ly-vault-add]')");
	await pause(900);
	await click("[data-ly-vault-add]");
	await until("document.querySelector('[data-ly-vault-editor=\"add\"]')");
	// The entrance scales the card; the log starts once it has settled.
	await pause(700);

	/*
	 * One sample per painted frame, from the same card node throughout. offsetHeight is the layout
	 * box, the rect is what is drawn; both are kept so a transform cannot pass for a height.
	 */
	await running.evaluate(`(()=>{
		const card = document.querySelector('[data-ly-modal]');
		window.__vaultLog = [];
		const tick = () => {
			if (!card.isConnected) return;
			const r = card.getBoundingClientRect();
			const on = document.querySelector('[data-ly-vault-editor] [data-segment][aria-pressed="true"]');
			window.__vaultLog.push({ h: Math.round(r.height * 100) / 100, layout: card.offsetHeight, top: Math.round(r.top * 100) / 100, kind: on ? on.getAttribute('data-segment') : '' });
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);

	const natural: Record<string, { content: number; view: number; scrolls: boolean; room: number }> = {};
	for (const round of [1, 2, 3]) {
		for (const kind of [...KINDS.slice(1), KINDS[0]]) {
			await click(`[data-ly-vault-editor] [data-segment="${kind}"]`);
			await pause(round === 1 ? 900 : 450);
			if (round === 1) {
				await shot(`${String(KINDS.indexOf(kind) + 1).padStart(2, "0")}_${label}_${kind}`);
				// How tall the form is against the room the card gives it, and how much empty room is kept under it.
				natural[kind] = await running.evaluate(`(()=>{
					const view = document.querySelector('[data-ly-modal] .ly-scroll-view');
					const form = document.querySelector('[data-ly-vault-editor]');
					const room = document.querySelector('[data-ly-modal] [data-ly-dialog-reserve]');
					return { content: Math.round(form.getBoundingClientRect().height), view: Math.round(view.clientHeight), scrolls: view.scrollHeight > view.clientHeight + 1, room: room ? Math.round(room.getBoundingClientRect().height * 100) / 100 : 0 };
				})()`);
			}
		}
	}
	console.log(`form height per kind, against the room it is given: ${JSON.stringify(natural)}`);
	check(`[${locale}] at 1280x860 no kind scrolls: every row is in view`, Object.values(natural).every((one) => !one.scrolls), natural);
	check(`[${locale}] no kind is left with a gap under it: the forms are one height (empty room under 2px)`, Object.values(natural).every((one) => one.room < 2) && new Set(Object.values(natural).map((one) => one.content)).size === 1, Object.fromEntries(Object.entries(natural).map(([kind, one]) => [kind, { form: one.content, room: one.room }])));

	const log = await running.evaluate<Sample[]>("window.__vaultLog");
	const byKind = Object.fromEntries(KINDS.map((kind) => [kind, [...new Set(log.filter((s) => s.kind === kind).map((s) => s.h))]]));
	const heights = [...new Set(log.map((s) => s.h))];
	const tops = [...new Set(log.map((s) => s.top))];
	console.log(`frames logged: ${log.length}; height per kind: ${JSON.stringify(byKind)}`);
	check(`[${locale}] every frame of the card has one height across all four kinds (${log.length} frames, 3 rounds)`, heights.length === 1, { heights, byKind });
	check(`[${locale}] the card's top edge never moves`, tops.length === 1, tops);
	check(`[${locale}] every kind was visited in the log`, KINDS.every((kind) => byKind[kind]!.length > 0), Object.keys(byKind));

	// What the form looks like inside: the kind's own boxes, nothing of another kind's.
	const inside = await running.evaluate<{ kind: string; fields: string[]; focusable: number }>(`(()=>{
		const form = document.querySelector('[data-ly-vault-editor]');
		const live = [...form.querySelectorAll('[data-ly-credential-fields]')].filter((el) => el.checkVisibility({ visibilityProperty: true }));
		const focusable = [...form.querySelectorAll('input,textarea,button')].filter((el) => el.checkVisibility({ visibilityProperty: true }) && !el.closest('[inert]')).length;
		return { kind: live.map((el) => el.getAttribute('data-ly-credential-fields')).join(','), fields: live.flatMap((el) => [...el.querySelectorAll('[data-ly-credential-field]')].map((f) => f.getAttribute('data-ly-credential-field'))), focusable };
	})()`);
	check(`[${locale}] only the selected kind's boxes are visible and reachable`, inside.kind === "password" && inside.fields.join() === "password", inside);

	/*
	 * A private key pasted into its one-line box: the line breaks are kept, the box stays one line,
	 * the text turns to dots, and the card does not move. The key is made up -- it only has the shape.
	 */
	await click('[data-ly-vault-editor] [data-segment="ssh_key"]');
	await pause(500);
	await click('[data-ly-vault-editor] [data-ly-credential-fields] [data-ly-credential-field="private_key"] textarea');
	const fakeKey = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", "QyNTUxOQAAACBmYWtlZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2UAAAAA", "-----END OPENSSH PRIVATE KEY-----"].join("\n");
	await running.send("Input.insertText", { text: fakeKey });
	await pause(700);
	const pasted = await running.evaluate<{ lines: number; box: number; secretBox: number; masked: string; card: number }>(`(()=>{
		const field = document.querySelector('[data-ly-vault-editor] [data-ly-credential-fields] [data-ly-credential-field="private_key"]');
		const area = field.querySelector('textarea');
		const secret = document.querySelector('[data-ly-vault-editor] [data-ly-credential-fields] [data-ly-credential-field="passphrase"] [data-ly-field]');
		return { lines: area.value.split(String.fromCharCode(10)).length, box: field.querySelector('[data-ly-field]').getBoundingClientRect().height, secretBox: secret.getBoundingClientRect().height, masked: getComputedStyle(area).webkitTextSecurity, card: Math.round(document.querySelector('[data-ly-modal]').getBoundingClientRect().height * 100) / 100 };
	})()`);
	await shot(`06_${label}_ssh_key_粘贴私钥之后`);
	check(`[${locale}] a pasted private key keeps its line breaks`, pasted.lines === 4, pasted);
	check(`[${locale}] its box stays one line, as tall as the passphrase box beside it`, Math.abs(pasted.box - pasted.secretBox) < 0.5, pasted);
	check(`[${locale}] the pasted key is shown as dots`, pasted.masked === "disc", pasted.masked);
	check(`[${locale}] and the card kept its height`, pasted.card === heights[0], { card: pasted.card, before: heights[0] });
	// Back to an empty password form for the windows below.
	await click('[data-ly-vault-editor] [data-segment="password"]');
	await pause(400);

	// A window shorter than the default: still one height, and nothing needs to scroll yet.
	await running.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 760, deviceScaleFactor: 0, mobile: false });
	await pause(600);
	const medium: Record<string, { h: number; scrolls: boolean }> = {};
	for (const kind of [...KINDS.slice(1), KINDS[0]]) {
		await click(`[data-ly-vault-editor] [data-segment="${kind}"]`);
		await pause(500);
		medium[kind] = await running.evaluate(`(()=>{
			const card = document.querySelector('[data-ly-modal]');
			const view = card.querySelector('.ly-scroll-view');
			return { h: Math.round(card.getBoundingClientRect().height * 100) / 100, scrolls: view.scrollHeight > view.clientHeight + 1 };
		})()`);
	}
	check(`[${locale}] in a 760px window the four kinds share one height`, new Set(Object.values(medium).map((one) => one.h)).size === 1, medium);
	check(`[${locale}] and none of them scrolls`, Object.values(medium).every((one) => !one.scrolls), medium);

	// A short window: one height still, inside the window, the form scrolling instead.
	await running.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 540, deviceScaleFactor: 0, mobile: false });
	await pause(600);
	const short: Record<string, { h: number; bottom: number; scrolls: boolean; range: number; overflow: number }> = {};
	for (const kind of [...KINDS.slice(1), KINDS[0]]) {
		await click(`[data-ly-vault-editor] [data-segment="${kind}"]`);
		await pause(500);
		short[kind] = await running.evaluate(`(()=>{
			const card = document.querySelector('[data-ly-modal]');
			const view = card.querySelector('.ly-scroll-view');
			const r = card.getBoundingClientRect();
			const form = card.querySelector('[data-ly-vault-editor]');
			return { h: Math.round(r.height * 100) / 100, bottom: Math.round(r.bottom), scrolls: view.scrollHeight > view.clientHeight + 1, range: view.scrollHeight - view.clientHeight, overflow: Math.ceil(form.getBoundingClientRect().height + 4 - view.clientHeight) };
		})()`);
		if (kind === "ssh_key") await shot(`05_${label}_矮窗口_ssh_key`);
	}
	const shortHeights = [...new Set(Object.values(short).map((s) => s.h))];
	check(`[${locale}] in a 540px window the four kinds still share one height`, shortHeights.length === 1, short);
	check(`[${locale}] the card stays inside the 540px window`, Object.values(short).every((s) => s.bottom <= 540), Object.values(short).map((s) => s.bottom));
	check(`[${locale}] what does not fit scrolls inside the card`, Object.values(short).every((one) => one.scrolls), short);
	// Each form scrolls only by what its own rows overflow, never into kept empty room.
	check(`[${locale}] each form scrolls by its own overflow only, not into empty room`, Object.values(short).every((one) => Math.abs(one.range - Math.max(0, one.overflow)) <= 1), short);
	await running.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 0, mobile: false });
	await pause(500);

	/*
	 * A real key, made for this run and thrown away after: pasted into the one-line box and saved, the
	 * main process has to accept it -- which it only does if every line break made it through.
	 */
	const keyDir = await mkdtemp(join(tmpdir(), "lyra-vault-key-"));
	try {
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "lyra-probe", "-f", join(keyDir, "key")]);
		const realKey = (await readFile(join(keyDir, "key"), "utf8")).trimEnd();
		await click('[data-ly-vault-editor] [data-segment="ssh_key"]');
		await pause(400);
		await click("[data-ly-vault-title]");
		await running.send("Input.insertText", { text: "测试密钥" });
		await click('[data-ly-vault-editor] [data-ly-credential-fields] [data-ly-credential-field="private_key"] textarea');
		await running.send("Input.insertText", { text: realKey });
		await pause(500);
		await click("[data-ly-vault-save]");
		await until("!document.querySelector('[data-ly-vault-editor]') || document.querySelector('[data-ly-vault-problem]')", 10_000);
		const saved = await running.evaluate<{ problem: string; rows: string[] }>(`({ problem: document.querySelector('[data-ly-vault-problem]')?.textContent || '', rows: [...document.querySelectorAll('[data-ly-vault-row]')].map((row) => row.textContent || '') })`);
		await pause(800);
		await shot(`07_${label}_粘贴的真私钥已存进保险箱`);
		check(`[${locale}] a real private key pasted into the one-line box is accepted and saved`, !saved.problem && saved.rows.some((row) => row.includes("测试密钥")), saved);
	} finally {
		await rm(keyDir, { recursive: true, force: true });
	}
} catch (error) {
	check("probe ran to the end", false, error instanceof Error ? error.stack : String(error));
} finally {
	await stopRecording?.();
	await app?.stop();
	const passed = checks.filter((c) => c.ok).length;
	if (filming) {
		await mkdir(out, { recursive: true });
		for (const one of shots) await writeFile(join(out, `${stamp}_${one.name}.png`), one.data);
		if (frames.length > 1) await encode(frames, join(out, `${stamp}_${label}_四个标签来回切换_${passed}of${checks.length}.mp4`), 30);
		console.log(`saved to ${out}`);
	}
	console.log(`${passed}/${checks.length} passed`);
	process.exitCode = passed === checks.length ? 0 : 1;
}
