/**
 * 右键一个文件标签，五个关闭各干各的事。
 *
 * 这五项的实现一直是对的——store 里 `closeTab`/`closeTabs` 各自留下正确的那几个。错的是屏幕：
 * 标签行在只剩一个标签时会整条消失，于是三个标签时点「关闭其他」或「关闭右侧」，看到的结果和
 * 「全部关闭」一模一样。三个菜单项里有两个看起来干了第四个的事。
 *
 * 所以这里断言的不只是剩下谁，还有那条行在不在——后者才是当初让人以为功能坏掉的东西。
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(join(root, "src"), { recursive: true });
	for (const name of ["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]) {
		await writeFile(join(root, "src", name), `export const x = "${name}"\n`);
	}
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1, providers: [], mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
		hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
		sync: { enabled: false, port: 4528, token: null },
	}));
}

before(async () => {
	app = await startApp({ port: 9419, seed });
});
after(async () => {
	await app?.stop();
});

/** 开出四个标签，返回它们的文件名。每个用例开头都重来一次，好让四个用例互不相干。 */
async function openFour(): Promise<string[]> {
	return app.evaluate<string[]>(`(async () => {
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		if (document.querySelectorAll("[data-file-tab]").length < 4) {
			const menu = document.querySelector('button[aria-label="面板"]');
			if (menu) { menu.click(); await sleep(250); }
			for (const row of document.querySelectorAll('[role="menuitem"], button')) {
				if (row.textContent && row.textContent.includes("文件") && !row.textContent.includes("内容")) { row.click(); break; }
			}
			await sleep(600); document.body.click(); await sleep(200);
			for (let i = 0; i < 3; i += 1) for (const el of document.querySelectorAll("button, [role='treeitem']")) {
				if (el.textContent && el.textContent.trim() === "src") { el.click(); await sleep(300); break; }
			}
			for (const name of ["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]) {
				for (const el of document.querySelectorAll("button, [role='treeitem']")) {
					if (el.textContent && el.textContent.trim() === name) { el.click(); await sleep(380); break; }
				}
			}
		}
		return [...document.querySelectorAll("[data-file-tab]")].map((el) => el.getAttribute("data-file-tab").split("/").pop());
	})()`);
}

/** 在第 index 个标签上右键；给了 label 就点它。返回菜单上看到的所有项（禁用的带标记）。 */
async function rightClick(index: number, label?: string): Promise<string[]> {
	return app.evaluate<string[]>(`(async () => {
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const tab = [...document.querySelectorAll("[data-file-tab]")][${index}];
		const box = tab.getBoundingClientRect();
		tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: box.left + 8, clientY: box.top + 8 }));
		await sleep(280);
		const items = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')];
		const seen = items.map((el) => el.textContent.trim() + (el.disabled || el.getAttribute("aria-disabled") === "true" ? "(禁用)" : ""));
		const want = ${JSON.stringify(label ?? null)};
		if (want) {
			const hit = items.find((el) => el.textContent.trim() === want);
			if (hit) { hit.click(); await sleep(340); }
		} else {
			document.body.click();
			await sleep(200);
		}
		return seen;
	})()`);
}

const names = () => app.evaluate<string[]>(`[...document.querySelectorAll("[data-file-tab]")].map((el) => el.getAttribute("data-file-tab").split("/").pop())`);
const stripAlive = () => app.evaluate<boolean>(`!!document.querySelector('[role="tablist"][aria-label="打开的文件"]')`);

test("两端的菜单长得不一样：最左没有左侧可关，最右没有右侧可关", async () => {
	const opened = await openFour();
	assert.equal(opened.length, 4, `先得开出四个标签，实际 ${opened.join(",")}`);

	const atFirst = await rightClick(0);
	assert.ok(atFirst.includes("关闭左侧(禁用)"), `在最左边，「关闭左侧」该是灰的：${atFirst.join(" ")}`);
	assert.ok(atFirst.includes("关闭右侧"), `在最左边，「关闭右侧」该能用：${atFirst.join(" ")}`);

	const atLast = await rightClick(3);
	assert.ok(atLast.includes("关闭右侧(禁用)"), `在最右边，「关闭右侧」该是灰的：${atLast.join(" ")}`);
	assert.ok(atLast.includes("关闭左侧"), `在最右边，「关闭左侧」该能用：${atLast.join(" ")}`);
});

test("关闭右侧只关右边的，标签行留着", async () => {
	await openFour();
	await rightClick(1, "关闭右侧");
	assert.deepEqual(await names(), ["alpha.ts", "beta.ts"], "该只剩它和它左边的");
	assert.equal(await stripAlive(), true, "标签行还得在");
});

test("关闭其他只留这一个，标签行仍然留着 —— 这才看得出没有全关", async () => {
	await openFour();
	await rightClick(0, "关闭其他");
	assert.deepEqual(await names(), ["alpha.ts"], "该只剩右键的那一个");
	assert.equal(
		await stripAlive(),
		true,
		"只剩一个标签时这条行也得在——它一消失，屏幕上就跟「全部关闭」没有区别了",
	);
});

test("全部关闭之后，文件预览面板自己退场", async () => {
	await openFour();
	await rightClick(0, "全部关闭");
	assert.deepEqual(await names(), [], "一个不剩");
	assert.equal(await stripAlive(), false, "没有标签，也就没有标签行");
	const panelGone = await app.evaluate<boolean>(`!document.querySelector('[data-ly-pane="file"]') && !document.querySelector("[data-file-tab]")`);
	assert.equal(panelGone, true, "一个文件都不开了，这个面板留在屏幕上就是一块空白");
});
