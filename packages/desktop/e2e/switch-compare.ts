/* oxlint-disable no-console -- before/after numbers for the two switch paths */
/**
 * 同一套真窗口量法，把改后的数打出来，好和仓库里改前的下限对照。
 *
 * 用法：node --experimental-strip-types e2e/switch-compare.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { driver, pause } from "./record.ts";

const PORT = 9557;
let app: RunningApp;

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function clickPoint(x: number, y: number): Promise<void> {
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	}
}

async function sessionLeave(title: string): Promise<{ leave: number; busy: boolean; idChanged: boolean } | null> {
	const marked = await evaluate<boolean>(`(() => {
		document.querySelector("[data-ly-cmp-row]")?.removeAttribute("data-ly-cmp-row");
		const want = ${JSON.stringify(title)};
		const row = [...document.querySelectorAll("[data-ly-row]")].find((r) => (r.innerText || "").includes(want));
		if (!row) return false;
		row.setAttribute("data-ly-cmp-row", "");
		row.scrollIntoView({ block: "center" });
		return true;
	})()`);
	if (!marked) return null;
	const before = await evaluate<string>(
		`(() => { const el = document.querySelector("[data-ly-session]"); return el ? el.getAttribute("data-ly-session") || "" : ""; })()`,
	);
	const point = await evaluate<{ x: number; y: number }>(
		`(() => { const r = document.querySelector("[data-ly-cmp-row] button").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
	);
	const t0 = Date.now();
	await clickPoint(point.x, point.y);
	for (let i = 0; i < 40; i++) {
		const now = await evaluate<{ id: string; busy: boolean }>(`(() => {
			const el = document.querySelector("[data-ly-session]");
			return { id: el ? el.getAttribute("data-ly-session") || "" : "", busy: Boolean(document.querySelector("[aria-busy=true]")) };
		})()`);
		if (now.id !== before || now.busy) {
			return { leave: Date.now() - t0, busy: now.busy, idChanged: now.id !== before };
		}
		await pause(8);
	}
	return { leave: -1, busy: false, idChanged: false };
}

async function settingsSeed(home: string): Promise<void> {
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
			sync: { enabled: false, port: 4557, token: null },
			appearance: { theme: "light" },
		}),
	);
}

async function measureSettings(): Promise<{
	animation: string;
	duration: string;
	fromOpacity: string;
	pillReady: boolean;
	pillMoved: boolean;
	view: string;
}> {
	return evaluate(`(() => {
		const root = document.querySelector("[data-ly-settings]");
		const page = root && root.querySelector('[data-active="true"]');
		const pill = root && root.querySelector(".ly-settings-nav-pill");
		const style = page ? getComputedStyle(page) : null;
		return {
			animation: style ? style.animationName : "",
			duration: style ? style.animationDuration : "",
			fromOpacity: style ? style.opacity : "",
			pillReady: pill?.getAttribute("data-ready") === "true",
			pillMoved: false,
			view: page?.getAttribute("data-view") || "",
		};
	})()`);
}

async function main(): Promise<void> {
	console.log("════ 会话切换（本机 ~/.lyra）════");
	console.log("改前下限（HEAD 代码，不是感觉）：每次点击先空等 360ms，冷开还要等整份转录，再淡入 340ms。");
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await driver(app).until('document.querySelector("[data-ly-row]")', 40000);
		await pause(600);
		const titles = await evaluate<string[]>(
			`[...document.querySelectorAll("[data-ly-row]")].map((r) => (r.innerText || "").split("\\n")[0].trim()).filter(Boolean)`,
		);
		const sample = titles.filter((_, index) => index > 0).slice(0, 8);
		const rows: { title: string; leave: number }[] = [];
		for (const title of sample) {
			const r = await sessionLeave(title);
			if (!r) continue;
			rows.push({ title, leave: r.leave });
			console.log(`   ${String(r.leave).padStart(4)}ms  ${r.idChanged ? "换了 id" : "只亮 busy"}  ${title.slice(0, 36)}`);
			await pause(400);
		}
		const ok = rows.filter((r) => r.leave >= 0);
		const leaves = ok.map((r) => r.leave).sort((a, b) => a - b);
		const median = leaves[Math.floor(leaves.length / 2)];
		const max = leaves[leaves.length - 1];
		console.log(`量到 ${ok.length} 次。离场中位 ${median}ms，最慢 ${max}ms。改前每次至少 360ms。`);
		if (median == null || median >= 360) {
			console.log("没有改善：中位仍 ≥ 360ms。");
			process.exitCode = 1;
		} else {
			console.log(`有改善：中位从 ≥360ms 降到 ${median}ms（${Math.round((1 - median / 360) * 100)}%）。`);
		}
	} finally {
		await app?.stop().catch(() => {});
	}

	console.log("\n════ 设置页切换 ════");
	console.log("改前：ly-page-in，150ms，从 opacity 0.88 起（几乎看不出），导航选中是瞬间填色。");
	app = await startApp({ port: PORT + 1, seed: settingsSeed });
	const d = driver(app);
	try {
		await d.until('document.querySelector(".ly-sidebar-foot button")', 30000);
		await d.mark(".ly-sidebar-foot button", "data-ly-open-settings");
		await d.click("[data-ly-open-settings]");
		await d.until('document.querySelector("[data-ly-settings] .ly-settings-nav-pill")', 20000);
		await pause(400);
		const firstY = await evaluate<number>(`(() => {
			const pill = document.querySelector("[data-ly-settings] .ly-settings-nav-pill");
			if (!pill) return -1;
			const y = parseFloat(getComputedStyle(pill).transform.split(",")[5] || "0");
			return Number.isFinite(y) ? Math.round(y) : -1;
		})()`);
		await d.markByText("/屏幕截图/", "data-ly-settings-nav");
		await d.click("[data-ly-settings-nav]");
		const arriving = await measureSettings();
		await pause(80);
		const later = await measureSettings();
		const secondY = await evaluate<number>(`(() => {
			const pill = document.querySelector("[data-ly-settings] .ly-settings-nav-pill");
			if (!pill) return -1;
			const y = parseFloat(getComputedStyle(pill).transform.split(",")[5] || "0");
			return Number.isFinite(y) ? Math.round(y) : -1;
		})()`);
		console.log(`   入场 ${arriving.animation} / ${arriving.duration}，点完 view=${arriving.view} → ${later.view}`);
		console.log(`   药丸 ${firstY}px → ${secondY}px`);
		const improved =
			arriving.animation.includes("ly-settings-in") &&
			arriving.duration.startsWith("0.22") &&
			secondY !== firstY &&
			later.view === "screenshot";
		if (improved) {
			console.log("有改善：入场从 150ms/0.88 换成 220ms 从 0 淡入上移，选中条跟着走。");
		} else {
			console.log("没有改善：入场或药丸对不上。");
			process.exitCode = 1;
		}
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
