/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */
/**
 * 文件夹在磁盘上没了之后，这个项目还听不听话。
 *
 * 报告是「项目从本地删除了，lyra 里面就删不掉」。量两件事：切过去的时候有没有一句话说清是
 * 目录变了（`workspace.info` 对不存在的路径答 `null`，从前这个 `null` 和「已经被新的选择顶掉」
 * 共用一个 `return`，于是点它什么都不发生）；以及那条记录到底删不删得掉。
 *
 * 走侧边栏那一行的右键菜单，用户去删项目走的也是这里。
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "./app.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const alive = await mkdtemp(join(tmpdir(), "lyra-alive-"));
// 从来没有被创建过，等同于用户在访达里删掉之后剩下的那条记录。
const gone = join(tmpdir(), "lyra-gone-does-not-exist-9931");

const app = await startApp({
	port: 9756,
	seed: async (home) => {
		const path = join(home, "settings.json");
		const raw = await readFile(path, "utf8").catch(() => "{}");
		await writeFile(
			path,
			JSON.stringify({
				...(JSON.parse(raw) as Record<string, unknown>),
				projects: [
					{ id: "alive", name: "还在的项目", path: alive, pinned: true, lastOpenedAt: 2 },
					{ id: "gone", name: "已删除的项目", path: gone, pinned: true, lastOpenedAt: 1 },
				],
				permissionMode: "auto",
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
			}),
		);
	},
});

const problems: string[] = [];
const MENU = `document.querySelector('[role="menu"], [data-popover]')`;

/** 真实鼠标：`:hover`、菜单开合和右键都只认真指针，合成事件会让探针打印出没发生过的结论。 */
async function press(x: number, y: number, button: "left" | "right") {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await pause(150);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
	await pause(800);
}

async function locate(needle: string, rootExpr = "document"): Promise<{ x: number; y: number } | null> {
	return (await app.evaluate(`(() => {
		const root = ${rootExpr};
		if (!root) return null;
		const hit = [...root.querySelectorAll('button, [role="menuitem"]')].find((b) => (b.textContent || '').includes(${JSON.stringify(needle)}));
		if (!hit) return null;
		const r = hit.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`)) as { x: number; y: number } | null;
}

async function openRowMenu(): Promise<boolean> {
	const row = await locate("已删除的项目");
	if (!row) return false;
	await press(row.x, row.y, "right");
	return Boolean(await app.evaluate(`Boolean(${MENU})`));
}

try {
	await pause(3000);
	console.log("");

	// 一，切过去：文件夹不在了，得说出来是哪个文件夹不在了。
	if (!(await openRowMenu())) problems.push("侧边栏里没有那条已删除的项目，或右键打不开菜单");
	else {
		const go = await locate("切换到这个项目", MENU);
		if (!go) problems.push("右键菜单里没有「切换到这个项目」");
		else {
			await press(go.x, go.y, "left");
			await pause(1200);
			const seen = (await app.evaluate(`document.body.innerText`)) as string;
			const told = seen.includes("文件夹已经不在了");
			const named = seen.includes("lyra-gone-does-not-exist-9931");
			console.log(`  切过去：提示 ${told ? "出现了" : "✗ 没出现"}，${named ? "点名了是哪个文件夹" : "✗ 没说是哪个文件夹"}`);
			if (!told) problems.push("切到已删除的项目，界面上一句话都没有——就是报告里那个「点它没反应」");
			if (!named) problems.push("提示没说是哪个文件夹");
		}
	}

	// 二，移除：删除不该依赖目录还在。
	if (!(await openRowMenu())) problems.push("第二次右键打不开菜单");
	else {
		const remove = await locate("移除", MENU);
		if (!remove) problems.push("右键菜单里没有「移除」");
		else {
			await press(remove.x, remove.y, "left");
			await pause(1400);
			// 可能要过一次确认。
			const confirm = await locate("移除", `document.querySelector('[role="dialog"]')`);
			if (confirm) {
				console.log("  移除有一次确认，按下去");
				await press(confirm.x, confirm.y, "left");
				await pause(1400);
			}
			const left = (await app.evaluate(`document.body.innerText.includes("已删除的项目")`)) as boolean;
			console.log(`  移除之后还在列表里：${left ? "✗ 还在" : "没了"}`);
			if (left) problems.push("文件夹已经不在磁盘上，这条记录还是删不掉——报告说的就是这个");
		}
	}

	console.log(problems.length === 0 ? "\n文件夹没了：切过去会说清楚，记录也删得掉\n" : `\n${problems.length} 处：\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
}
