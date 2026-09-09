/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 在每一块屏幕上各截一次，看拍回来的是不是那一块。
 *
 * 起因是有人在 Windows 上报「不能跨屏幕截图」。根因在 Electron 里：Windows 走 GDI 抓屏时
 * `desktopCapturer` 根本不填 `display_id`（只有 DirectX 那条路填），而原来的挑选逻辑配不上就退回
 * `sources[0]`——第一块屏，通常是主屏。于是在副屏上按快捷键，遮罩正确地盖住了副屏，画面却是主屏
 * 的。`test/screenshot-display-source.test.ts` 把新的挑选规则逐条钉住了，这里是它在真机上的对照：
 * 光标真的挪到那一块屏幕上，真的按下快捷键，然后从抓屏日志里读回来四件事——
 *
 *   1. 挑中的画面属于哪一块屏（`snapshot: source picked` 里的 `how` 和 `picked`）；
 *   2. 那张画面的尺寸对不对得上这块屏的物理像素；
 *   3. 遮罩窗口有没有落在这块屏上、盖没盖满（`after setBounds`）；
 *   4. 色彩空间是不是按这块屏自己的来——这台机器上内建屏是 P3、外接屏是 BT709，两块屏答案不同，
 *      恰好能证明它读的是各自的显示器而不是一个写死的值。
 *
 * 单屏机器上它只会跑一遍，仍然有用：那正好是「只有一张画面」那条捷径。
 *
 * 用法：node --experimental-strip-types e2e/multi-display-capture-probe.ts
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp } from "./app.ts";

const execFileAsync = promisify(execFile);
const PORT = 9494;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const problems: string[] = [];
const note = (line: string) => console.log(line);
const check = (ok: boolean, complaint: string) => {
	if (!ok) problems.push(complaint);
};

interface DisplayInfo {
	id: number;
	label: string;
	bounds: { x: number; y: number; width: number; height: number };
	scaleFactor: number;
	colorSpace: string;
}

/**
 * 把真实的鼠标指针挪到某个点。
 *
 * 截图开在哪一块屏幕上，是主进程用 `screen.getCursorScreenPoint()` 决定的——这是全系统的指针位置，
 * 合成事件动不了它。所以要真的挪。走开发者工具自带的 python 调 `CGWarpMouseCursorPosition`：不用
 * 编译、不用辅助功能授权、不在磁盘上留东西。
 */
async function warpCursor(x: number, y: number): Promise<boolean> {
	if (process.platform !== "darwin") return false;
	return execFileAsync("python3", [
		"-c",
		[
			"import ctypes, ctypes.util",
			"lib = ctypes.cdll.LoadLibrary(ctypes.util.find_library('ApplicationServices'))",
			"class P(ctypes.Structure): _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]",
			"lib.CGWarpMouseCursorPosition.argtypes = [P]",
			`lib.CGWarpMouseCursorPosition(P(${x}.0, ${y}.0))`,
		].join("\n"),
	]).then(() => true, () => false);
}

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
			screenshot: { enabled: true, shortcut: "", saveLocation: "", downloadLocation: "", openEditor: true, copyToClipboard: false, insertIntoComposer: false, showInComposer: false },
		}),
	);
}

const app = await startApp({ port: PORT, seed });

/**
 * 最后那一次截图的日志，拆成「这件事」加「这些数」。
 *
 * 日志是追加的，每次截图开头写一行 `===== capture #N`——所以只取最后一段，否则读到的是上一块屏幕
 * 的答案，而这个探针整个是在比较不同屏幕的答案。
 *
 * 每行长这样：`#07 [+  144ms] snapshot: taken {"getSources":134,…}`。事件名里有冒号也有空格，所以
 * 边界取的是第一个 ` {`——后面那段一定是 JSON，前面那段一定是名字。
 */
