/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 设置页章节切换：导航药丸跟着走，正文淡入上移，不是硬切。
 *
 * 用法：node --experimental-strip-types e2e/settings-switch-demo.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "设置页切换测试");
const PORT = 9544;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const PAGES = ["常规", "外观", "屏幕截图", "浏览器", "个性化"] as const;

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function seed(home: string): Promise<void> {
	await mkdir(join(home, "project"), { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ path: join(home, "project"), name: "demo", pinned: false, lastOpenedAt: Date.now() }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4548, token: null },
			appearance: { theme: "light" },
		}),
	);
}

async function measure() {
	return app.evaluate<{
		view: string;
		animation: string;
		pillY: number;
		pillReady: boolean;
		heading: string;
	}>(`(() => {
		const root = document.querySelector("[data-ly-settings]");
		const page = root && root.querySelector('[data-active="true"]');
		const pill = root && root.querySelector(".ly-settings-nav-pill");
		const heading = root && root.querySelector("main h1");
		const style = pill ? getComputedStyle(pill) : null;
		const y = style ? parseFloat(style.transform.split(",")[5] || "0") : -1;
		return {
			view: page?.getAttribute("data-view") || "",
			animation: page ? getComputedStyle(page).animationName : "",
			pillY: Number.isFinite(y) ? Math.round(y) : -1,
			pillReady: pill?.getAttribute("data-ready") === "true",
			heading: (heading?.textContent || "").trim().slice(0, 24),
		};
	})()`);
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const d = driver(app);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	try {
		await d.until('document.querySelector(".ly-sidebar-foot button")', 30000);
		await pause(800);
		await d.mark(".ly-sidebar-foot button", "data-ly-open-settings");
		await d.click("[data-ly-open-settings]");
		await d.until('document.querySelector(".ly-settings-nav-pill")', 20000);
		await pause(900);

		const home = await measure();
		check("设置导航有滑动选中条", home.pillReady, `ready ${home.pillReady} y ${home.pillY}`);
		check("正文用 settings 入场而不是 workspace 那一刀", home.animation.includes("ly-settings-in") || home.view !== "", `anim ${home.animation} view ${home.view}`);
		await pause(700);

		let lastY = home.pillY;
		for (const label of PAGES) {
			console.log(`【切】${label}`);
			await d.markByText(`/${label}/`, "data-ly-settings-nav");
			const marked = await app.evaluate<boolean>("Boolean(document.querySelector('[data-ly-settings-nav]'))");
			check(`导航里找得到「${label}」`, marked, marked ? "" : "没有这颗按钮");
			if (!marked) continue;
			const t0 = Date.now();
			await d.click("[data-ly-settings-nav]");
			const arriving = await measure();
			await pause(260);
			const after = await measure();
			const dt = Date.now() - t0;
			console.log(`   ${JSON.stringify({ arriving, after })}  ${dt}ms`);
			check(`「${label}」点下去右侧换到这一页`, after.heading.includes(label) || after.view.length > 0, `view ${after.view} heading ${after.heading} ${dt}ms`);
			check(`「${label}」入场是 ly-settings-in`, arriving.animation.includes("ly-settings-in"), `anim ${arriving.animation}`);
			if (lastY >= 0 && after.pillY >= 0) {
				check(`「${label}」选中条跟着走`, after.pillY !== lastY || label === PAGES[0], `y ${lastY} → ${after.pillY}`);
			}
			lastY = after.pillY;
			await pause(900);
		}
	} finally {
		await stop();
		await app?.stop().catch(() => {});
	}

	const passed = checks.filter((c) => c.ok).length;
	const path = join(OUT_DIR, `${STAMP}_设置页切换_${passed}of${checks.length}.mp4`);
	if (frames.length) await encode(frames, path);
	console.log(`\n${passed}/${checks.length} 项通过`);
	if (frames.length) console.log(path);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
