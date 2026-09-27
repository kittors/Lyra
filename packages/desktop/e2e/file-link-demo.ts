/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A recording of the two exits beside a file link: a real window, a real hover, real tooltips.
 *
 * What it has to show, in order:
 *
 *   1. At rest there is nothing — the icons take no attention, a line of text is a line of text
 *   2. With the pointer resting on the chip, they fade in inside a small bar above it (right above
 *      the pointer), and not one letter of the filename is covered
 *   3. Resting on an icon, the tooltip says what it is (open with the default app / reveal in Finder)
 *   4. Pointer gone, the bar waits a moment and then fades — time for a pointer on its way over
 *
 * It records the window, not the screen: a full-screen capture would take in whatever else is open
 * on this machine. How recording works is in `record.ts`; this file is only the script.
 *
 * Usage: node --experimental-strip-types e2e/file-link-demo.ts [output file]
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT = process.argv[2] ?? join(homedir(), "Downloads", "lyra-file-link.mp4");
const PORT = 9427;

/*
 * 让模型产出一个**指向真实文件**的 markdown 链接。
 *
 * 说「一行字」是因为要拍的是那一行的悬停，回答越短，链接越早出现在视野里、越不容易被后面的正文顶走。
 */
const PROMPT = "用一句话介绍这个工程，并在最后单独一行给出 README.md 的 markdown 链接（相对路径）。不要做别的事。";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n\n一个用来录制界面的空壳工程。\n");
	// 一个读不了的二进制，正是这两个出口存在的理由——点开它只会得到「无法以文本显示」。
	await writeFile(join(cwd, "Lyra-0.9.8-x64.exe"), Buffer.alloc(2048, 7));
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——真实模型调用需要它`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
}

let app: RunningApp;

async function main() {
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const { hover, mark, type, submit, settled } = driver(app);
	const stop = await startRecording(PORT, frames);
	try {
		console.log("① 提一个会带出文件链接的问题");
		await pause(1000);
		await type(PROMPT);
		await pause(800);
		await submit();
		await settled();
		await pause(1800);

		// 把回答里的文件链接滚进视野中间，否则悬停时它可能贴着窗口边。
		await app.evaluate(
			`(() => { document.querySelector('[data-ly-file-link]')?.scrollIntoView({ block: 'center' }); })()`,
		);
		await pause(900);

		console.log("② 平时：什么都没有");
		await pause(1400);

		console.log("③ 鼠标移到文件名上 —— 上方浮出两个出口");
		await mark("[data-ly-file-link] a", "data-demo");
		await hover("[data-demo]");
		await pause(1800);

		console.log("④ 停在第一个图标上 —— tooltip：用默认应用打开");
		await mark("[data-ly-file-actions] button:nth-child(1)", "data-demo2");
		await hover("[data-demo2]");
		await pause(2200);

		console.log("⑤ 移到第二个图标 —— tooltip：在访达中显示");
		await mark("[data-ly-file-actions] button:nth-child(2)", "data-demo3");
		await hover("[data-demo3]");
		await pause(2200);

		console.log("⑥ 鼠标离开 —— 浮条淡出");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 60, y: 600 });
		await pause(1600);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	await encode(frames, OUT);
	console.log(`\n视频：${OUT}`);
	await app.stop();
}

await main();