async function captureLog(home: string): Promise<{ what: string; detail: Record<string, unknown> }[]> {
	const text = await readFile(join(home, "screenshot-debug.log"), "utf8").catch(() => "");
	const last = text.split("===== capture").at(-1) ?? "";
	return last
		.split("\n")
		.map((line) => /^#\d+ \[\s*\+\s*\d+ms\] (.*)$/.exec(line.trim())?.[1])
		.filter((rest): rest is string => Boolean(rest))
		.map((rest) => {
			const at = rest.indexOf(" {");
			if (at < 0) return { what: rest, detail: {} };
			try {
				return { what: rest.slice(0, at), detail: JSON.parse(rest.slice(at + 1)) as Record<string, unknown> };
			} catch {
				return { what: rest.slice(0, at), detail: {} };
			}
		});
}

try {
	await pause(2600);

	const displays = await app.evaluate<DisplayInfo[]>(`(async () => {
		const all = await window.lyra.screenshot.displays?.();
		return all ?? [];
	})()`).catch(() => [] as DisplayInfo[]);

	/*
	 * 渲染进程问不到显示器，就自己起一个 Electron 问。
	 *
	 * 应用本身没有「把显示器列表交给页面」这个接口，而为了一个探针在 IPC 上开一个口子，是让被测的
	 * 东西为测试改形状。另起一个进程读一遍，读到的是同一个系统。
	 */
	const list: DisplayInfo[] =
		displays.length > 0
			? displays
			: await (async () => {
					const script = join(app.home, "displays.mjs");
					await writeFile(
						script,
						[
							'import { app, screen } from "electron";',
							"app.whenReady().then(() => {",
							'  console.log("DISPLAYS " + JSON.stringify(screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, bounds: d.bounds, scaleFactor: d.scaleFactor, colorSpace: String(d.colorSpace) }))));',
							"  app.quit();",
							"});",
						].join("\n"),
					);
					const { stdout } = await execFileAsync("pnpm", ["exec", "electron", script], { cwd: process.cwd(), timeout: 60_000 });
					const line = stdout.split("\n").find((l) => l.startsWith("DISPLAYS "));
					return line ? (JSON.parse(line.slice(9)) as DisplayInfo[]) : [];
				})();

	check(list.length > 0, "读不到显示器列表");
	note(`\n这台机器上有 ${list.length} 块屏幕：`);
	for (const display of list) {
		note(`  #${display.id} ${display.label} ${display.bounds.width}×${display.bounds.height} @${display.scaleFactor}x，在 (${display.bounds.x}, ${display.bounds.y})，${/primaries:P3/.test(display.colorSpace) ? "P3" : "sRGB"}`);
	}
	if (list.length === 1) note("  （只有一块，跑到的是「只有一张画面」那条捷径——多屏那几条要接上第二块屏才量得到）");

	for (const display of list) {
		const centre = {
			x: Math.round(display.bounds.x + display.bounds.width / 2),
			y: Math.round(display.bounds.y + display.bounds.height / 2),
		};
		note(`\n── 在 #${display.id}（${display.label}）上截一次 ──`);
		const warped = await warpCursor(centre.x, centre.y);
		if (!warped) {
			note("  挪不动真实指针，跳过这一块——截图开在哪一块屏是按系统指针位置决定的");
			continue;
		}
		await pause(400);

		await app.evaluate(`window.lyra.screenshot.start().catch(() => {})`);
		await pause(1400);

		const log = await captureLog(app.home);
		const picked = log.find((entry) => entry.what === "snapshot: source picked");
		const taken = log.find((entry) => entry.what === "snapshot: taken");
		const bounds = log.find((entry) => entry.what === "after setBounds");
		const chosen = log.find((entry) => entry.what === "display");

		// Escape，把遮罩收掉，好让下一块屏从头来。
		await app.evaluate(`window.lyra.screenshot.cancel?.()`).catch(() => {});
		await pause(700);

		if (!picked || !taken) {
			check(false, `#${display.id} 上没截成——日志里没有 snapshot 的记录`);
			note(`  日志里有：${log.map((e) => String(e.what)).join("、") || "（空）"}`);
			continue;
		}

		const how = picked.detail.how;
		const pickedInfo = picked.detail.picked as { displayId?: string; size?: { width: number; height: number } } | undefined;
		const shot = taken.detail as { size?: { width: number; height: number }; colorSpace?: string };
		const window = bounds?.detail as { asked?: Record<string, number>; got?: Record<string, number>; retried?: boolean } | undefined;
		const openedOn = chosen?.detail.id;

		const physical = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
		const wantSpace = /primaries:P3/.test(display.colorSpace) ? "display-p3" : "srgb";

		note(`  开在 #${openedOn}，挑画面靠的是「${how}」，挑中 displayId=${pickedInfo?.displayId || "(空)"}`);
		note(`  画面 ${shot?.size?.width}×${shot?.size?.height}，这块屏的物理像素是 ${physical.width}×${physical.height}`);
		note(`  色彩空间 ${shot?.colorSpace}（这块屏是 ${wantSpace}）`);
		note(`  遮罩 ${JSON.stringify(window?.got)}，要的是 ${JSON.stringify(window?.asked)}${window?.retried ? "（重设过一次）" : ""}`);

		check(openedOn === display.id, `#${display.id}：指针在这块屏上，截图却开在了 #${openedOn}`);
		check(
			shot?.size?.width === physical.width && shot?.size?.height === physical.height,
			`#${display.id}：拍回来的画面是 ${shot?.size?.width}×${shot?.size?.height}，这块屏是 ${physical.width}×${physical.height}——多半挑到了别的屏幕`,
		);
		check(shot?.colorSpace === wantSpace, `#${display.id}：色彩空间答的是 ${shot?.colorSpace}，这块屏是 ${wantSpace}`);
		check(
			Math.abs((window?.got?.width ?? 0) - display.bounds.width) <= 1 && Math.abs((window?.got?.height ?? 0) - display.bounds.height) <= 1,
			`#${display.id}：遮罩没盖满这块屏——${JSON.stringify(window?.got)} vs ${JSON.stringify(display.bounds)}`,
		);
		check(
			Math.abs((window?.got?.x ?? 0) - display.bounds.x) <= 1 && Math.abs((window?.got?.y ?? 0) - display.bounds.y) <= 1,
			`#${display.id}：遮罩没落在这块屏上——${JSON.stringify(window?.got)} vs ${JSON.stringify(display.bounds)}`,
		);
	}

	note("");
	if (problems.length === 0) note("全部通过。");
	else {
		note(`${problems.length} 处不对：`);
		for (const problem of problems) note(`  ✗ ${problem}`);
	}
} finally {
	await app.stop();
}

process.exit(problems.length === 0 ? 0 : 1);
