/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Where a branch name dissolves on hover in the Git panel's branch list, measured in a real window.
 *
 * `node --experimental-strip-types e2e/branch-row-hover-probe.ts [dir] [port]`
 *
 * The current branch's row has no hover buttons, yet it gave way a fixed 36px: on hover the mask
 * cleared 36px off the name's tail for nothing, and `ScrollText` counted that run as unreadable, so
 * a name that fits started scrolling. Rows with buttons are the control group: there the strip
 * measures how much of the name it covers, and the dissolve has to end right at the buttons.
 *
 * Everything judged is what was painted (see `branch-row-gauge.ts`), driven by real pointer events
 * through the debugger, since `:hover` cannot be produced from inside the page. `--ly-row-controls`
 * is printed only to reconcile against.
 */

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp } from "./app.ts";
import { install, type Frame, type Point, type Read } from "./branch-row-gauge.ts";
import { frameGrabber } from "./record.ts";

const dir = process.argv[2] ?? "/tmp/lyra-branch-row-hover";
const port = Number(process.argv[3] ?? 9823);

/** Sized against the panel's default width: FITS fits the current row's name box with under 36px to spare. */
const FITS = "fix/current-branch-row-fade";
const LONG = "codex/fix-git-panel-current-branch-row-hover-fade-yield-width";
const REMOTE = "release/2026.09-branch-row-hover-remote-only";
const SESSION = "branch-hover-0";

// The Command Line Tools' git: a full Xcode whose licence nobody accepted makes every git call exit 69.
const CLT = "/Library/Developer/CommandLineTools";
const gitEnv = existsSync(CLT) ? { ...process.env, DEVELOPER_DIR: CLT } : process.env;
const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, env: gitEnv });

