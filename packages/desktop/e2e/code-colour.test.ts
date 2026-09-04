/**
 * 换过主题之后，代码块还得是彩色的。
 *
 * 这块颜色是靠一批现编的类名撑着的：`HighlightStyle.define` 每调一次就生成一整套新名字（ͼo、
 * ͼ1f、ͼ26…），页面上只挂当前这一套的规则。而 `sharedHighlightStyle` 的缓存键是那两个主题 id，
 * 于是带参数调它的 `applyAppearance` 和不带参数调它的 `CodeBlock` 互相判定「跟当前不一样」，来回
 * 重建、来回换掉文档里的规则——被换掉的那一方留在屏幕上的 span，带的类已经没有定义了。
 *
 * 结果是：改一次字号、拖一下对比度、切一次深浅色，屏幕上已经上好色的代码块整块掉回默认字色。量
 * 过：切一次主题，颜色种数从 6 变成 1。
 *
 * 所以这条数的是颜色，不是类名——类名对不对无所谓，看得见的是颜色。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1, providers: [], mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
		hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
		sync: { enabled: false, port: 4531, token: null },
	}));

	const projectId = createHash("sha256").update(root).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "colour", title: "代码块", cwd: root, projectId, projectName: "project",
		createdAt: 1, updatedAt: 2, modelId: "none", messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 3,
	};
	const shell = [
		"```bash",
		'curl -fsS -o /dev/null -w "%{http_code}" https://a.example/ready',
		"# 返回 204",
		'if [ -f x ]; then echo "ok $NAME" | tee log && exit 0; fi',
		"```",
	].join("\n");
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({ seq: 2, ts: 2, type: "message", message: { role: "user", content: [{ type: "text", text: "探活" }], timestamp: 2 } }),
		JSON.stringify({ seq: 3, ts: 3, type: "message", message: { role: "assistant", content: [{ type: "text", text: `好的：\n\n${shell}\n\n完成。` }], timestamp: 3 } }),
	];
	await writeFile(join(home, "sessions", projectId, "colour.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

before(async () => {
	app = await startApp({ port: 9421, seed });
});
after(async () => {
	await app?.stop();
});

/** 代码块里一共出现了几种字色。一种 = 没有高亮。 */
const colours = () => app.evaluate<number>(`(() => {
	const pre = document.querySelector("pre");
	if (!pre) return -1;
	return new Set([...pre.querySelectorAll("span")].map((el) => getComputedStyle(el).color)).size;
})()`);

test("bash 本来就该是彩色的，而且不止一两种颜色", async () => {
	await app.evaluate(`(async () => {
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		for (const el of document.querySelectorAll("button")) {
			if (el.textContent && el.textContent.includes("代码块")) { el.click(); break; }
		}
		await sleep(1400);
	})()`);

	const count = await colours();
	assert.ok(count >= 5, `一段 shell 里有命令、参数、字符串、变量、注释、管道，不该只有 ${count} 种颜色`);
});

test("切一趟主题回来，颜色一种都不能少", async () => {
	const before = await colours();

	await app.evaluate(`(async () => {
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector(".ly-sidebar-foot button")?.click();
		await sleep(1200);
		const hit = (text) => {
			for (const el of document.querySelectorAll("button")) {
				if (el.textContent && el.textContent.trim() === text) { el.click(); return true; }
			}
			return false;
		};
		hit("外观"); await sleep(700);
		hit("浅色"); await sleep(600);
		hit("深色"); await sleep(600);
		for (const el of document.querySelectorAll("button")) {
			if (el.textContent && el.textContent.includes("返回工作区")) { el.click(); break; }
		}
		await sleep(1100);
	})()`);

	const after = await colours();
	assert.equal(
		after,
		before,
		`切主题前 ${before} 种颜色，切完只剩 ${after} 种——已经画在屏幕上的代码块跟着样式一起被换掉了`,
	);
});
