/**
 * 一个项目有两个源文件夹时，界面上到底有没有第二个文件夹。
 *
 * 设置里存下了、弹窗里列出来了，都不等于它有用。这个探针量的是三件「用起来」的事：
 *
 *   1. 文件树上两个文件夹各占一行，主文件夹默认展开、另一个默认收着；
 *   2. 只有一个源文件夹的项目，文件树还是直接开在内容上——没有凭空多出一层；
 *   3. `@` 菜单里两个文件夹的东西都在，来自第二个文件夹的那条插进去的是绝对路径
 *      （相对路径会落到主文件夹下，指向一个不存在的文件）。
 *
 * 第三条是这次改动里最容易「看着对、其实错」的一条：菜单里两行都画出来了，插进去的 token
 * 却是同一个相对路径——所以断言读的是 token 本身，不是行数。
 *
 * 用法：node --experimental-strip-types e2e/project-folders-probe.ts ~/Desktop/Lyra项目弹窗测试
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-project-folders";
const root = join(dir, "多源工作区");
const solo = join(root, "solo");
const web = join(root, "web");
const api = join(root, "api");

async function seedSession(home: string, projectId: string, cwd: string, title: string): Promise<void> {
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const at = Date.now() - 60_000;
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = { id: projectId, title, cwd, projectId, projectName: title, createdAt: at, updatedAt: at, modelId: "", messageCount: 1, usage, seq: 2 };
	await writeFile(
		join(home, "sessions", projectId, `${projectId}.jsonl`),
		`${JSON.stringify({ seq: 1, ts: at, type: "meta", meta })}\n` +
			`${JSON.stringify({ seq: 2, ts: at, type: "message", message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: at } })}\n`,
	);
}

const app = await startApp({
	port: 9581,
	async seed(home) {
		// 每个文件夹里放一个只有它才有的文件，这样 `@` 的结果能指认来源。
		await mkdir(join(web, "src"), { recursive: true });
		await writeFile(join(web, "web-only.ts"), "export const web = 1\n");
		await mkdir(join(api, "src"), { recursive: true });
		await writeFile(join(api, "api-only.ts"), "export const api = 1\n");
		await mkdir(join(solo, "src"), { recursive: true });
		await writeFile(join(solo, "solo-only.ts"), "export const solo = 1\n");

		await seedSession(home, "multi", web, "双仓项目");
		await seedSession(home, "solo", solo, "单仓项目");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 940, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [], defaultModelId: null, permissionMode: "auto",
				hooks: [], scheduledTasks: [], disabledPlugins: ["*"], alwaysAllow: [], uiLocale: "zh-CN",
				projects: [
					{ id: "multi", name: "双仓项目", path: web, pinned: false, lastOpenedAt: 2, folders: [web, api] },
					{ id: "solo", name: "单仓项目", path: solo, pinned: false, lastOpenedAt: 1 },
				],
			}),
		);
	},
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(name: string): Promise<void> {
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, name), Buffer.from(png.data, "base64"));
}

const problems: string[] = [];
const check = (ok: boolean, why: string) => {
	if (!ok) problems.push(why);
};

/** 文件树上此刻画出来的行：缩进层级 + 名字，以及它是不是目录。 */
const TREE = `(() => {
	const rows = [...document.querySelectorAll("[data-ly-tree] [data-path]")];
	return rows.map((row) => ({
		path: row.getAttribute("data-path"),
		name: (row.innerText || "").trim().split("\\n")[0],
		// 缩进是 padding-left，不是元素位置——每一行的 left 都一样，量它等于什么都没量。
		indent: Math.round(parseFloat(getComputedStyle(row).paddingLeft)),
		level: Number(row.getAttribute("aria-level") || 0),
	}));
})()`;

interface Row {
	path: string;
	name: string;
	indent: number;
	level: number;
}

async function openFilePanel(): Promise<void> {
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]').click();
		await wait(400);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
		await wait(1400);
	})()`);
	await pause(1400);
}

/** 切到另一个项目：项目行上的「在这里新建会话」是最短的一条路，它顺带换掉工作区。 */
async function switchTo(name: string): Promise<void> {
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const row = [...document.querySelectorAll("[data-ly-project]")].find((r) => r.dataset.lyProject === ${JSON.stringify(name)});
		if (!row) return;
		const button = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("aria-haspopup") || "") === "menu");
		button.click();
		await wait(800);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === "在这里新建会话")?.click();
		await wait(1600);
	})()`);
	await pause(1800);
}

function report(title: string, rows: Row[]): void {
	process.stdout.write(`\n── ${title} ──\n`);
	if (rows.length === 0) {
		process.stdout.write("  （一行都没有）\n");
		return;
	}
	const base = Math.min(...rows.map((r) => r.indent));
	for (const row of rows) process.stdout.write(`  ${" ".repeat(Math.round((row.indent - base) / 8))}${row.name}  ·第${row.level}层\n`);
}

