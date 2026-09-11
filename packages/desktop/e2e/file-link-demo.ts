/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 录一段「文件链接旁边那两个出口」的演示：真窗口、真悬停、真 tooltip。
 *
 * 要拍的是三件事，按顺序：
 *
 *   1. 平时什么都没有——两个图标不占视觉，一行字就是一行字
 *   2. 鼠标过来，它们淡入并各自向右落位，第二个晚 45ms（依次登场，不是一起冒出来）
 *   3. 停在图标上，tooltip 说清楚它是什么（「用默认应用打开」/「在访达中显示」）
 *   4. 鼠标离开，两个一起淡出（登场可以有先后，退场不该拖泥带水）
 *
 * 拍窗口不拍屏幕——录全屏会把这台机器上别人的窗口一起录进去。怎么录在 `record.ts`，这里只有剧本。
 *
 * 用法：node --experimental-strip-types e2e/file-link-demo.ts [输出文件]
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

		console.log("③ 鼠标移到文件名上 —— 两个图标依次落位");
		await mark("[data-ly-file-link] a", "data-demo");
		await hover("[data-demo]");
		await pause(1800);

		console.log("④ 停在第一个图标上 —— tooltip：用默认应用打开");
		await mark("[data-ly-file-actions] > button:nth-child(1)", "data-demo2");
		await hover("[data-demo2]");
		await pause(2200);

		console.log("⑤ 移到第二个图标 —— tooltip：在访达中显示");
		await mark("[data-ly-file-actions] > button:nth-child(2)", "data-demo3");
		await hover("[data-demo3]");
		await pause(2200);

		console.log("⑥ 鼠标离开 —— 两个一起淡出");
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
