/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */
/**
 * 树里「新建文件」到底能不能建出文件——用真实键鼠问一遍。
 *
 * `files.test.ts` 那六条走的是合成事件：`value` setter 加一个 `input`，再补一个 `keydown`。
 * 报出来是磁盘上没有文件，可这既可能是功能坏了，也可能是那套合成方式跟不上组件现在的写法。
 * 真实的 `Input.insertText` 和 `Input.dispatchKeyEvent` 能分开这两件事：它们和人敲键盘走的是
 * 同一条路，`isTrusted` 为真。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let project = "";

const app = await startApp({
	port: 9758,
	seed: async (home) => {
		project = join(home, "project");
		await mkdir(join(project, "src"), { recursive: true });
		await writeFile(join(project, "src", "main.ts"), "export const a = 1;\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [], defaultModelId: null, permissionMode: "auto",
				hooks: [], scheduledTasks: [], disabledPlugins: ["*"], alwaysAllow: [],
				projects: [{ id: "p", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			}),
		);
	},
});

async function clickAt(x: number, y: number, button: "left" | "right" = "left") {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await pause(120);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
	await pause(600);
}

async function centreOf(selector: string): Promise<{ x: number; y: number } | null> {
	return (await app.evaluate(`(() => {
		const e = document.querySelector(${JSON.stringify(selector)});
		if (!e) return null;
		const r = e.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`)) as { x: number; y: number } | null;
}

try {
	await pause(2500);
	// 开文件面板：和 markdown 那条测试一样的两下。
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]').click();
		await wait(300);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
		await wait(1200);
	})()`);
	await pause(1200);

	const row = (await app.evaluate(`(() => {
		const r = [...document.querySelectorAll('[data-ly-tree] [data-path]')].find((e) => (e.getAttribute('data-path') || '').endsWith('/src'));
		if (!r) return null;
		const b = r.getBoundingClientRect();
		return { x: Math.round(b.left + 40), y: Math.round(b.top + b.height / 2) };
	})()`)) as { x: number; y: number } | null;
	if (!row) throw new Error("树里没有 src 这一行");

	await clickAt(row.x, row.y, "right");
	const item = (await app.evaluate(`(() => {
		const e = [...document.querySelectorAll('[role="menuitem"], button')].find((b) => (b.textContent || '').trim() === '新建文件');
		if (!e) return null;
		const r = e.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`)) as { x: number; y: number } | null;
	console.log(`\n  右键菜单里的「新建文件」：${item ? "在" : "✗ 没有"}`);
	if (!item) throw new Error("菜单里没有「新建文件」");
	await clickAt(item.x, item.y);

	const field = await centreOf("[data-ly-tree] input.ly-name-input");
	console.log(`  行内输入框：${field ? "出来了" : "✗ 没出来"}`);
	if (!field) throw new Error("没有出现行内输入框");

	// 真实输入，真实回车。
	await clickAt(field.x, field.y);
	await app.send("Input.insertText", { text: "through-the-menu.ts" });
	await pause(400);
	const typed = await app.evaluate(`document.querySelector("[data-ly-tree] input.ly-name-input")?.value ?? null`);
	console.log(`  输进去的是：${JSON.stringify(typed)}`);
	for (const type of ["keyDown", "keyUp"]) {
		await app.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
	}
	await pause(1500);

	const onDisk = await readFile(join(project, "src", "through-the-menu.ts"), "utf8").then(() => true, () => false);
	console.log(`  磁盘上有这个文件了吗：${onDisk ? "有" : "✗ 没有"}`);
	console.log(
		onDisk
			? "\n树里「新建文件」是通的。\n"
			: "\n树里「新建文件」建不出东西——先看项目边界那道门有没有把两侧都解成规范写法。\n",
	);
	process.exitCode = onDisk ? 0 : 1;
} finally {
	await app.stop();
}
