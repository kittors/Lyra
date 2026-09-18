/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 插件页的滚动条贴在主栏右边，不压在「试一下」那条输入框上。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-plugins-scroll-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra插件滚动条测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9776;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 720, x: 40, y: 40 }));
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
	async function openSettings(label: string) {
		if (
			!(await app!.evaluate(
				`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`,
			))
		) {
			await click(".ly-sidebar-foot button");
			await until(`Boolean(document.querySelector("nav button"))`);
			await pause(400);
		}
		await app!.evaluate(`(() => {
			const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
			if (nav) nav.click();
		})()`);
		await pause(800);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	await openSettings("插件");
	await until(`Boolean(document.querySelector("[data-ly-extensions-page]"))`);
	await app.evaluate(`(() => {
		const tab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("规则"));
		tab?.click();
	})()`);
	await until(`Boolean(document.querySelector("[data-rule-try]"))`);
	await pause(500);

	const geometry = await app.evaluate<{
		main: number;
		host: number;
		fieldRight: number;
		hostRight: number;
		gap: number;
		page: boolean;
		hosts: number;
	}>(`(() => {
		const main = document.querySelector("main");
		const field = document.querySelector("[data-rule-try] [data-ly-field]");
		const host = field?.closest(".ly-scroll-host") ?? document.querySelector("[data-view='rules'] .ly-scroll-host");
		const m = main?.getBoundingClientRect();
		const h = host?.getBoundingClientRect();
		const f = field?.getBoundingClientRect();
		return {
			main: m ? Math.round(m.width) : 0,
			host: h ? Math.round(h.width) : 0,
			fieldRight: f ? Math.round(f.right) : 0,
			hostRight: h ? Math.round(h.right) : 0,
			gap: h && f ? Math.round(h.right - f.right) : 0,
			page: Boolean(document.querySelector("[data-ly-extensions-page]")),
			hosts: document.querySelectorAll(".ly-scroll-host").length,
		};
	})()`);
	check(
		"scroller fills the pane, not the 900px column",
		geometry.host > 0 && Math.abs(geometry.host - geometry.main) <= 2,
		geometry,
	);
	check(
		"try-condition field sits left of the scrollbar edge",
		geometry.gap >= 24,
		geometry,
	);
	await hold(1400);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_插件滚动条_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
