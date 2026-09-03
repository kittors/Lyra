/**
 * The refusals, in a real window.
 *
 * `test/security-policy.test.ts` checks that the rules decide correctly. This checks that they are
 * actually attached — a different failure, and the one that unit tests cannot see: a policy nobody
 * wired up returns all the right answers to nobody.
 *
 * The navigation case is the one worth having. It is the difference between "a link opens in the
 * browser" and "a page can replace our renderer with itself", and the second one only shows up if
 * something really tries it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9451 });
});

after(async () => {
	await app?.stop();
});

test("窗口不会被导航到外部页面", async () => {
	const before = await app.evaluate<string>("location.href");

	// 这正是一次注入会做的事：把持有 preload 的窗口指向别处。
	await app.evaluate<void>(`void (location.href = "https://example.com/")`);
	await new Promise((resolve) => setTimeout(resolve, 800));

	const after = await app.evaluate<string>("location.href");
	assert.equal(after, before, "窗口应该停在原地；它被导航走就等于 window.lyra 交了出去");
});

test("window.open 不在应用内开新窗口", async () => {
	const opened = await app.evaluate<boolean>(`
		(() => {
			const w = window.open("https://example.com/", "_blank");
			// setWindowOpenHandler 返回 deny 时，window.open 得到 null。
			return w !== null;
		})()
	`);
	assert.equal(opened, false, "新窗口请求应该被拒，链接交给系统浏览器");

	// 而且窗口自己没有跟着跑掉。
	const href = await app.evaluate<string>("location.href");
	assert.match(href, /^(file:|http:\/\/localhost)/, "主窗口仍然是我们自己的页面");
});

test("渲染进程仍然拿得到 window.lyra——守卫没有误伤自己人", async () => {
	const shape = await app.evaluate<{ has: boolean; sessions: boolean }>(`
		({ has: typeof window.lyra === "object", sessions: typeof window.lyra?.sessions?.list === "function" })
	`);
	assert.equal(shape.has, true);
	assert.equal(shape.sessions, true, "IPC 面必须完好，否则守卫收得太紧");
});
