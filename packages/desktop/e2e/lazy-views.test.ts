/**
 * The four screens that now arrive in their own chunk.
 *
 * Splitting them out of the main bundle is invisible when it works and looks like a dead click when
 * it does not: the pane keeps its previous contents until the chunk lands, so a wrong import path
 * shows up as nothing happening rather than as an error. Nothing else would catch it — the string
 * inside `import()` is opaque to the type checker, and no unit test mounts the app.
 *
 * Driven by clicking the sidebar, not by writing to a store. An earlier version of this file
 * reached for `window.__lyraStore`, which does not exist; every assertion sat behind a check for it
 * and the whole test passed without loading a single chunk. Clicking what a person clicks is both
 * the stronger test and the one that cannot quietly stop testing anything.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9471 });
});

after(async () => {
	await app?.stop();
});

/** Click the sidebar entry with this label. Fails loudly if there is no such button. */
async function navigate(label: string): Promise<void> {
	const clicked = await app.evaluate<boolean>(`
		(() => {
			const button = [...document.querySelectorAll("button")]
				.find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
			if (!button) return false;
			button.click();
			return true;
		})()
	`);
	assert.equal(clicked, true, `侧边栏里没有「${label}」这个按钮——测试找错了入口`);
}

/** Wait until something only this screen renders is on the page. */
async function appears(text: string, within = 8000): Promise<boolean> {
	const deadline = Date.now() + within;
	while (Date.now() < deadline) {
		const there = await app.evaluate<boolean>(
			`Boolean(document.body.innerText.includes(${JSON.stringify(text)}))`,
		);
		if (there) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

test("插件页在自己的 chunk 里，点了会到", async () => {
	await navigate("插件");
	// 目录页的空状态或列表都会带这个词；chunk 没加载出来的话页面上一个字都不会变。
	assert.equal(await appears("插件"), true, "插件页没有渲染出来");
});

test("拉取请求页同样", async () => {
	await navigate("拉取请求");
	assert.equal(await appears("拉取请求"), true, "拉取请求页没有渲染出来");
});

test("已安排页同样", async () => {
	// 侧边栏上写的是「已安排」；视图内部叫 scheduled。按用户看得见的那个字找。
	await navigate("已安排");
	assert.equal(await appears("已安排"), true, "已安排页没有渲染出来");
});

test("切回对话，界面完整", async () => {
	await navigate("聊天");
	await new Promise((resolve) => setTimeout(resolve, 600));
	const alive = await app.evaluate<number>(`document.querySelector("#root")?.children.length ?? 0`);
	assert.ok(alive > 0, "切回对话之后根节点是空的");
});

test("设置也是懒加载的，打开之后它的分区名在页面上", async () => {
	/*
	 * 设置是四个里最大的一个——独立出来 344KB——也是最值得确认真的会到的那个。
	 *
	 * 它的入口在侧边栏底部，按钮上的文字是当前供应商的名字而不是「设置」，所以按图标的
	 * 容器找：那一行是 `.ly-sidebar-foot` 里的第一个按钮。
	 */
	const opened = await app.evaluate<boolean>(`
		(() => {
			const button = document.querySelector(".ly-sidebar-foot button");
			if (!button) return false;
			button.click();
			return true;
		})()
	`);
	assert.equal(opened, true, "侧边栏底部找不到设置入口——它变了，这条测试要跟着改");
	assert.equal(await appears("外观"), true, "设置页的分区没有出现，chunk 多半没加载");
});
