/* oxlint-disable no-console -- probe CLI plumbing that prints what it did and where the film went */
/**
 * Whether the project menu opens where it stays: five opens, the card's position read on every painted frame.
 *
 * `node --experimental-strip-types e2e/popover-first-frame-probe.ts <label> [output dir]`
 *
 * The window is the reported one — 1072×790, fifteen projects — where the list at full length fits
 * neither above nor below the chip but fits below once capped at 340. The first frame used to be
 * placed from the full length and drawn over the chip; the next one, measured again, dropped below
 * it. Positions come from a rAF loop (what each frame was about to paint, see
 * `e2e-measure-painted-frames`), the film from the screencast, which delivers every composited frame
 * — the one-frame jump included, as long as the window is not covered.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, frameGrabber, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9526;
const OPENS = 5;
const NAMES = [
	"quantum", "aurora", "borealis", "cascade", "delta", "ember", "fjord", "glacier",
	"harbor", "island", "jade", "kepler", "lumen", "meadow", "nova",
];

const label = process.argv[2] ?? "run";
// Local time, as the files are named for whoever opens the folder — not UTC.
const now = new Date();
const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
	.map((part) => String(part).padStart(2, "0"))
	.join("-");
const out = process.argv[3] ?? join(homedir(), "Desktop", "Lyra下拉菜单跳动测试");

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1072, height: 790, x: 0, y: 0 }));
	const projects = [];
	for (const [index, name] of NAMES.entries()) {
		const path = join(home, "projects", name);
		await mkdir(path, { recursive: true });
		// The first is the most recent, so it is the one the window opens on.
		projects.push({ id: name, name, path, pinned: false, lastOpenedAt: NAMES.length - index });
	}
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projects[0].path });
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1, providers: [], mcpServers: [], projects,
			appearance: { theme: "light" }, permissionMode: "full",
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4526, token: null },
		}),
	);
}

interface Sample { t: number; top: number | null; height?: number; painted?: number }

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

// The user's own ~/.claude is not this window's business, and must not end up on film.
const claudeHome = await mkdtemp(join(tmpdir(), "lyra-claude-"));
process.env.CLAUDE_CONFIG_DIR = claudeHome;
const app = await startApp({ port: PORT, seed });
const page = await frameGrabber(PORT);
const film: Frame[] = [];
let stopFilm: (() => Promise<void>) | undefined;

const CHIP = `[...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "quantum")`;

try {
	const end = Date.now() + 20000;
	while (!(await page.evaluate<boolean>(`Boolean(${CHIP})`))) {
		if (Date.now() > end) throw new Error("等不到输入框上方的 quantum 按钮");
		await pause(250);
	}
	await pause(1500);
	const view = await page.evaluate<{ width: number; height: number }>(`({ width: innerWidth, height: innerHeight })`);
	console.log(`窗口 ${view.width}×${view.height}（${label}）`);

	stopFilm = await startRecording(PORT, film);
	await pause(1000);

	const press = async (type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number) =>
		page.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });

	const firsts: { at: number; open: number }[] = [];
	for (let open = 1; open <= OPENS; open++) {
		const chip = await page.evaluate<{ x: number; y: number; top: number; bottom: number }>(
			`(() => { const r = ${CHIP}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; })()`,
		);
		await press("mouseMoved", chip.x, chip.y);
		await pause(300);
		await page.evaluate(`(() => { const el = ${CHIP}, x = ${chip.x}, y = ${chip.y}; ${landsOn("the quantum chip")} })()`);

		// Recording starts before the press, so the first frame with the card in it is the first one painted.
		await page.evaluate(`(() => {
			window.__probe = { open: ${open}, samples: [], on: true };
			const tick = (t) => {
				const probe = window.__probe;
				if (!probe.on) return;
				const card = document.querySelector("[data-ly-popover]");
				if (card && !card.dataset.probeOpen) card.dataset.probeOpen = String(probe.open);
				if (card && card.dataset.probeOpen === String(probe.open)) {
					probe.samples.push({ t: Math.round(t), top: card.offsetTop, height: card.offsetHeight, painted: Math.round(card.getBoundingClientRect().top) });
				} else probe.samples.push({ t: Math.round(t), top: null });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		})()`);
		await pause(100);
		firsts.push({ at: Date.now(), open });
		await press("mousePressed", chip.x, chip.y);
		await press("mouseReleased", chip.x, chip.y);
		await pause(900);

		const samples = await page.evaluate<Sample[]>(`(() => { window.__probe.on = false; return window.__probe.samples; })()`);
		const shown = samples.filter((s) => s.top !== null);
		const tops = [...new Set(shown.map((s) => s.top))];
		const first = shown[0];
		const last = shown.at(-1);
		console.log(`第 ${open} 次：按钮 ${Math.round(chip.top)}–${Math.round(chip.bottom)}，菜单逐帧 top = ${shown.map((s) => s.top).join(" → ")}`);
		check(
			`第 ${open} 次打开：第一帧就画在按钮下方，之后 ${shown.length - 1} 帧没挪过`,
			Boolean(first && last) && tops.length === 1 && (first?.top ?? 0) >= chip.bottom,
			`第一帧 top=${first?.top}、最后 top=${last?.top}，出现过的位置 ${tops.join("、")}`,
		);

		// Close it the way the recording did — the chip again — and wait out the exit.
		await press("mousePressed", chip.x, chip.y);
		await press("mouseReleased", chip.x, chip.y);
		await pause(1000);
	}

	await stopFilm();
	stopFilm = undefined;
	await mkdir(out, { recursive: true });
	const passed = checks.filter((c) => c.ok).length;
	const name = `${stamp}_${label}_项目菜单连开${OPENS}次_${passed}of${checks.length}`;
	await encode(film, join(out, `${name}.mp4`), 60);

	/*
	 * The first open again at a tenth of the speed: a jump that lasts one frame is gone before the
	 * eye finds it at full speed. Each frame is held ten times as long as it really was.
	 */
	const at = firsts[0].at;
	const around = film.filter((f) => f.at >= at - 300 && f.at <= at + 600);
	await encode(around.map((f) => ({ at: at + (f.at - at) * 10, data: f.data })), join(out, `${name}_第1次慢放10倍.mp4`), 60);

	// The first frames after each press, as stills: the jump, if there is one, is the first of them.
	for (const { at: pressed, open } of firsts.slice(0, 2)) {
		const after = film.filter((f) => f.at > pressed).slice(0, 4);
		for (const [index, frame] of after.entries()) {
			await writeFile(join(out, `${stamp}_${label}_第${open}次打开_第${index + 1}帧.jpg`), frame.data);
		}
	}
	console.log(`\n${passed}/${checks.length} 通过；录像 ${film.length} 帧，放在 ${out}`);
	process.exitCode = passed === checks.length ? 0 : 1;
} catch (error) {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 2;
} finally {
	await stopFilm?.().catch(() => {});
	page.close();
	await app.stop();
	await rm(claudeHome, { recursive: true, force: true });
}
