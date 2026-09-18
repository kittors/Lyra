/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 真数据上点会话：行亮起来的同一拍，右侧离开上一份转录。
 *
 * 用法：node --experimental-strip-types e2e/session-switch-demo.ts [输出目录]
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "会话切换跟手测试");
const PORT = 9545;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
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
		await pause(1000);
		const titles = await app.evaluate<string[]>(
			`[...document.querySelectorAll("[data-ly-row]")].map((r) => (r.innerText || "").split("\\n")[0].trim()).filter(Boolean)`,
		);
		const sample = titles.filter((title, index) => index > 0).slice(0, 6);
		check("侧边栏里有真实会话", titles.length >= 4, `${titles.length} 行`);

		for (const title of sample) {
			const marked = await app.evaluate<boolean>(`(() => {
				document.querySelector("[data-ly-switch-row]")?.removeAttribute("data-ly-switch-row");
				const want = ${JSON.stringify(title)};
				const row = [...document.querySelectorAll("[data-ly-row]")].find((r) => (r.innerText || "").includes(want));
				if (!row) return false;
				row.setAttribute("data-ly-switch-row", "");
				row.scrollIntoView({ block: "center" });
				return true;
			})()`);
			if (!marked) continue;
			const before = await app.evaluate<string>(
				`(() => { const el = document.querySelector("[data-ly-session]"); return el ? el.getAttribute("data-ly-session") || "" : ""; })()`,
			);
			const point = await app.evaluate<{ x: number; y: number }>(
				`(() => { const r = document.querySelector("[data-ly-switch-row] button").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
			);
			const t0 = Date.now();
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
			}
			let leave = -1;
			for (let i = 0; i < 30; i++) {
				const now = await app.evaluate<{ id: string; busy: boolean }>(`(() => {
					const el = document.querySelector("[data-ly-session]");
					return {
						id: el ? el.getAttribute("data-ly-session") || "" : "",
						busy: Boolean(document.querySelector("[aria-busy=true]")),
					};
				})()`);
				if (now.id !== before || now.busy) {
					leave = Date.now() - t0;
					break;
				}
				await pause(16);
			}
			console.log(`   「${title.slice(0, 28)}」离场 ${leave}ms`);
			check(`「${title.slice(0, 18)}」点下去右侧马上离开上一份`, leave >= 0 && leave < 80, `${leave}ms`);
			await pause(1100);
		}
	} finally {
		await stop();
		await app?.stop().catch(() => {});
	}

	const passed = checks.filter((c) => c.ok).length;
	const path = join(OUT_DIR, `${STAMP}_会话切换跟手_${passed}of${checks.length}.mp4`);
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
