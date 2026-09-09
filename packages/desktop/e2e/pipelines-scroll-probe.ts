/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * CI 那一列能不能滚。
 *
 * 报告是「鼠标放上去竟然没有滚动移动」，而这句话有两种完全不同的意思，从截图上分不出来：滚轮
 * 推不动内容，或者内容根本没溢出、只是被上面某一层 `overflow-hidden` 切掉了。两者看起来一模
 * 一样——底下那条记录都是被裁掉一半的。
 *
 * 所以这里不看样式，看数：造一屏放不下的运行记录，然后问那个滚动容器它自己的 `scrollHeight`
 * 和 `clientHeight`，再真的推一下滚轮看 `scrollTop` 动没动。溢出了却推不动是一种毛病，压根
 * 没溢出是另一种，需要修的地方不在同一个文件里。
 *
 * 假的 Forge 服务照搬 `pipelines-loading.test.ts`：真的 git remote、真的账号存储、真的 IPC，
 * 只有 HTTP 那一端是合成的。
 *
 * 用法：node --experimental-strip-types e2e/pipelines-scroll-probe.ts
 */

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeListeningServer, startApp } from "./app.ts";

const PORT = 9501;
const RUNS = 40;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pane = '[data-dock-pane="review"]';

let baseUrl = "";

/** Enough runs that the list cannot possibly fit, so "did not overflow" means a real fault. */
function runs(): unknown[] {
	return Array.from({ length: RUNS }, (_, i) => ({
		id: 100 + i,
		name: i % 3 === 0 ? "CI" : i % 3 === 1 ? "CodeQL" : "Dependency review",
		display_title: `chore(deps): bump something across ${i} directories`,
		event: "pull_request",
		status: "completed",
		conclusion: i % 4 === 0 ? "failure" : "success",
		head_branch: `dependabot/npm_and_yarn/pkg-${i}`,
		head_sha: `${i}`.padStart(7, "0") + "abcdef012345678",
		created_at: new Date(Date.now() - i * 60_000).toISOString(),
		html_url: `${baseUrl}/fixture/repo/actions/runs/${100 + i}`,
	}));
}

const forge: Server = createServer((req, res) => {
	req.resume();
	if (!req.url?.startsWith("/api/v3/repos/fixture/repo/actions/runs?")) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({ workflow_runs: runs() }));
});

await new Promise<void>((resolve) => forge.listen(0, "127.0.0.1", resolve));
const address = forge.address();
if (!address || typeof address === "string") throw new Error("假 Forge 没起来");
baseUrl = `http://127.0.0.1:${address.port}`;

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const project = join(home, "project");
		await mkdir(project, { recursive: true });
		await promisify(execFile)("git", ["init", "-b", "main"], { cwd: project });
		await writeFile(join(project, "readme.md"), "# probe\n");
		await promisify(execFile)("git", ["add", "-A"], { cwd: project });
		await promisify(execFile)("git", ["-c", "user.email=p@e", "-c", "user.name=p", "commit", "-m", "init"], { cwd: project });
		await promisify(execFile)("git", ["remote", "add", "origin", `${baseUrl}/fixture/repo.git`], { cwd: project });
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900, x: 0, y: 0 }));
		await writeFile(
			join(home, "forges.json"),
			JSON.stringify({
				version: 1,
				entries: [
					{
						account: { id: "synthetic-forge", kind: "github", baseUrl, login: "synthetic", label: "Synthetic local Forge", avatarUrl: null, addedAt: 1, enabled: true },
						token: "synthetic-test-token",
						encrypted: false,
					},
				],
			}),
		);
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: null,
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

try {
	await pause(3000);
	// Git 面板走它自己的快捷键（⌘⇧R，见 `panels/builtin.tsx`），比在工具栏里认按钮稳。
	for (const type of ["keyDown", "keyUp"]) {
		await app.send("Input.dispatchKeyEvent", {
			type,
			modifiers: 4 | 8,
			key: "R",
			code: "KeyR",
			windowsVirtualKeyCode: 82,
			nativeVirtualKeyCode: 82,
		});
	}
	await pause(1400);
	// 标签在面板里叫「流水线」。
	await app.evaluate(`(() => {
		const tab = [...document.querySelectorAll('${pane} button')].find((b) =>
			/流水线|Pipelines|パイプライン|파이프라인|Конвейеры/.test((b.dataset.lyTip ?? "") + (b.textContent ?? "")));
		if (tab) tab.click();
	})()`);
	await pause(3000);

	const shape = (await app.evaluate(`(() => {
		const host = document.querySelector('${pane} .ly-scroll-view');
		if (!host) return null;
		return {
			rows: document.querySelectorAll('${pane} .ly-scroll-view > * > *').length,
			scrollHeight: Math.round(host.scrollHeight),
			clientHeight: Math.round(host.clientHeight),
			overflowing: host.scrollHeight - host.clientHeight > 1,
		};
	})()`)) as { rows: number; scrollHeight: number; clientHeight: number; overflowing: boolean } | null;

	console.log("");
	if (!shape) {
		problems.push("找不到 CI 那一列的滚动容器");
		console.log("  找不到滚动容器——CI 那一页可能没渲染出来");
	} else {
		console.log(`  列表 ${shape.rows} 行  内容高 ${shape.scrollHeight}  可见 ${shape.clientHeight}  ${shape.overflowing ? "溢出了" : "✗ 没溢出"}`);
		if (!shape.overflowing) {
			problems.push(`内容没有溢出（${shape.scrollHeight} ≤ ${shape.clientHeight}）——上面某一层把它切掉了，滚动容器自己不知道`);
		} else {
			/*
			 * 真实滚轮，不是合成的 WheelEvent。
			 *
			 * `dispatchEvent(new WheelEvent(...))` 会被派发，但它 `isTrusted` 为假，不驱动浏览器
			 * 自己的滚动——照样打印出一个「滚动了」的结论，而报告说的正是滚轮推不动。所以这里走
			 * `Input.dispatchMouseEvent`，指针真的落在那一列上。
			 */
			const at = (await app.evaluate(`(() => {
				const host = document.querySelector('${pane} .ly-scroll-view');
				host.scrollTop = 0;
				const r = host.getBoundingClientRect();
				return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
			})()`)) as { x: number; y: number };
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
			await pause(120);
			for (let i = 0; i < 3; i++) {
				await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY: 160 });
				await pause(120);
			}
			await pause(400);
			const after = (await app.evaluate(`document.querySelector('${pane} .ly-scroll-view').scrollTop`)) as number;
			console.log(`  真实滚轮推 480px：scrollTop 0 → ${Math.round(after)}`);
			if (after <= 1) problems.push("内容溢出了，可滚轮推不动它");
		}
	}

	console.log(problems.length === 0 ? "\nCI 那一列滚得动\n" : `\n${problems.length} 处：\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
	await closeListeningServer(forge);
}
