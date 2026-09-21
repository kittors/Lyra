/**
 * 录一段：从「项目」标题上的 + 号开始，建一个有两个源文件夹的项目，再编辑它。
 *
 * 探针回答「量出来是多少」，这个回答「看起来对不对」——两者说的是同一件事。剧本走的是用户会
 * 走的那条路：悬停出 +、空态、添加两个文件夹、起名、创建，然后从项目菜单进「编辑项目」，最后
 * 打开文件面板看两个文件夹各自一行。
 *
 * 每一步之间留够停顿（一步一秒上下），让人来得及看清。只拍这一个窗口，不抓全屏。
 *
 * 用法：node --experimental-strip-types e2e/project-dialog-demo.ts ~/Desktop/Lyra项目弹窗测试
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9591;
const out = process.argv[2] ?? "/tmp/lyra-project-demo";
const root = join(out, "演示工作区");
const web = join(root, "web");
const api = join(root, "api");
const design = join(root, "design");
const docs = join(root, "docs");

async function seedSession(home: string, projectId: string, cwd: string, title: string): Promise<void> {
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const at = Date.now() - 60_000;
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = { id: projectId, title, cwd, projectId, projectName: title, createdAt: at, updatedAt: at, modelId: "", messageCount: 1, usage, seq: 2 };
	await writeFile(
		join(home, "sessions", projectId, `${projectId}.jsonl`),
		`${JSON.stringify({ seq: 1, ts: at, type: "meta", meta })}\n` +
			`${JSON.stringify({ seq: 2, ts: at, type: "message", message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: at } })}\n`,
	);
}

const app = await startApp({
	port: PORT,
	inspectPort: PORT + 1,
	async seed(home) {
		await mkdir(join(web, "src"), { recursive: true });
		await writeFile(join(web, "app.tsx"), "export const app = 1\n");
		await mkdir(join(api, "src"), { recursive: true });
		await writeFile(join(api, "server.ts"), "export const server = 1\n");
		await mkdir(join(design, "tokens"), { recursive: true });
		await writeFile(join(design, "palette.json"), "{}\n");
		await mkdir(join(docs, "guide"), { recursive: true });
		await writeFile(join(docs, "readme.md"), "# docs\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
		await seedSession(home, "web", web, "前端");
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [], defaultModelId: null, permissionMode: "auto",
				hooks: [], scheduledTasks: [], disabledPlugins: ["*"], alwaysAllow: [], uiLocale: "zh-CN",
				projects: [{ id: "web", name: "前端", path: web, pinned: false, lastOpenedAt: 1, folders: [web, api] }],
			}),
		);
	},
});

const ui = driver(app);
const frames: Frame[] = [];

/** 让下一次（和再下一次）目录选择直接返回这些路径，不弹真表单。 */
async function answerPicker(paths: string[]): Promise<void> {
	await app.main(`(() => {
		const binding = process._linkedBinding("electron_browser_dialog");
		const queue = ${JSON.stringify(paths)};
		binding.showOpenDialog = function () {
			const next = queue.shift();
			return Promise.resolve(next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] });
		};
	})()`);
}

try {
	await mkdir(out, { recursive: true });
	await pause(3000);
	const stop = await startRecording(PORT, frames);

	// 悬停到「项目」那一行：+ 号在这里出现。
	await pause(900);
	await ui.hover('[data-ly-section="projects"]');
	await pause(1400);

	// 打开创建弹窗，停一下让人看清空态。
	await ui.click('[aria-label="新建项目"]');
	await pause(1600);

	// 两个源文件夹，一个接一个加进来。
	await answerPicker([design, docs]);
	await ui.click("[data-ly-add-folder]");
	await pause(1500);
	await ui.click("[data-ly-add-folder]");
	await pause(1500);

	// 起个名字。逐字打，因为这一段是给人看的。
	await app.evaluate(`document.querySelector("[data-ly-project-dialog] input").focus()`);
	for (const ch of "设计与文档") {
		await app.send("Input.insertText", { text: ch });
		await pause(150);
	}
	await pause(1200);

	await ui.markByText("/^创建项目$/", "data-demo-go");
	await ui.click("[data-demo-go]");
	await pause(2600);

	// 从项目菜单进「编辑项目」——顺带让人看见菜单上少掉的那三项。
	await app.evaluate(`(() => {
		const row = [...document.querySelectorAll("[data-ly-project]")].find((r) => r.dataset.lyProject === "前端");
		const button = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("aria-haspopup") || "") === "menu");
		button?.setAttribute("data-demo-menu", "");
	})()`);
	await ui.hover('[data-ly-project="前端"]');
	await pause(700);
	await ui.click("[data-demo-menu]");
	await pause(1800);

	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === "编辑项目")?.setAttribute("data-demo-edit", "")`);
	await ui.click("[data-demo-edit]");
	await pause(2400);

	// 关掉弹窗，打开文件面板：两个源文件夹各占一行。
	await ui.markByText("/^取消$/", "data-demo-cancel");
	await ui.click("[data-demo-cancel]");
	await pause(1200);

	await ui.click('button[aria-label="面板"]');
	await pause(800);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.setAttribute("data-demo-files", "")`);
	await ui.click("[data-demo-files]");
	await pause(2600);

	await stop();
	const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
	await encode(frames, join(out, `${stamp}_新建与编辑项目_多源文件夹.mp4`), 30, 1200);
	process.stdout.write(`视频：${out}\n`);
} finally {
	await app.stop();
}
