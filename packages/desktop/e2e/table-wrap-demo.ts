/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 表格换行图标跟代码块复制按钮同一座位：框内右上角，不另占一行，表头右沿用底色托住字。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/table-wrap-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra表格换行图标测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9783;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const TABLE = [
	"## 7. 未决事项与依赖项 (Unknownness)",
	"",
	"| 未决事项 | 一键新机后的合理行为 | 影响范围 |",
	"| --- | --- | --- |",
	"| Cloudflare Worker CRON 触发频率限制（免费/按量计划下的最高频率） | 跟随环境版本号；选中同版本时可以相同 | hour |",
	"| 是否需要支持自定义插件整体导出为 `.tar.gz` 离线包 | 补充网页 language/languages 覆盖，并保持英文 | 满足 |",
	"",
	"Plan approved. To implement: saying \"implement this plan now\".",
].join("\n");

type Geometry = {
	wrap: string | null;
	hasBar: boolean;
	hasFrame: boolean;
	hasCorner: boolean;
	hostH: number;
	headerH: number;
	opacity: number;
	inCorner: boolean;
	inHeader: boolean;
	overlap: boolean;
	overflow: number;
	insetRight: number;
};

const READ = `(() => {
	const host = document.querySelector(".ly-table");
	if (!host) return null;
	const header = host.querySelector("thead th");
	const corner = host.querySelector(".ly-table-corner");
	const toggle = host.querySelector("button.ly-table-toggle");
	if (!header) return null;
	const hostBox = host.getBoundingClientRect();
	const headBox = header.getBoundingClientRect();
	const cornerBox = corner?.getBoundingClientRect();
	const btn = toggle?.getBoundingClientRect();
	const safeRight = cornerBox ? cornerBox.left + 16 : hostBox.right;
	const range = document.createRange();
	const overlap = btn
		? [...host.querySelectorAll("thead th")].some((th) => {
			range.selectNodeContents(th);
			const box = range.getBoundingClientRect();
			const right = Math.min(box.right, safeRight, hostBox.right);
			const left = Math.max(box.left, hostBox.left);
			return right > left + 1 && right > btn.left + 1 && left < btn.right - 1 && box.bottom > btn.top + 1 && box.top < btn.bottom - 1;
		})
		: false;
	const scroll = host.querySelector(".ly-table-scroll");
	return {
		wrap: host.getAttribute("data-wrap"),
		hasBar: Boolean(host.querySelector(".ly-table-bar")),
		hasFrame: Boolean(host.querySelector(".ly-table-frame")),
		hasCorner: Boolean(corner),
		hostH: Math.round(hostBox.height),
		headerH: Math.round(headBox.height),
		opacity: toggle ? Number(getComputedStyle(toggle).opacity) : 0,
		inCorner: Boolean(btn && btn.right <= hostBox.right + 1 && btn.left >= hostBox.right - 44),
		inHeader: Boolean(btn && btn.top >= headBox.top - 2 && btn.bottom <= headBox.bottom + 2),
		overlap,
		overflow: scroll ? Math.round(scroll.scrollWidth - scroll.clientWidth) : 0,
		insetRight: btn ? Math.round(hostBox.right - btn.right) : -1,
	};
})()`;

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1080, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4579, token: null },
			appearance: { contentWidth: 480 },
		}),
	);
	const projectId = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "table-wrap",
		title: "未决事项表",
		cwd: project,
		projectId,
		projectName: "proj",
		createdAt: 1,
		updatedAt: 2,
		modelId: "none",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 3,
	};
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({ seq: 2, ts: 2, type: "message", message: { role: "user", content: [{ type: "text", text: "未决事项列一下" }], timestamp: 2 } }),
		JSON.stringify({ seq: 3, ts: 3, type: "message", message: { role: "assistant", content: [{ type: "text", text: TABLE }], timestamp: 3 } }),
	];
	await writeFile(join(home, "sessions", projectId, "table-wrap.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function mouseTo(x: number, y: number) {
		await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
		await pause(420);
	}
	const read = () => app!.evaluate<Geometry | null>(READ);

	const row = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		for (const el of document.querySelectorAll("button")) {
			if (el.textContent && el.textContent.includes("未决事项表")) {
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
			}
		}
		return null;
	})()`);
	if (row) {
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: row.x, y: row.y, button: "left", buttons: 1, clickCount: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: row.x, y: row.y, button: "left", buttons: 0, clickCount: 1 });
	}
	await until(`Boolean(document.querySelector(".ly-table"))`);
	await pause(600);

	await mouseTo(20, 700);
	const idle = await read();
	if (!idle) throw new Error("表格没渲染出来");
	check("no reserved bar or outside rail", !idle.hasBar && !idle.hasFrame && idle.hasCorner, idle);
	check("icon is idle until hover", idle.opacity < 0.1, idle);
	await hold(1200);

	const box = await app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
		const r = document.querySelector(".ly-table").getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	})()`);
	await mouseTo(box.x + box.w / 2, box.y + box.h / 2);
	const hovered = await read();
	if (!hovered) throw new Error("悬停后表格丢了");
	check(
		"hover does not grow a toolbar row",
		hovered.hostH === idle.hostH,
		{ idleH: idle.hostH, hoverH: hovered.hostH, hovered },
	);
	check("hover reveals the wrap icon", hovered.opacity > 0.9, hovered);
	check(
		"icon sits in the fence copy seat",
		hovered.inCorner && hovered.inHeader && hovered.insetRight >= 6 && hovered.insetRight <= 12 && !hovered.overlap,
		hovered,
	);
	await hold(1400);

	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("button.ly-table-toggle");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (!at) throw new Error("换行按钮没出现");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none", buttons: 0 });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
	await pause(500);

	const wrappedBox = await app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
		const r = document.querySelector(".ly-table").getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	})()`);
	await mouseTo(wrappedBox.x + Math.min(40, wrappedBox.w / 2), wrappedBox.y + 16);
	const wrapped = await read();
	if (!wrapped) throw new Error("换行后表格丢了");
	check("wrap still toggles", wrapped.wrap === "true", wrapped);
	check("wrapped icon does not cover header text", wrapped.inCorner && wrapped.inHeader && !wrapped.overlap, wrapped);
	await hold(1600);

	await mouseTo(20, 700);
	const left = await read();
	check("leaving hides the icon again without moving the table", Boolean(left && left.opacity < 0.1 && left.hostH === wrapped.hostH), left);
	await hold(900);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_表格换行图标_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
