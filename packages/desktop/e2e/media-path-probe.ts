/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */
/**
 * markdown 里的图为什么不显示：把三个路径摆在一起看。
 *
 * `ly-media` 的处理器只放行「在某个已配置项目里」的文件，判定用的是 `containingRoot`，而它只
 * `resolve()`，不解析符号链接。macOS 上 `mkdtemp` 给的是 `/var/folders/...`，realpath 之后是
 * `/private/var/folders/...`——两者一旦分处比较的两侧，`relative()` 会算出一串 `../..`，于是
 * 403，图片停在 alt 上。
 *
 * 要定的性是：路径究竟在哪一环被 realpath 了。配置里的项目路径、文件树给渲染进程的
 * `data-path`、以及 `img.src` 解出来的那个，三者只要有一个跟别人不同前缀，答案就出来了。
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./app.ts";

const LOGO = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "assets", "lyra.png");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let projectPath = "";

const app = await startApp({
	port: 9757,
	seed: async (home) => {
		const root = join(home, "project");
		projectPath = root;
		await mkdir(join(root, "assets"), { recursive: true });
		await copyFile(LOGO, join(root, "assets", "pic.png"));
		await writeFile(join(root, "doc.md"), "# 标题\n\n![相对路径](assets/pic.png)\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: null,
				permissionMode: "auto",
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4517, token: null },
			}),
		);
	},
});

try {
	await pause(2500);
	// 打开文件面板再打开文档，和人做的两个动作一样。
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]').click();
		await wait(300);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
		await wait(1200);
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path").endsWith("doc.md"));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(1800);
		return true;
	})()`);
	await pause(1200);

	const seen = (await app.evaluate(`(() => {
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => (r.getAttribute("data-path") || "").endsWith("doc.md"));
		const img = document.querySelector(".prose-dw img");
		return {
			treePath: row ? row.getAttribute("data-path") : null,
			src: img ? img.src : null,
			loaded: img ? img.complete && img.naturalWidth > 0 : null,
		};
	})()`)) as { treePath: string | null; src: string | null; loaded: boolean | null };

	const fromSrc = seen.src?.startsWith("ly-media://")
		? decodeURIComponent(new URL(seen.src).pathname.replace(/^\//, ""))
		: seen.src;

	console.log("\n  配置里的项目路径 :", projectPath);
	console.log("  realpath 解析后  :", realpathSync(projectPath));
	console.log("  文件树给的 path  :", seen.treePath);
	console.log("  img.src 解出来的 :", fromSrc);
	console.log("  图片解码了吗     :", seen.loaded ? "是" : "✗ 否");

	const configPrefix = projectPath.startsWith("/private/");
	const srcPrefix = String(fromSrc ?? "").startsWith("/private/");
	console.log(`\n  配置侧带 /private 前缀：${configPrefix}    图片侧带 /private 前缀：${srcPrefix}`);
	console.log(
		configPrefix === srcPrefix
			? "  两侧前缀一致——403 不是符号链接造成的，得往别处找。"
			: "  两侧前缀不一致——安全门比的是两个写法不同的同一个目录，这就是 403 的来源。",
	);
} finally {
	await app.stop();
}