async function seed(home: string): Promise<void> {
	const repo = join(home, "work", "branch-hover");
	const origin = join(home, "origin.git");
	await mkdir(repo, { recursive: true });
	await git(home, "init", "-q", "--bare", origin);
	await git(repo, "init", "-q", "-b", "main");
	await git(repo, "config", "user.email", "probe@example.com");
	await git(repo, "config", "user.name", "probe");
	await writeFile(join(repo, "README.md"), "# probe\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-qm", "seed");
	for (const name of [FITS, LONG, REMOTE]) await git(repo, "branch", name);
	await git(repo, "remote", "add", "origin", origin);
	await git(repo, "push", "-q", "-u", "origin", "main", REMOTE);
	// Only on the remote, so the list keeps it: remotes with a local twin are filtered out.
	await git(repo, "branch", "-D", REMOTE);

	const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
	const id = createHash("sha256").update(repo).digest("hex").slice(0, 16);
	const messages = [
		{ role: "user", content: [{ type: "text", text: "问" }], timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "答" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
	];
	const meta = { id: SESSION, title: "分支行悬停", cwd: repo, projectId: id, projectName: "branch-hover", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, modelId: "test", messageCount: 2, usage, seq: 3 };
	await mkdir(join(home, "sessions", id), { recursive: true });
	// The outer seq starts at 1: a meta written at 0 is read away and the session never reaches the sidebar.
	const lines = [{ seq: 1, ts: 1, type: "meta", meta: { ...meta, seq: 0 } }, ...messages.map((message, i) => ({ seq: i + 2, ts: i + 2, type: "message", message })), { seq: 4, ts: 3, type: "meta", meta }];
	await writeFile(join(home, "sessions", id, `${SESSION}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800, x: 40, y: 40 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({ projects: [{ id, name: "branch-hover", path: repo, pinned: false, lastOpenedAt: 1 }], appearance: { theme: "light" } }));
}

type Entry = { label: string; name: string; rest: Read; hot: Read; early: Read; after: Read; frames: Frame[] };

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const app = await startApp({ port, seed });
const page = await frameGrabber(port);
let failures = 0;
const check = (label: string, passed: boolean, evidence: string) => {
	if (!passed) failures++;
	console.log(`${passed ? "✅" : "❌"} ${label}\n     ${evidence}`);
};
const mouse = (type: string, x: number, y: number) =>
	page.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
const read = (name: string) => page.evaluate<Read | null>(`window.__lyBranch.read(${JSON.stringify(name)})`);
const point = (name: string, what: "name" | "switch") => page.evaluate<Point | null>(`window.__lyBranch.point(${JSON.stringify(name)}, "${what}")`);
async function until(expression: string, ms = 15_000): Promise<void> {
	for (const end = Date.now() + ms; Date.now() < end; ) {
		if (await page.evaluate<boolean>(`Boolean(${expression})`)) return;
		await settle(100);
	}
	throw new Error(`等不到：${expression}`);
}
/** A real press where the element is drawn, checked with elementFromPoint first so a miss is not silent. */
async function click(where: Point | null, what: string): Promise<void> {
	if (!where?.lands) throw new Error(`点不到${what}`);
	await mouse("mouseMoved", where.x, where.y);
	await settle(150);
	await mouse("mousePressed", where.x, where.y);
	await mouse("mouseReleased", where.x, where.y);
}
const centre = (selector: string) =>
	page.evaluate<Point | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
		return { x, y, lands: el.contains(document.elementFromPoint(x, y)) };
	})()`);

try {
	await mkdir(dir, { recursive: true });
	await until(`document.querySelector('[data-ly-row="${SESSION}"] > button')`);
	await click(await centre(`[data-ly-row="${SESSION}"] > button`), "会话行");
	await until("document.querySelector('main textarea')");
	await page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', metaKey: true, shiftKey: true, bubbles: true }))");
	await until(`document.querySelector('[data-dock-pane="review"] [aria-label="分支"]')`);
	await click(await centre('[data-dock-pane="review"] [aria-label="分支"]'), "分支页签");
	await until(`document.querySelectorAll('[data-dock-pane="review"] [data-ly-branch-name]').length >= 5`);
	await settle(800);
	await page.evaluate(`(${install.toString()})()`);

	const pane = await page.evaluate<{ left: number; right: number; top: number; dpr: number }>(`(() => { const b = document.querySelector('[data-dock-pane="review"]').getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, dpr: devicePixelRatio }; })()`);
	const away = { x: Math.round(pane.left / 2), y: 560 };
	const names = await page.evaluate<string[]>("window.__lyBranch.names()");
	console.log(`Git 面板 x ${Math.round(pane.left)}–${Math.round(pane.right)}，DPR ${pane.dpr}`);
	let listBottom = 0;
	for (const name of names) {
		const r = await read(name);
		if (!r) continue;
		listBottom = Math.max(listBottom, r.bottom);
		console.log(`  ${name.padEnd(64)} 盒 ${r.box.left}–${r.box.right}（宽 ${Math.round((r.box.right - r.box.left) * 10) / 10}）文字宽 ${r.textWidth}  ${r.current ? `当前（标签 x ${r.tagLeft}）` : `${r.strip?.buttons} 颗按钮`}`);
	}

	/** Whole window, then cropped to the panel: a `clip`ped capture has shown a frame older than the readings. */
	async function snap(file: string, top: number, bottom: number): Promise<void> {
		const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const whole = `${file}.whole.png`;
		await writeFile(whole, Buffer.from(shot.data, "base64"));
		const px = (v: number) => String(Math.round(v * pane.dpr));
		execFileSync("sips", ["-c", px(bottom - top), px(pane.right - pane.left), "--cropOffset", px(top), px(pane.left), whole, "--out", file], { stdio: "ignore" });
		await rm(whole, { force: true });
	}
	const snapRow = (file: string, row: Read) => snap(file, row.top - 22, row.bottom + 22);

	async function measure(name: string, label: string): Promise<Entry> {
		for (let attempt = 1; ; attempt++) {
			await mouse("mouseMoved", away.x, away.y);
			await settle(600);
			const rest = (await read(name)) as Read;
			await snapRow(join(dir, `${label}-1静止.png`), rest);
			const at = (await point(name, "name")) as Point;
			await page.evaluate(`window.__lyBranch.track(${JSON.stringify(name)}, 96)`);
			await mouse("mouseMoved", at.x, at.y);
			await settle(120);
			// A second move re-asserts the hover if the real pointer crossed the window meanwhile.
			await mouse("mouseMoved", at.x + 1, at.y);
			await settle(110);
			const early = (await read(name)) as Read;
			await snapRow(join(dir, `${label}-2悬停230ms.png`), early);
			await settle(1370);
			const frames = await page.evaluate<Frame[]>("window.__lyBranch.frames()");
			const hot = (await read(name)) as Read;
			await snapRow(join(dir, `${label}-3悬停1.6s.png`), hot);
			if (hot.current) await snap(join(dir, `${label}-4面板.png`), pane.top, listBottom + 16);
			await mouse("mouseMoved", away.x, away.y);
			await settle(700);
			const after = (await read(name)) as Read;
			const held = hot.hovered && early.hovered && frames.filter((f) => f.t > 200).every((f) => f.hovered) && !rest.hovered && !after.hovered;
			if (held || attempt === 3) return { label, name, rest, hot, early, after, frames };
			console.log(`   ⚠️ ${label} 第 ${attempt} 轮悬停被真实鼠标打断，重量`);
		}
	}

	/** Through the row's own switch button, the way anyone makes a branch current. */
	async function switchTo(name: string): Promise<void> {
		const row = (await point(name, "name")) as Point;
		await mouse("mouseMoved", row.x, row.y);
		await settle(300);
		await click(await point(name, "switch"), `「${name}」的切换按钮`);
		await until(`window.__lyBranch.read(${JSON.stringify(name)})?.current`);
		await settle(800);
	}

	const report: Entry[] = [];
	report.push(await measure("main", "当前·短名"));
	report.push(await measure(LONG, "本地·放不下·三颗按钮"));
	report.push(await measure(`origin/${REMOTE}`, "远程·放不下·两颗按钮"));
	await switchTo(FITS);
	report.push(await measure(FITS, "当前·装得下"));
	await switchTo(LONG);
	report.push(await measure(LONG, "当前·放不下"));
	await mouse("mouseMoved", away.x, away.y);
	await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));

	console.log("\n行                     盒右  文字宽  行控件(悬)  判定(悬)   化没处 静→悬 [距盒右]      按钮左  位移(悬)");
	for (const r of report) {
		const span = (x: number) => `${x}[${Math.round((r.rest.box.right - x) * 10) / 10}]`;
		console.log(
			`${r.label.padEnd(18)}  ${String(r.rest.box.right).padStart(6)}  ${String(r.rest.textWidth).padStart(5)}  ${r.hot.controls.padStart(9)}  ${String(r.hot.fit).padStart(8)}  ` +
				`${span(r.rest.maskEnd)} → ${span(r.hot.maskEnd)}`.padStart(26) +
				`  ${String(r.hot.strip?.left ?? "-").padStart(6)}  ${Math.min(...r.frames.map((f) => f.offset))}${r.hot.hovered ? "" : "（没悬着）"}`,
		);
	}
	console.log("");

	for (const r of report) {
		if (!r.hot.hovered || r.frames.length < 60) {
			check(`${r.label}：量到了悬停态`, false, `悬停 ${r.hot.hovered}，逐帧记录 ${r.frames.length} 帧（要 60 帧以上）`);
			continue;
		}
		if (r.name === FITS) {
			const room = Math.round((r.rest.box.right - r.rest.box.left) * 10) / 10;
			check("探针自检：这个名字装得下，但离右缘不到 36px", r.rest.textWidth > room - 36 && r.rest.textWidth <= room, `文字宽 ${r.rest.textWidth}，当前行的名字盒宽 ${room}`);
		}
		if (r.rest.current) {
			// No buttons land on this row, so hovering must not move where the name dissolves.
			const drift = Math.round((r.rest.maskEnd - r.hot.maskEnd) * 10) / 10;
			check(`${r.label}：悬停时名字化没的位置不动`, Math.abs(drift) <= 0.5, `遮罩尽头 静止 ${r.rest.maskEnd} → 悬停 ${r.hot.maskEnd}（左移 ${drift}px）；「当前」标签从 ${r.rest.tagLeft} 起；行控件 ${r.hot.controls}`);
			if (r.rest.textWidth <= r.rest.box.right - r.rest.box.left) {
				const moved = r.frames.filter((f) => Math.abs(f.offset) > 0.5);
				check(`${r.label}：装得下的名字悬停全程不滚`, moved.length === 0 && r.hot.fit === null, moved.length === 0 ? `${r.frames.length} 帧位移都是 0，判定 ${r.hot.fit}` : `${moved.length} 帧有位移，最远 ${Math.min(...moved.map((f) => f.offset))}px，判定 ${r.hot.fit}`);
				check(`${r.label}：悬停时名字末端完好`, r.early.alphaAtTextEnd >= 0.98, `悬停 230ms 末端 alpha ${r.early.alphaAtTextEnd}（静止 ${r.rest.alphaAtTextEnd}）`);
			}
		} else if (r.hot.strip) {
			const gap = Math.round((r.hot.strip.left - r.hot.maskEnd) * 10) / 10;
			const { covered } = r.hot.strip;
			check(`${r.label}：化没处贴着按钮条（0–4px），让位是量出来的`, gap >= -0.5 && gap <= 4 && r.hot.controls === `${covered}px`, `遮罩尽头到按钮左缘 ${gap}px；行控件 ${r.hot.controls}，按钮压住名字 ${covered}px`);
		}
	}
	console.log(`\n截图与报告：${dir}\n${failures === 0 ? "全部通过" : `${failures} 条不通过`}`);
} finally {
	page.close();
	await app.stop();
}
process.exit(failures === 0 ? 0 : 1);
