/**
 * 跟随底部，不该被浏览器自己挪的那一下打断。
 *
 * 文稿区特意留着滚动锚定：上面的思考块展开时，你正在读的那行不该跟着跑。代价是浏览器会主动改
 * `scrollTop`——而「位置变小了」和「读者往上滚了」在 `onScroll` 眼里曾经是同一件事。于是收一个工具
 * 组、合一个思考块，跟随就断了，后面的回复再多也不会自动置底。
 *
 * 这条只能在真浏览器里验：锚定是浏览器的行为，happy-dom 不做这件事，单测里它永远是绿的。
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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1100, height: 800, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1, providers: [], mcpServers: [],
		projects: [{ id: "e2e", name: "p", path: root, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
		hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
		sync: { enabled: false, port: 4526, token: null },
	}));

	// 一段够长的对话，好让文稿区真的能滚起来——不能滚就没有「跟随」可言。
	const projectId = createHash("sha256").update(root).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "follow", title: "跟随", cwd: root, projectId, projectName: "p",
		createdAt: 1, updatedAt: 2, modelId: "none", messageCount: 40,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 41,
	};
	const lines = [JSON.stringify({ seq: 1, ts: 1, type: "meta", meta })];
	for (let i = 0; i < 40; i += 1) {
		lines.push(JSON.stringify({
			seq: i + 2, ts: i + 2, type: "message",
			message: {
				role: i % 2 === 0 ? "user" : "assistant",
				content: [{ type: "text", text: `第 ${i} 段。` + "内容".repeat(40) }],
				timestamp: i + 2,
			},
		}));
	}
	await writeFile(join(home, "sessions", projectId, "follow.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

before(async () => {
	app = await startApp({ port: 9418, seed });
});
after(async () => {
	await app?.stop();
});

test("上方内容收缩时，浏览器会自己改 scrollTop —— 这是真实存在的，不是假设", async () => {
	const moved = await app.evaluate<{ before: number; after: number; events: number }>(`(async () => {
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		const host = document.createElement("div");
		host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px;overflow-y:auto;z-index:99999;visibility:hidden";
		host.innerHTML = '<div id="anchor-grow" style="height:600px"></div><div style="height:900px"></div>';
		document.body.appendChild(host);
		let events = 0;
		host.addEventListener("scroll", () => { events += 1; });
		host.scrollTop = host.scrollHeight;
		await frame();
		const before = host.scrollTop;
		events = 0;
		document.getElementById("anchor-grow").style.height = "200px";
		await frame();
		const after = host.scrollTop;
		host.remove();
		return { before, after, events };
	})()`);

	assert.ok(moved.before > 0, "先得真的停在底部");
	assert.ok(moved.after < moved.before, "锚定确实把 scrollTop 往回挪了——这就是被误判成「往上滚」的那一下");
	assert.ok(moved.events > 0, "而且它以一个普通的 scroll 事件到达，跟人滚的长得一模一样");
});

test("上方一收缩，跟随还得活着 —— 之后来的内容仍然自动置底", async () => {
	const result = await app.evaluate<Record<string, unknown>>(`(async () => {
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

		// 打开那个 seed 进去的会话
		for (const el of document.querySelectorAll("button")) {
			if (el.textContent && el.textContent.includes("跟随")) { el.click(); break; }
		}
		await sleep(1200);

		// 文稿区：能滚的那个滚动视口，且里面确实有消息
		const view = [...document.querySelectorAll(".ly-scroll-view")]
			.filter((el) => el.scrollHeight > el.clientHeight + 40)
			.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
		if (!view) return { skipped: "没有可滚动的文稿区" };

		// 停到底部，也就是「跟随中」
		view.scrollTop = view.scrollHeight;
		await frame();
		await sleep(150);
		const settled = view.scrollHeight - view.scrollTop - view.clientHeight;

		// 在视口上方塞一块，再把它收掉——收工具组、合思考块就是这个形状，锚定会因此挪 scrollTop
		const first = view.firstElementChild;
		const shim = document.createElement("div");
		shim.style.height = "600px";
		first.insertBefore(shim, first.firstChild);
		await frame();
		shim.style.height = "0px";
		await frame();
		await sleep(120);

		// 现在，新内容到达。跟随还在的话，它应该把视口带到底
		const grown = document.createElement("div");
		grown.style.height = "500px";
		first.append(grown);
		await frame();
		await sleep(300);
		const gap = view.scrollHeight - view.scrollTop - view.clientHeight;

		shim.remove();
		grown.remove();
		return { settled, gap };
	})()`);

	if (result.skipped) {
		assert.fail(`环境没准备好：${String(result.skipped)}`);
	}
	assert.ok((result.settled as number) < 4, `先得确实停在底部，实际差 ${String(result.settled)}px`);
	// 锚定挪过一次之后，跟随若被误判为断开，这 500px 就会原地留在视口下方。
	assert.ok(
		(result.gap as number) < 8,
		`锚定动过之后新内容没有被跟上，距底 ${String(result.gap)}px —— 跟随被浏览器自己的滚动打断了`,
	);
});