try {
	await mkdir(dir, { recursive: true });
	await pause(3200);
	await openFilePanel();

	// ── 1. 双仓项目：两个源文件夹各一行 ───────────────────────────────────────
	const multi = await app.evaluate<Row[]>(TREE);
	report("双仓项目的文件树", multi);
	await shot("10-文件树-两个源文件夹.png");
	const names = multi.map((r) => r.name);
	check(multi.length > 0, "文件树一行都没画出来");
	check(names[0] === "web", `第一行该是主文件夹 web，实际「${names[0]}」`);
	check(names.includes("api"), "第二个源文件夹 api 没有出现在文件树上");
	check(names.includes("web-only.ts"), "主文件夹该是展开的——打开面板就该看见项目内容");
	check(!names.includes("api-only.ts"), "第二个源文件夹该是收着的，不然一打开就是两屏");
	// 主文件夹的内容要比它自己缩进一级，否则两个文件夹的东西会混成一片。
	const webRow = multi.find((r) => r.name === "web");
	const inner = multi.find((r) => r.name === "web-only.ts");
	check(
		webRow !== undefined && inner !== undefined && inner.indent > webRow.indent && inner.level > webRow.level,
		`主文件夹的内容没有缩进：web 缩进 ${webRow?.indent}px/层级 ${webRow?.level}，web-only.ts 缩进 ${inner?.indent}px/层级 ${inner?.level}`,
	);

	// ── 2. 展开第二个源文件夹 ────────────────────────────────────────────────
	const apiRow = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const row = [...document.querySelectorAll("[data-ly-tree] [data-path]")].find((r) => (r.getAttribute("data-path") || "").endsWith("/api"));
		if (!row) return null;
		const box = row.getBoundingClientRect();
		return { x: Math.round(box.left + 60), y: Math.round(box.top + box.height / 2) };
	})()`);
	check(apiRow !== null, "文件树上找不到 api 那一行");
	if (apiRow) {
		// 真实鼠标：`evaluate` 里的 `.click()` 打不开树行（这个仓库栽过一次）。
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: apiRow.x, y: apiRow.y });
		await pause(200);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", { type, x: apiRow.x, y: apiRow.y, button: "left", clickCount: 1 });
		}
	}
	await pause(1200);
	const opened = await app.evaluate<Row[]>(TREE);
	report("展开 api 之后", opened);
	await shot("11-文件树-展开第二个.png");
	check(opened.some((r) => r.name === "api-only.ts"), "展开 api 之后看不到它里面的文件");

	// ── 3. `@` 菜单：两个文件夹的东西都在，来源分得开 ─────────────────────────
	const mention = await app.evaluate<{ rows: { title: string; origin: string }[] } | null>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const field = document.querySelector(".ly-composer textarea") || document.querySelector("textarea");
		if (!field) return null;
		field.focus();
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "@only");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		await wait(1400);
		const items = [...document.querySelectorAll('[role="option"], [role="menuitem"]')];
		return { rows: items.map((i) => {
			const lines = (i.innerText || "").trim().split("\\n").map((s) => s.trim()).filter(Boolean);
			return { title: lines[0] || "", origin: lines[lines.length - 1] || "" };
		}) };
	})()`);
	process.stdout.write(`\n── @only 的候选 ──\n${(mention?.rows ?? []).map((r) => `  ${r.title}   ←${r.origin}`).join("\n") || "  （没有）"}\n`);
	await shot("12-引用-跨文件夹.png");
	check(mention !== null, "找不到输入框");
	const titles = new Set((mention?.rows ?? []).map((r) => r.title));
	check(titles.has("web-only.ts"), "`@` 里没有主文件夹的文件");
	check(titles.has("api-only.ts"), "`@` 里没有第二个源文件夹的文件——加进来的文件夹在这里还是不存在");

	// 插进去的 token 才是结论：相对路径会落到主文件夹下，指向一个不存在的文件。
	const inserted = await app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const item = [...document.querySelectorAll('[role="option"], [role="menuitem"]')].find((i) => (i.innerText || "").includes("api-only.ts"));
		if (!item) return "（菜单里没有这一条）";
		item.click();
		await wait(900);
		const field = document.querySelector(".ly-composer textarea") || document.querySelector("textarea");
		return field ? field.value.trim() : "（读不到输入框）";
	})()`);
	process.stdout.write(`  选中之后输入框里是：${inserted}\n`);
	await shot("13-引用-插入绝对路径.png");
	check(inserted.includes(api), `第二个源文件夹的文件该以绝对路径插入，实际是「${inserted}」`);

	// ── 4. 单仓项目：树还是直接开在内容上 ────────────────────────────────────
	await switchTo("单仓项目");
	const single = await app.evaluate<Row[]>(TREE);
	report("单仓项目的文件树", single);
	await shot("14-文件树-单个源文件夹.png");
	const soloNames = new Set(single.map((r) => r.name));
	check(single.length > 0, "单仓项目的文件树是空的");
	check(soloNames.has("solo-only.ts"), "单仓项目的文件没画出来");
	check(!soloNames.has("solo"), "单仓项目凭空多了一层根目录行——这是对所有项目的回归");
	check(
		new Set(single.map((r) => r.level)).size === 1 && single[0]?.level === 1,
		`单仓项目的行该全在第一层，实际层级有 ${[...new Set(single.map((r) => r.level))].join("、")}`,
	);

	process.stdout.write(`\n${"─".repeat(64)}\n`);
	if (problems.length === 0) process.stdout.write("全部通过。\n");
	else for (const problem of problems) process.stdout.write(`✗ ${problem}\n`);
	process.stdout.write(`截图：${dir}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
}
