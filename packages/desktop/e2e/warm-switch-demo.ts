/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 已加载过的大会话来回切：树要留着，右侧要马上换，不能再卡一帧拆二十行。
 *
 * 用法：node --experimental-strip-types e2e/warm-switch-demo.ts [输出目录]
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "热切换掉帧测试");
const PORT = 9563;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const HUGE = [
	"313a449a-2e92-46a0-94be-e7ed80da12de",
	"2723f0cb-add6-415f-aa94-dff71d02aa7b",
	"3fcaab45-7b41-4c04-93ee-19053be89e46",
	"2132910f-4875-4cfc-9028-0a2b990e22e2",
	"19e88370-9561-4627-a871-c5d02a650b93",
];

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function clickRow(id: string): Promise<boolean> {
	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const e = document.querySelector('[data-ly-row=${JSON.stringify(id)}]');
		if (!e) return null;
		e.scrollIntoView({ block: "center" });
		const r = e.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	return true;
}

async function visibleSession(): Promise<string> {
	return app.evaluate<string>(`(() => {
		const live = document.querySelector('[data-active="true"] [data-ly-session], [data-ly-session]');
		return live ? live.getAttribute("data-ly-session") || "" : "";
	})()`);
}

async function revealHuge(): Promise<string[]> {
	await app.evaluate(`document.querySelector('[data-ly-tab="chats"]')?.click()`);
	await pause(400);
	for (let i = 0; i < 12; i++) {
		const found = await app.evaluate<string[]>(
			`[${HUGE.map((id) => JSON.stringify(id)).join(",")}].filter((id) => document.querySelector('[data-ly-row="' + id + '"]'))`,
		);
		if (found.length >= 2) return found;
		const expanded = await app.evaluate<boolean>(`(() => {
			const buttons = [...document.querySelectorAll("button")].filter((b) => /Show \\d+ more|展开显示|展開顯示/.test(b.textContent || ""));
			if (!buttons.length) return false;
			buttons[0].click();
			return true;
		})()`);
		if (!expanded) break;
		await pause(200);
	}
	return app.evaluate<string[]>(
		`[${HUGE.map((id) => JSON.stringify(id)).join(",")}].filter((id) => document.querySelector('[data-ly-row="' + id + '"]'))`,
	);
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	console.log("复制本机 ~/.lyra（凭据已剔）…");
	app = await startApp({ port: PORT, seed: seedFromReal });
	const d = driver(app);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	try {
		await d.until('document.querySelector("[data-ly-row]")', 40000);
		await pause(800);
		const huge = await revealHuge();
		const a = huge[0];
		const b = huge[1];
		check("侧边栏里能看见两个大会话", Boolean(a && b && a !== b), `${huge.length} 个`);
		if (!a || !b) throw new Error("need two huge sessions");

		console.log("\n【冷】先打开两份，让缓存和树都在");
		for (const id of [a, b]) {
			if (!(await clickRow(id))) throw new Error(`click ${id} failed`);
			await pause(1400);
		}
		const treesAfterCold = await app.evaluate<number>(`document.querySelectorAll("[data-ly-session]").length`);
		check("两份大会话打开后树上留着两棵转录", treesAfterCold >= 2, `${treesAfterCold} 棵`);

		console.log("\n【热】再来回切四次");
		for (const id of [a, b, a, b]) {
			const before = await visibleSession();
			const t0 = Date.now();
			if (!(await clickRow(id))) throw new Error(`click ${id} failed`);
			let leave = -1;
			for (let i = 0; i < 40; i++) {
				const now = await visibleSession();
				if (now === id && now !== before) {
					leave = Date.now() - t0;
					break;
				}
				await pause(16);
			}
			const trees = await app.evaluate<number>(`document.querySelectorAll("[data-ly-session]").length`);
			console.log(`   ${id.slice(0, 8)} 离场 ${leave}ms  树 ${trees}`);
			check(`热切 ${id.slice(0, 8)} 右侧马上换过来`, leave >= 0 && leave < 80, `${leave}ms`);
			check(`热切 ${id.slice(0, 8)} 上一份还在树上`, trees >= 2, `${trees} 棵`);
			await pause(1100);
		}
	} finally {
		await stop();
		await app?.stop().catch(() => {});
	}

	const passed = checks.filter((c) => c.ok).length;
	const path = join(OUT_DIR, `${STAMP}_热切换掉帧_${passed}of${checks.length}.mp4`);
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
