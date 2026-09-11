/* oxlint-disable no-console -- probe CLI that prints what the real window measured */
/**
 * 文件链接那一行，各个部件到底对没对齐——**量出来**，不靠看截图猜。
 *
 * 造一个现成的会话日志再起窗口，不调模型：要验的是排版，而排版跟内容是谁写的没有关系，为它等一次
 * 真实请求是白等。这条路子也让后面任何一个「界面对不对」的问题都能在十几秒内量一次。
 *
 * 量的是每个部件盒子的**垂直中心**，两两相减。对齐与否不是「看着还行」，是这几个差值。
 *
 * 用法：node --experimental-strip-types e2e/file-link-align-probe.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, pause } from "./record.ts";

const PORT = 9429;
const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	const now = Date.now();
	const meta = {
		id: SESSION,
		title: "对齐量测",
		cwd,
		projectId,
		projectName: "演示工程",
		createdAt: now,
		updatedAt: now,
		modelId: "qa/qa",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 0,
	};
	const lines = [
		{ seq: 1, ts: now, type: "meta", meta },
		{ seq: 2, ts: now, type: "message", message: { role: "user", content: [{ type: "text", text: "给出 README 链接" }], timestamp: now } },
		{
			seq: 3,
			ts: now,
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "这是文档：[README.md](README.md)\n\n后面再跟一行普通文字，用来比对基线。" }],
				api: "openai-responses",
				provider: "qa",
				model: "qa",
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, total: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: now,
			},
		},
		{ seq: 4, ts: now, type: "meta", meta: { ...meta, messageCount: 2 } },
	];
	await writeFile(join(dir, `${SESSION}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

	/*
	 * 供应商照抄真实设置。
	 *
	 * 这个探针一次请求都不发，但少了它，界面停在「未配置模型供应商」的空状态上——要量的那一行根本
	 * 不会被渲染出来。凭据不抄：没有请求要发。
	 */
	const real = JSON.parse(await readFile(join(homedir(), ".lyra", "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: now }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
}

let app: RunningApp;

async function main() {
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const { click, mark } = driver(app);
	try {
		await pause(1500);
		// 侧边栏里那条会话，点开它。
		await mark(".group\\/session", "data-probe");
		await click("[data-probe]").catch(() => {});
		await pause(1800);

		const found = await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-link]').length`);
		console.log(`页面上的文件链接：${found} 个`);
		if (found === 0) {
			const text = await app.evaluate<string>(`document.body.innerText.slice(0, 400)`);
			console.log("没渲染出来，页面上是：\n" + text);
			return;
		}

		const box = await app.evaluate<Record<string, { top: number; height: number; mid: number } | null>>(`
			(() => {
				const wrap = document.querySelector('[data-ly-file-link]');
				const pick = (el) => {
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return { top: +r.top.toFixed(2), height: +r.height.toFixed(2), mid: +(r.top + r.height / 2).toFixed(2) };
				};
				// 文字自己的盒子：用 Range 圈住链接里的文本节点，那才是字形真正占的高度。
				const link = wrap.querySelector('a');
				const textNode = [...link.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
				let label = null;
				if (textNode) {
					const range = document.createRange();
					range.selectNodeContents(textNode);
					const r = range.getBoundingClientRect();
					label = { top: +r.top.toFixed(2), height: +r.height.toFixed(2), mid: +(r.top + r.height / 2).toFixed(2) };
				}
				return {
					wrap: pick(wrap),
					link: pick(link),
					icon: pick(link.querySelector('svg')),
					label,
					actions: pick(wrap.querySelector('[data-ly-file-actions]')),
					firstButton: pick(wrap.querySelector('[data-ly-file-actions] > button')),
				};
			})()
		`);

		console.log("\n各部件的盒子（top / 高 / 垂直中心）：");
		for (const [name, value] of Object.entries(box)) {
			console.log(`  ${name.padEnd(12)} ${value ? `top ${String(value.top).padStart(8)}  高 ${String(value.height).padStart(6)}  中心 ${value.mid}` : "（没有）"}`);
		}

		const { icon, label, firstButton } = box;
		if (icon && label) {
			const delta = +(icon.mid - label.mid).toFixed(2);
			console.log(`\n▸ 图标中心 − 文字中心 = ${delta > 0 ? "+" : ""}${delta}px  ${Math.abs(delta) < 0.6 ? "（对齐）" : "← 没对齐，图标偏" + (delta > 0 ? "下" : "上")}`);
		}
		if (firstButton && label) {
			const delta = +(firstButton.mid - label.mid).toFixed(2);
			console.log(`▸ 按钮中心 − 文字中心 = ${delta > 0 ? "+" : ""}${delta}px  ${Math.abs(delta) < 0.6 ? "（对齐）" : "← 没对齐"}`);
		}

		// 顺带看一眼这一行有没有把行高撑开：和它下面那段普通文字比。
		const lineHeights = await app.evaluate<{ withLink: number; plain: number }>(`
			(() => {
				const ps = [...document.querySelectorAll('.prose-dw p')];
				const withLink = ps.find((p) => p.querySelector('[data-ly-file-link]'));
				const plain = ps.find((p) => !p.querySelector('[data-ly-file-link]') && p.innerText.trim());
				return {
					withLink: withLink ? +withLink.getBoundingClientRect().height.toFixed(2) : -1,
					plain: plain ? +plain.getBoundingClientRect().height.toFixed(2) : -1,
				};
			})()
		`);
		console.log(`\n▸ 带链接那段高 ${lineHeights.withLink}px，普通段落高 ${lineHeights.plain}px  ${
			lineHeights.plain > 0 && Math.abs(lineHeights.withLink - lineHeights.plain) < 0.6 ? "（没被撑开）" : "← 被撑开了"
		}`);
	} finally {
		await app.stop();
	}
}

await main();
