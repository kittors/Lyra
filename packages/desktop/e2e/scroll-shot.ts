/**
 * 文件预览的滚动条，拍给人看。
 *
 * `node --experimental-strip-types e2e/scroll-shot.ts [dir]`
 *
 * `scrollbar-probe.ts` 出的是数字，这里出的是图。滑块平时 `opacity: 0`，`.ly-scroll-host:hover`
 * 才显出来——所以拍之前得先把鼠标真的挪到预览上面去，靠 CDP 派发，页面里 `dispatchEvent` 造的
 * MouseEvent 不改变 `:hover`。角落那一块另外拍一张放大的：两条轨道让没让开，差的就是那 10px。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-scroll-shot";
const project = join(dir, "proj");

const SHORT = Array.from({ length: 35 }, (_, i) => `line-${i + 1}`).join("\n");
/** 超长的那行排在第一行，一打开两个方向就都溢出。 */
const LONG = Array.from({ length: 120 }, (_, i) =>
	i === 0 ? `const wide = "${"x".repeat(400)}";` : `const n${i} = ${i};`,
).join("\n");

const app = await startApp({
	port: 9715,
	seed: async (home) => {
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "short.txt"), SHORT);
		await writeFile(join(project, "long.ts"), LONG);
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1500, height: 950, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4527, token: null },
				appearance: { theme: "dark" },
			}),
		);
	},
});
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

const open = (name: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector("[data-ly-tree]")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(300);
			[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
			await wait(1400);
		}
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path")?.endsWith(${JSON.stringify(name)}));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(2000);
		return Boolean(row);
	})()`);

/** 编辑器所在的矩形，用来决定鼠标挪去哪、角落特写从哪切。 */
const boxOf = () =>
	app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
		const host = document.querySelector(".cm-scroller")?.closest(".ly-scroll-host");
		const r = host.getBoundingClientRect();
		return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
	})()`);

/** 真的把指针挪过去——`:hover` 只认这个。 */
async function hover(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
	await settle(600);
}

const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number; scale: number }) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
	process.stdout.write(`  拍了 ${name}.png\n`);
};

try {
	await mkdir(dir, { recursive: true });
	await settle(2800);

	/* 文件树收起来，把右边整条让给预览——不然编辑器只剩窗口底下那一小块，滚动条小到看不出所以然。 */
	await open("short.txt");
	await settle(1200);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const tree = document.querySelector("[data-ly-tree]")?.closest("[class*='rounded']");
		const close = tree ? [...tree.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("关闭")) : null;
		close?.click();
		await wait(1200);
		return Boolean(close);
	})()`);
	await settle(1200);

	for (const [file, label] of [["short.txt", "short"], ["long.ts", "long"]] as const) {
		await open(file);
		await settle(1600);
		/* 推到尽头，两个滑块才会走到角落上——那里正是它们从前互相压住的地方。 */
		await app.evaluate(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const el = document.querySelector(".cm-scroller");
			el.scrollTop = 1e9;
			el.scrollLeft = 1e9;
			await wait(600);
			return true;
		})()`);
		const box = await boxOf();
		await hover(box.x + box.w / 2, box.y + box.h / 2);
		process.stdout.write(`${file}  编辑器 ${box.w}x${box.h} @ (${box.x},${box.y})\n`);
		await shot(`${label}-full`, { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 });
		// 右下角 80×80 放大六倍：两条轨道的末端就在这里相遇。
		await shot(`${label}-corner`, {
			x: box.x + box.w - 80,
			y: box.y + box.h - 80,
			width: 80,
			height: 80,
			scale: 6,
		});
	}
} finally {
	await app.stop();
}
