/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 录一段真实的演示：真模型、真工具、真设置页，拍窗口不拍屏幕。
 *
 * 怎么录、怎么在窗口里点点划划，都在 `record.ts`；这里只有剧本。
 *
 * 用法：node --experimental-strip-types e2e/demo-recorder.ts [输出文件]
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT = process.argv[2] ?? join(homedir(), "Downloads", "lyra-flow-demo.mp4");
const PORT = 9420;

/** 一份带暗号的文档，用来演示附件占位符：气泡里只留胶囊，模型却读得到正文。 */
const DOC = [
	"# 交接说明",
	"",
	...Array.from({ length: 120 }, (_, i) => `- 条目 ${i + 1}：一段用来把文档撑长的说明文字。`),
	"",
	"## 暗号",
	"",
	"LYRA-DEMO-2026",
	"",
].join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n\n一个用来录制界面的空壳工程。\n");
	await writeFile(join(cwd, "index.ts"), "export const version = '1.0.0'\n");
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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900 }));
}

// ---------------------------------------------------------------------------
// 剧本
// ---------------------------------------------------------------------------

let app: RunningApp;
const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

async function main() {
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const { click, hover, mark, type, submit, until, settled } = driver(app);
	const stop = await startRecording(PORT, frames);
	try {
		console.log("① 提问 —— 想 → 做 → 说");
		await pause(1200);
		await type("先想清楚：一个 8x8 棋盘去掉对角两格，能用 31 张 1x2 骨牌铺满吗？想明白之后，用 ls 看看这个工程有哪些文件，并把结论追加到 README.md。");
		await pause(1500);
		await submit();
		// 流式过程本身就是要拍的东西：思考行逐字写、工具行扫光。
		await settled();
		await pause(2500);

		console.log("② 回合收起 —— 过程聚合成一行");
		await pause(2000);

		console.log("③ 点开过程");
		await mark("[data-ly-turn-process] .ly-flow-row", "data-demo");
		await click("[data-demo]");
		await pause(2600);

		console.log("④ 悬停一条流水行 —— 图标原地换 chevron");
		await mark("[data-ly-run] .ly-flow-row", "data-demo2");
		await hover("[data-demo2]");
		await pause(1800);

		console.log("⑤ 再收起");
		await click("[data-demo]");
		await pause(2000);

		console.log("⑥ 附件 —— 占位符与胶囊");
		await type("这份文档里的暗号是什么？只回答暗号本身。");
		await pause(800);
		await app.evaluate(`(async () => {
			const wait = ${WAIT};
			const input = document.querySelector('main input[type="file"]');
			const dt = new DataTransfer();
			dt.items.add(new File([${JSON.stringify(DOC)}], "交接说明.md", { type: "text/markdown" }));
			// 再挂两个别的门类，好让那排彩色图标在录像里看得见：表格是绿的，设计稿是紫的。
			// 不写反斜杠 n：这段字符串要穿过一层模板串，转义会被提前吃掉，落到页面里就是一个真换行。
			dt.items.add(new File([["a,b,c", "1,2,3"].join(String.fromCharCode(10))], "季度数据.csv", { type: "text/csv" }));
			dt.items.add(new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "首页改版.psd", { type: "image/vnd.adobe.photoshop" }));
			Object.defineProperty(input, "files", { value: dt.files, configurable: true });
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await wait(1200);
		})()`);
		await pause(2200);
		await submit();
		await settled();
		await pause(3000);

		console.log("⑦ 设置页 —— 拉取模型：遮罩盖满整窗，上下文 200K");
		await click(".ly-sidebar-foot button");
		await pause(1200);
		await mark("nav button", "data-nope");
		await app.evaluate(`(()=>{document.querySelector('[data-demo3]')?.removeAttribute('data-demo3');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-demo3','');})()`);
		await click("[data-demo3]");
		await pause(1500);
		await app.evaluate(`(()=>{document.querySelector('[data-demo4]')?.removeAttribute('data-demo4');[...document.querySelectorAll("button")].find((b)=>/拉取模型/.test(b.innerText))?.setAttribute('data-demo4','');})()`);
		await click("[data-demo4]");
		await until(`document.querySelector('[data-ly-modal]')`, 60000);
		await pause(3500);
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(1800);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
	}
	if (frames.length === 0) throw new Error("一帧都没采到");
	await encode(frames, OUT);
	console.log(`\n✅ ${OUT}`);
}

await main();
