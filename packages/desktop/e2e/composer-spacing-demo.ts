/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 主输入框、侧边聊天、子 Agent 共用一套内外边距：卡片同高，底边落在同一条窗线上。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/composer-spacing-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra输入框间距测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9780;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4579, token: null },
		}),
	);
	const projectId = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "composer-space",
		title: "输入框间距",
		cwd: project,
		projectId,
		projectName: "proj",
		createdAt: 1,
		updatedAt: 2,
		modelId: "none",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 3,
	};
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({
			seq: 2,
			ts: 2,
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "对一下三个输入框的高度和底边" }], timestamp: 2 },
		}),
		JSON.stringify({
			seq: 3,
			ts: 3,
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "主输入框、侧边聊天、子 Agent 应当同高，底边落在同一条窗线上。" }], timestamp: 3 },
		}),
	];
	await writeFile(join(home, "sessions", projectId, "composer-space.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function openPane(label: string) {
		await app!.evaluate(`document.querySelector('button[aria-label="面板"]')?.click()`);
		await until(`Boolean(document.querySelector('[role="menuitem"]'))`);
		await app!.evaluate(
			`[...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`,
		);
		await pause(400);
	}

	await until(`Boolean(document.querySelector('[data-ly-row="composer-space"]'))`);
	await app.evaluate(`document.querySelector('[data-ly-row="composer-space"] > button')?.click()`);
	await until(`Boolean(document.querySelector(".ly-composer"))`);
	await hold(800);

	const measure = () =>
		app!.evaluate<{
			inset: number;
			gutter: number;
			control: number;
			textTop: number;
			textBottom: number;
			textLeft: number;
			barBottom: number;
			barLeft: number;
			dockBottom: number;
			dockInline: number;
			padBottom: number;
			padInline: number;
			cards: Record<string, { height: number; toWindow: number; toHost: number; gutter: number }>;
		}>(`(() => {
		const root = getComputedStyle(document.documentElement);
		const inset = Math.round(parseFloat(root.getPropertyValue("--ly-composer-in")));
		const gutter = Math.round(parseFloat(root.getPropertyValue("--ly-composer-out")));
		const control = Math.round(parseFloat(root.getPropertyValue("--ly-composer-control")));
		const text = document.querySelector("[data-dock-pane='conversation'] textarea.ly-composer-text");
		const card = text?.closest(".ly-composer");
		const bar = card?.querySelector(".ly-composer-bar");
		const dock = document.querySelector(".ly-composer-dock");
		const pad = document.querySelector("[data-dock-pane='chat'] .ly-composer-pad")
			?? document.querySelector("[data-dock-pane='subagents'] .ly-composer-pad");
		const ts = text ? getComputedStyle(text) : null;
		const bs = bar ? getComputedStyle(bar) : null;
		const ds = dock ? getComputedStyle(dock) : null;
		const ps = pad ? getComputedStyle(pad) : null;
		const cards = {};
		for (const kind of ["conversation", "chat", "subagents"]) {
			const pane = document.querySelector(\`[data-dock-pane="\${kind}"]\`);
			const field = pane?.querySelector("textarea.ly-composer-text");
			const shell = field?.closest(".ly-composer");
			if (!pane || !shell) continue;
			const box = shell.getBoundingClientRect();
			const host = pane.querySelector(".ly-composer-dock, .ly-composer-pad") ?? pane;
			const hs = getComputedStyle(host);
			const hb = host.getBoundingClientRect();
			cards[kind] = {
				height: Math.round(box.height),
				toWindow: Math.round(window.innerHeight - box.bottom),
				toHost: Math.round(hb.bottom - box.bottom),
				gutter: Math.round(parseFloat(hs.paddingLeft)),
			};
		}
		return {
			inset,
			gutter,
			control,
			textTop: ts ? Math.round(parseFloat(ts.paddingTop)) : 0,
			textBottom: ts ? Math.round(parseFloat(ts.paddingBottom)) : 0,
			textLeft: ts ? Math.round(parseFloat(ts.paddingLeft)) : 0,
			barBottom: bs ? Math.round(parseFloat(bs.paddingBottom)) : 0,
			barLeft: bs ? Math.round(parseFloat(bs.paddingLeft)) : 0,
			dockBottom: ds ? Math.round(parseFloat(ds.paddingBottom)) : 0,
			dockInline: ds ? Math.round(parseFloat(ds.paddingLeft)) : 0,
			padBottom: ps ? Math.round(parseFloat(ps.paddingBottom)) : 0,
			padInline: ps ? Math.round(parseFloat(ps.paddingLeft)) : 0,
			cards,
		};
	})()`);

	await openPane("侧边聊天");
	await until(`Boolean(document.querySelector('[data-dock-pane="chat"] textarea.ly-composer-text'))`);
	await hold(1400);

	const pair = await measure();
	check(
		"empty field uses one 12px inset and 16px sides",
		pair.inset === 12 &&
			pair.textTop === 12 &&
			pair.textBottom === 12 &&
			pair.textLeft === 16 &&
			pair.barBottom === 12 &&
			pair.barLeft === 16 &&
			pair.control === 28,
		pair,
	);
	check(
		"outer gutter is 24px on the main dock and on the pane pad",
		pair.gutter === 24 && pair.dockBottom === 24 && pair.dockInline === 24 && pair.padInline === 24 && pair.padBottom === 20,
		{
			gutter: pair.gutter,
			dockBottom: pair.dockBottom,
			dockInline: pair.dockInline,
			padInline: pair.padInline,
			padBottom: pair.padBottom,
		},
	);
	check(
		"main and side-chat cards share one height and one window-bottom line",
		Boolean(pair.cards.conversation && pair.cards.chat) &&
			Math.abs(pair.cards.conversation.height - pair.cards.chat.height) <= 1 &&
			Math.abs(pair.cards.conversation.toWindow - pair.cards.chat.toWindow) <= 2 &&
			pair.cards.conversation.toHost === 24 &&
			pair.cards.chat.toHost === 20 &&
			pair.cards.conversation.gutter === 24 &&
			pair.cards.chat.gutter === 24,
		pair.cards,
	);

	await openPane("子 Agent");
	await until(`Boolean(document.querySelector('[data-dock-pane="subagents"] textarea.ly-composer-text'))`);
	await hold(1400);

	const chrome = await measure();

	const kinds = Object.keys(chrome.cards);
	const heights = Object.values(chrome.cards).map((card) => card.height);
	const gutters = Object.values(chrome.cards).map((card) => card.gutter);
	const heightSpan = heights.length ? Math.max(...heights) - Math.min(...heights) : 99;
	const floor = Object.values(chrome.cards).filter((card) => card.toWindow <= 40);
	const floorSpan = floor.length
		? Math.max(...floor.map((card) => card.toWindow)) - Math.min(...floor.map((card) => card.toWindow))
		: 99;
	check(
		"main, side chat and sub-agent cards share one height",
		kinds.length === 3 && heightSpan <= 1,
		chrome.cards,
	);
	check(
		"cards on the window floor share one bottom line; each pad uses its token",
		floor.length >= 2 &&
			floorSpan <= 2 &&
			chrome.cards.conversation?.toHost === 24 &&
			chrome.cards.chat?.toHost === 20 &&
			chrome.cards.subagents?.toHost === 20,
		chrome.cards,
	);
	check(
		"the three docks share the 24px outer gutter",
		kinds.length === 3 && gutters.every((value) => value === 24),
		chrome.cards,
	);

	const mainFile = await app.evaluate<boolean>(`(() => {
		const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
		const transfer = new DataTransfer();
		transfer.items.add(new File([png], "shot.png", { type: "image/png" }));
		transfer.items.add(new File(["note"], "图片1.md", { type: "text/markdown" }));
		const input = document.querySelector("[data-dock-pane='conversation'] input[type=file]");
		if (!input) return false;
		input.files = transfer.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
	check("main composer accepted a thumbnail and a file token", mainFile, mainFile);
	await until(`Boolean(document.querySelector("[data-dock-pane='conversation'] [data-ly-attachment]"))`);
	await pause(400);
	await hold(1600);

	const attach = await app.evaluate<{ cardToTile: number; tileToToken: number }>(`(() => {
		const field = document.querySelector("[data-dock-pane='conversation'] textarea.ly-composer-text");
		const card = field?.closest(".ly-composer");
		const tile = card?.querySelector("[data-ly-attachment] .ly-attachment-body");
		const token = card?.querySelector(".ly-attachment-token");
		const c = card?.getBoundingClientRect();
		const t = tile?.getBoundingClientRect();
		const k = token?.getBoundingClientRect();
		return {
			cardToTile: c && t ? Math.round(t.top - c.top) : 0,
			tileToToken: t && k ? Math.round(k.top - t.bottom) : 0,
		};
	})()`);
	check(
		"thumbnail has 12px to the card and one 12px inset to the token under it",
		attach.cardToTile >= 11 && attach.cardToTile <= 16 && attach.tileToToken >= 10 && attach.tileToToken <= 16,
		attach,
	);
	await hold(800);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_输入框间距_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
