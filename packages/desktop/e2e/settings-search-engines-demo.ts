/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 地址栏搜索引擎下拉：必应 / Google / 百度 / DuckDuckGo 用官方彩色 SVG，不是一行纯字。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-search-engines-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra搜索引擎图标测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9784;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

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
			appearance: { theme: "light" },
		}),
	);
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
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
		}
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	if (
		!(await app.evaluate(
			`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`,
		))
	) {
		await click(".ly-sidebar-foot button");
		await until(`Boolean(document.querySelector("nav button"))`);
		await pause(400);
	}
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === "浏览器");
		if (nav) nav.click();
	})()`);
	await until(`Boolean([...document.querySelectorAll("h1")].find((h) => (h.textContent || "").includes("浏览器")))`);
	await pause(400);

	await app.evaluate(`document.querySelector('[aria-label="搜索引擎"]')?.scrollIntoView({block:'center',behavior:'instant'})`);
	await hold(900);
	await click('[aria-label="搜索引擎"]');
	await until(`Boolean(document.querySelector("[data-ly-popover] [data-search-engine]"))`);
	await hold(1600);

	const menu = await app.evaluate<{
		engines: string[];
		sizes: number[];
		fills: Record<string, string[]>;
	}>(`(() => {
		const pop = document.querySelector("[data-ly-popover]");
		const marks = [...(pop?.querySelectorAll("[data-search-engine]") ?? [])];
		const fills = {};
		for (const mark of marks) {
			const id = mark.getAttribute("data-search-engine") ?? "";
			fills[id] = [...mark.querySelectorAll("[fill]")].map((node) => node.getAttribute("fill") ?? "").filter((fill) => fill && !fill.startsWith("url("));
		}
		return {
			engines: marks.map((mark) => mark.getAttribute("data-search-engine") ?? ""),
			sizes: marks.map((mark) => Math.round(mark.getBoundingClientRect().width)),
			fills,
		};
	})()`);

	check(
		"menu lists official marks for bing, google, baidu and duckduckgo",
		["bing", "google", "baidu", "duckduckgo"].every((id) => menu.engines.includes(id)),
		menu.engines,
	);
	check(
		"each mark is a 16px colour SVG, not a grey glyph",
		menu.sizes.every((size) => size === 16) &&
			(menu.fills.google ?? []).includes("#4285F4") &&
			(menu.fills.baidu ?? []).includes("#2932E1") &&
			(menu.fills.duckduckgo ?? []).includes("#DE5833"),
		{ sizes: menu.sizes, fills: menu.fills },
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
	const name = `${stamp}_搜索引擎图标_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
