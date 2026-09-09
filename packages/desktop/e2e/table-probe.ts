/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * A wide table in a reply, measured in the window that ships it.
 *
 * The component test next door can only check the markup: happy-dom has no layout, so it cannot
 * say whether the table actually overflows, whether the thumb is painted, or whether hovering it
 * changes anything. All three are the feature.
 *
 * Run after `pnpm build`:
 *
 *   node --experimental-strip-types packages/desktop/e2e/table-probe.ts
 *
 * Leaves `/tmp/lyra-table-*.png` behind so the result can be looked at rather than believed.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

/** The table from the report that started this: six rows, three columns, none of them short. */
const TABLE = [
	"这些字段按以下规则变化：",
	"",
	"| 字段 | 一键新机后的合理行为 | 本次处理 |",
	"| --- | --- | --- |",
	"| User-Agent | 跟随环境版本号；选中同版本时可以相同 | 统一网页与原生请求 UA，版本随环境走 |",
	"| 语言 | 保持英文，无需每次变化 | 补充网页 language/languages 覆盖 |",
	"| 时区 | 跟随 GPS / 时区配置；位置相同可以不变 | 接入已有时区覆盖，切换时同步生效 |",
	"| 屏幕、DPR | 跟随机型对应的整套参数 | 补充网页屏幕值及部分派生字段 |",
	"| Canvas、WebGL 像素读回 | 同环境稳定，新环境使用新种子，切回旧环境恢复 | 新增确定性的像素处理，按环境派生 |",
	"| WebGL 硬件信息 | 当前仍返回真实能力 | vendor、renderer、扩展列表一并覆盖 |",
	"",
	"已完成的验证：",
].join("\n");

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	// Narrow enough that the table cannot fit, which is the whole situation being measured.
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1000, height: 820, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1, providers: [], mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4533, token: null },
		}),
	);

	const projectId = createHash("sha256").update(root).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "table", title: "宽表格", cwd: root, projectId, projectName: "project",
		createdAt: 1, updatedAt: 2, modelId: "none", messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 3,
	};
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({ seq: 2, ts: 2, type: "message", message: { role: "user", content: [{ type: "text", text: "这些字段怎么处理的？" }], timestamp: 2 } }),
		JSON.stringify({ seq: 3, ts: 3, type: "message", message: { role: "assistant", content: [{ type: "text", text: TABLE }], timestamp: 3 } }),
	];
	await writeFile(join(home, "sessions", projectId, "table.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

const app = await startApp({ port: 9437, seed });

/** Everything worth knowing about the table, read off the real box. */
const READ = `(() => {
	const host = document.querySelector(".ly-table");
	if (!host) return { found: false };
	const scroll = host.querySelector(".ly-table-scroll");
	const thumb = host.querySelector(".ly-hthumb");
	// The fade is on the positioning wrapper; the button inside it is always fully opaque.
	const slot = host.querySelector(".ly-table-toggle");
	const toggle = host.querySelector(".ly-table-toggle button");
	const scrollBox = scroll.getBoundingClientRect();
	const cell = host.querySelector("tbody td");
	const box = host.getBoundingClientRect();
	return {
		found: true,
		wrap: host.getAttribute("data-wrap"),
		overflow: scroll.scrollWidth - scroll.clientWidth,
		scrollLeft: scroll.scrollLeft,
		thumb: thumb ? { opacity: getComputedStyle(thumb).opacity, width: thumb.getBoundingClientRect().width } : null,
		toggle: toggle ? {
			opacity: getComputedStyle(slot).opacity,
			label: toggle.getAttribute("aria-label"),
			tip: toggle.getAttribute("data-ly-tip"),
			pressed: toggle.getAttribute("aria-pressed"),
			// Inside the frame, and above everything that scrolls: positive means the control's
			// bottom edge is above the scrolling box's top edge, so no cell can ever reach it.
			clearsScrollerBy: Math.round(scrollBox.top - toggle.getBoundingClientRect().bottom),
			insideFrame: Math.round(toggle.getBoundingClientRect().top - box.top),
			rightInset: Math.round(box.right - toggle.getBoundingClientRect().right),
		} : null,
		cellWhiteSpace: cell ? getComputedStyle(cell).whiteSpace : null,
		cellHeight: cell ? Math.round(cell.getBoundingClientRect().height) : null,
		hostWidth: Math.round(box.width),
		hostRight: Math.round(box.right),
		box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
	};
})()`;

const read = () => app.evaluate<Record<string, unknown>>(READ);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mouseTo(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
	await sleep(420); // Longer than --ly-t-base, so a fade has finished rather than been caught mid-way.
}

async function shot(name: string): Promise<void> {
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(`/tmp/lyra-table-${name}.png`, Buffer.from(image.data, "base64"));
}

try {
	// Open the seeded conversation. A real click, because the row is a button the transcript owns.
	const row = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		for (const el of document.querySelectorAll("button")) {
			if (el.textContent && el.textContent.includes("宽表格")) {
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
			}
		}
		return null;
	})()`);
	if (!row) throw new Error("会话行没找到");
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: row.x, y: row.y, button: "left", buttons: 1, clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: row.x, y: row.y, button: "left", buttons: 0, clickCount: 1 });
	await sleep(1600);

	// 1. Pointer parked away from the table: it overflows, and says nothing about it.
	await mouseTo(20, 700);
	const idle = await read();
	console.log("闲置（鼠标不在表格上）:", JSON.stringify(idle));
	if (!idle.found) throw new Error("表格没渲染出来");
	await shot("1-idle");

	/*
	 * 1b. Pointer in the transcript but not on the table — the case the scoped CSS exists for.
	 *
	 * The transcript is a `.ly-scroll-host`, and the app's rule for a sideways thumb is a descendant
	 * selector, so without the narrower rule hovering *anything* in a conversation lit up the bottom
	 * edge of every wide table on screen.
	 */
	const box = idle.box as { x: number; y: number; w: number; h: number };
	await mouseTo(box.x + Math.round(box.w / 2), Math.max(box.y - 40, 120));
	console.log("鼠标在对话里但不在表格上:", JSON.stringify(await read()));

	// 2. Pointer on the table: thumb and control fade in.
	await mouseTo(box.x + Math.round(box.w / 2), box.y + Math.round(box.h / 2));
	const hovered = await read();
	console.log("悬停:", JSON.stringify(hovered));
	await shot("2-hover");

	/*
	 * Where the control is *now*. Re-read before every press, because wrapping makes the table
	 * taller and the transcript is pinned to its bottom — so the whole block moves up under the
	 * pointer, and a second press at the first press's coordinates lands on a table cell.
	 */
	const pressToggle = async () => {
		const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
			const el = document.querySelector(".ly-table-toggle button");
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`);
		if (!at) throw new Error("换行按钮没出现");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none", buttons: 0 });
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
		await sleep(600);
	};

	// 3. Press the control.
	await pressToggle();
	console.log("换行后:", JSON.stringify(await read()));
	await shot("3-wrapped");

	// 4. And back, so the control is not a one-way door.
	await pressToggle();
	console.log("切回:", JSON.stringify(await read()));
	await shot("4-back");

	/*
	 * 4b. The tooltip, which is drawn by a document-level listener rather than by the button.
	 *
	 * Worth measuring rather than assuming: the app once shipped a whole toolbar whose tips never
	 * appeared, because the markup said `data-ly-tip` and the listener read `dataset.dwTip`.
	 */
	const tipAt = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(".ly-table-toggle button");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (tipAt) {
		await mouseTo(tipAt.x, tipAt.y);
		await sleep(900);
		console.log("tooltip:", JSON.stringify(await app.evaluate(`(() => {
			const tip = document.querySelector("[data-ly-tooltip], .ly-tooltip, [role=tooltip]");
			return tip ? { text: tip.textContent.trim(), visible: getComputedStyle(tip).opacity } : { text: null };
		})()`)));
		await shot("6-tooltip");
	}

	// 5. Drag the thumb, which is the other half of "the scrollbar works".
	const after = await read();
	const afterBox = after.box as { x: number; y: number; w: number; h: number };
	await mouseTo(afterBox.x + Math.round(afterBox.w / 2), afterBox.y + Math.round(afterBox.h / 2));
	const thumbBox = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(".ly-table .ly-hthumb");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (!thumbBox) throw new Error("横向滑块没出现");
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: thumbBox.x, y: thumbBox.y, button: "left", buttons: 1, clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumbBox.x + 120, y: thumbBox.y, button: "left", buttons: 1 });
	await sleep(300);
	const dragged = await read();
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: thumbBox.x + 120, y: thumbBox.y, button: "left", buttons: 0, clickCount: 1 });
	console.log("拖动滑块后:", JSON.stringify(dragged));
	await shot("5-dragged");
} finally {
	await app.stop();
}
