/**
 * 「新建项目」和「编辑项目」这两个弹窗，在真窗口里到底能不能用。
 *
 * jsdom 证明得了「点了之后写进设置的值是对的」，证明不了三件这次改动最容易翻车的事：侧边栏
 * 「项目」那一行悬停时 + 号真的画出来了（它是绝对定位压在计数上的，opacity 从 0 到 1）；
 * 「添加文件夹」按下去真的把一行加进列表（那一步要过原生目录选择器）；以及右键菜单上少掉的
 * 三项真的少了、「编辑项目」真的接上了弹窗——「代码在、功能不在」在这个仓库出现过十六次，
 * 最常见的形态就是「组件写好了、入口没接上」。
 *
 * 原生目录选择器在主进程里换掉：`dialog.showOpenDialog` 会弹一张真的 macOS 表单并且一直等，
 * 探针按下去就是挂住。换的是 `electron_browser_dialog` 上的那个方法本身，不是渲染端的
 * `window.lyra`——后者是冻结的，改不动。
 *
 * 用法：node --experimental-strip-types e2e/project-dialog-probe.ts ~/Desktop/Lyra项目弹窗测试
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-project-dialog";
const root = join(dir, "工作区");
const solo = join(root, "solo");
const web = join(root, "web");
const api = join(root, "api");
/** 两个待加入的文件夹，「添加文件夹」那一步指向它们。 */
const extra = join(root, "design");

/**
 * 一个项目要在「项目」那一段里占一行，得有会话。
 *
 * 未置顶又一条会话都没有的项目本来就不列行（`grouping.ts` 里那条规则，早于这次改动）——
 * 第一次跑这个探针时整片红，原因就是这个：侧边栏画的是「还没有会话」，而断言在找那一行。
 * `seq` 从 1 起：写 0 的 meta 会被静默读掉，那条会话连侧边栏都进不去。
 */
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
	port: 9571,
	inspectPort: 9572,
	async seed(home) {
		for (const path of [solo, web, api, extra]) {
			await mkdir(join(path, "src"), { recursive: true });
			await writeFile(join(path, "readme.md"), `# ${path}\n`);
		}
		await seedSession(home, "solo", solo, "单仓项目");
		await seedSession(home, "multi", web, "双仓项目");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 940, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [], defaultModelId: null, permissionMode: "auto",
				hooks: [], scheduledTasks: [], disabledPlugins: ["*"], alwaysAllow: [], uiLocale: "zh-CN",
				projects: [
					{ id: "solo", name: "单仓项目", path: solo, pinned: false, lastOpenedAt: 2 },
					// 一个已经配好两个源文件夹的项目——编辑弹窗和文件树都拿它当样本。
					{ id: "multi", name: "双仓项目", path: web, pinned: false, lastOpenedAt: 1, folders: [web, api] },
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

async function moveTo(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await pause(260);
}

async function clickAt(x: number, y: number): Promise<void> {
	await moveTo(x, y);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	}
	await pause(600);
}

async function centreOf(selector: string): Promise<{ x: number; y: number } | null> {
	return app.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const box = el.getBoundingClientRect();
		if (box.width < 1 || box.height < 1) return null;
		return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
	})()`);
}

async function clickOn(selector: string, why: string): Promise<boolean> {
	const spot = await centreOf(selector);
	if (!spot) {
		problems.push(`${why}：界面上找不到 ${selector}`);
		return false;
	}
	await clickAt(spot.x, spot.y);
	return true;
}

const problems: string[] = [];
const check = (ok: boolean, why: string) => {
	if (!ok) problems.push(why);
};

/** 把弹窗此刻的样子量回来。文件夹行读的是 data 属性，不是文字。 */
const DIALOG = `(() => {
	const form = document.querySelector("[data-ly-project-dialog]");
	const card = document.querySelector("[data-ly-dialog]");
	if (!form || !card) return { open: false };
	const name = form.querySelector("input");
	const actions = [...card.querySelectorAll("[data-ly-dialog-actions] button")];
	return {
		open: true,
		mode: form.dataset.lyProjectDialog,
		title: (card.querySelector("[data-dialog-title]") || {}).innerText || "",
		nameValue: name ? name.value : null,
		namePlaceholder: name ? name.placeholder : null,
		folders: [...form.querySelectorAll("[data-ly-source-folder]")].map((row) => row.dataset.lySourceFolder),
		labels: [...form.querySelectorAll("[data-ly-source-folder] span")].map((s) => s.innerText.trim()).filter(Boolean),
		actions: actions.map((b) => ({ text: b.innerText.trim(), disabled: b.disabled })),
		width: Math.round(card.getBoundingClientRect().width),
	};
})()`;

interface DialogState {
	open: boolean;
	mode?: string;
	title?: string;
	nameValue?: string | null;
	namePlaceholder?: string | null;
	folders?: string[];
	labels?: string[];
	actions?: { text: string; disabled: boolean }[];
	width?: number;
}

const readDialog = () => app.evaluate<DialogState>(DIALOG);

/** 让主进程下一次（或接下来几次）目录选择直接返回这些路径，不弹真表单。 */
async function answerPicker(paths: string[]): Promise<boolean> {
	return app.main<boolean>(`(() => {
		const binding = process._linkedBinding("electron_browser_dialog");
		if (!binding || typeof binding.showOpenDialog !== "function") return false;
		const queue = ${JSON.stringify(paths)};
		if (!globalThis.__probeOriginalOpen) globalThis.__probeOriginalOpen = binding.showOpenDialog;
		binding.showOpenDialog = function () {
			const next = queue.shift();
			return Promise.resolve(next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] });
		};
		return true;
	})()`);
}

function report(title: string, state: DialogState): void {
	process.stdout.write(`\n── ${title} ──\n`);
	if (!state.open) {
		process.stdout.write("  弹窗没开\n");
		return;
	}
	process.stdout.write(`  形态 ${state.mode}    标题「${state.title}」    宽 ${state.width}px\n`);
	process.stdout.write(`  名称 「${state.nameValue}」（占位「${state.namePlaceholder}」）\n`);
	process.stdout.write(`  源文件夹 ${state.folders?.length ?? 0} 个：${(state.labels ?? []).join(" / ") || "（空）"}\n`);
	process.stdout.write(`  按钮 ${(state.actions ?? []).map((a) => `${a.text}${a.disabled ? "（禁用）" : ""}`).join("  ") || "（无）"}\n`);
}

try {
	await mkdir(dir, { recursive: true });
	await pause(3000);
	await shot("00-启动.png");

	// ── 1. 「项目」标题悬停出 + 号 ────────────────────────────────────────────
	const plusIdle = await app.evaluate<{ opacity: string; count: string } | null>(`(() => {
		const head = document.querySelector('[data-ly-section="projects"]');
		const row = head ? head.parentElement : null;
		const holder = row ? row.querySelector("[data-ly-section-action]") : null;
		const counter = row ? row.querySelector("[data-ly-section-count]") : null;
		if (!holder || !counter) return null;
		return { opacity: getComputedStyle(holder).opacity, count: getComputedStyle(counter).opacity };
	})()`);
	check(plusIdle !== null, "侧边栏「项目」那一行上没有 + 号的容器");
	check(plusIdle?.opacity === "0", `没悬停时 + 号该是透明的，实际 opacity=${plusIdle?.opacity}`);
	process.stdout.write(`\n── 「项目」标题 ──\n  静止时 +号 opacity=${plusIdle?.opacity}  计数 opacity=${plusIdle?.count}\n`);

	const headSpot = await centreOf('[data-ly-section="projects"]');
	check(headSpot !== null, "找不到「项目」标题");
	if (headSpot) await moveTo(headSpot.x, headSpot.y);
	await pause(500);
	const plusHover = await app.evaluate<{ opacity: string; count: string } | null>(`(() => {
		const head = document.querySelector('[data-ly-section="projects"]');
		const row = head ? head.parentElement : null;
		const holder = row ? row.querySelector("[data-ly-section-action]") : null;
		const counter = row ? row.querySelector("[data-ly-section-count]") : null;
		if (!holder || !counter) return null;
		return { opacity: getComputedStyle(holder).opacity, count: getComputedStyle(counter).opacity };
	})()`);
	process.stdout.write(`  悬停时 +号 opacity=${plusHover?.opacity}  计数 opacity=${plusHover?.count}\n`);
	check(plusHover?.opacity === "1", `悬停时 + 号该完全画出来，实际 opacity=${plusHover?.opacity}`);
	check(plusHover?.count === "0", `悬停时计数该让位给 + 号，实际 opacity=${plusHover?.count}`);
	await shot("01-项目标题悬停出加号.png");

	// ── 2. 点 + 打开创建弹窗（空态）────────────────────────────────────────────
	const opened = await clickOn('[aria-label="新建项目"]', "点 + 号");
	await pause(700);
	const empty = await readDialog();
	report("创建项目（空态）", empty);
	await shot("02-创建项目-空态.png");
	check(opened && empty.open, "点 + 号没有打开创建弹窗");
	check(empty.mode === "create", `打开的不是创建形态，是 ${empty.mode}`);
	check(empty.title === "创建项目", `标题该是「创建项目」，实际「${empty.title}」`);
	check(empty.folders?.length === 0, "空态下不该已经有文件夹");
	check(
		empty.actions?.some((a) => a.text === "创建项目" && a.disabled) === true,
		"一个文件夹都没选的时候「创建项目」该是禁用的",
	);
	check(empty.actions?.some((a) => a.text === "移除本地项目") !== true, "创建的时候不该有「移除本地项目」");

	// ── 3. 添加两个文件夹 ─────────────────────────────────────────────────────
	const mocked = await answerPicker([extra, api]);
	check(mocked, "拦不住原生目录选择器——这一段没验成");
	if (mocked) {
		await clickOn('[data-ly-add-folder]', "点空态里的「添加」");
		await pause(800);
		const one = await readDialog();
		report("添加第一个文件夹", one);
		await shot("03-创建项目-一个文件夹.png");
		check(one.folders?.length === 1, `该有 1 个文件夹，实际 ${one.folders?.length}`);
		check(one.folders?.[0] === extra, `第一个文件夹该是 ${extra}，实际 ${one.folders?.[0]}`);
		check(
			one.actions?.some((a) => a.text === "创建项目" && !a.disabled) === true,
			"有了文件夹之后「创建项目」该能点了",
		);

		await clickOn('[data-ly-add-folder]', "点「添加文件夹」");
		await pause(800);
		const two = await readDialog();
		report("添加第二个文件夹", two);
		await shot("04-创建项目-两个文件夹.png");
		check(two.folders?.length === 2, `该有 2 个文件夹，实际 ${two.folders?.length}`);
		check(two.folders?.[1] === api, `第二个文件夹该是 ${api}，实际 ${two.folders?.[1]}`);

		// ── 4. 填名字并创建 ───────────────────────────────────────────────────
		const nameSpot = await centreOf("[data-ly-project-dialog] input");
		if (nameSpot) {
			await clickAt(nameSpot.x, nameSpot.y);
			for (const text of ["设计与接口"]) {
				await app.send("Input.insertText", { text });
			}
			await pause(400);
		}
		await shot("05-创建项目-填了名字.png");
		const created = await app.evaluate<boolean>(`(() => {
			const buttons = [...document.querySelectorAll("[data-ly-dialog-actions] button")];
			const go = buttons.find((b) => b.innerText.trim() === "创建项目");
			if (!go) return false;
			go.click();
			return true;
		})()`);
		check(created, "找不到「创建项目」按钮");
		await pause(2200);
		await shot("06-创建之后.png");

		/*
		 * 新建的项目在输入框那一栏上，不在侧边栏上——而且这是对的。
		 *
		 * 未置顶又一条会话都没有的项目不列行，是早于这次改动的规则（`grouping.ts`）。创建之后
		 * 窗口会切到它，所以「名字是不是用户输入的那个」要问输入框上的项目芯片，那是此刻唯一
		 * 说得出当前项目叫什么的地方。
		 */
		const after = await app.evaluate<{ chip: string | null; rows: string[] }>(`(() => ({
			chip: (() => {
				const chip = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "设计与接口");
				return chip ? chip.innerText.trim() : null;
			})(),
			rows: [...document.querySelectorAll("[data-ly-project]")].map((r) => r.dataset.lyProject),
		}))()`);
		process.stdout.write(`\n── 创建之后 ──\n  当前项目「${after.chip ?? "（没找到）"}」  侧边栏 ${after.rows.join(" / ")}\n`);
		check(after.chip === "设计与接口", "创建之后没有切到新项目，或者名字不是输入的那个");
	}

	// ── 5. 项目菜单：少掉三项，多出「编辑项目」────────────────────────────────
	const menu = await app.evaluate<{ items: string[] } | null>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const row = [...document.querySelectorAll("[data-ly-project]")].find((r) => r.dataset.lyProject === "双仓项目");
		if (!row) return null;
		const button = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("aria-haspopup") || "") === "menu");
		if (!button) return null;
		button.click();
		await wait(900);
		return { items: [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.innerText.trim()).filter(Boolean) };
	})()`);
	process.stdout.write(`\n── 双仓项目的菜单 ──\n  ${menu?.items.join(" / ") ?? "（没打开）"}\n`);
	await shot("07-项目菜单.png");
	check(menu !== null, "打不开项目菜单");
	const items = menu?.items ?? [];
	check(!items.includes("切换到这个项目"), "「切换到这个项目」还在菜单上");
	check(!items.includes("创建永久工作树"), "「创建永久工作树」还在菜单上");
	check(!items.includes("重命名"), "「重命名」还在菜单上——它该并进「编辑项目」了");
	check(items.includes("编辑项目"), "菜单上没有「编辑项目」");
	check(items.includes("在这里新建会话"), "「在这里新建会话」不该被删掉");
	check(items.some((i) => i.startsWith("归档聊天")), "「归档聊天」不该被删掉");
	check(items.includes("移除"), "「移除」不该被删掉");

	// ── 6. 编辑弹窗：两个文件夹、能改名、有移除 ──────────────────────────────
	const toEdit = await app.evaluate<boolean>(`(() => {
		const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === "编辑项目");
		if (!item) return false;
		item.click();
		return true;
	})()`);
	check(toEdit, "点不到「编辑项目」");
	await pause(900);
	const editing = await readDialog();
	report("编辑项目", editing);
	await shot("08-编辑项目.png");
	check(editing.open, "「编辑项目」没有打开弹窗");
	check(editing.mode === "edit", `打开的不是编辑形态，是 ${editing.mode}`);
	check(editing.title === "编辑项目", `标题该是「编辑项目」，实际「${editing.title}」`);
	check(editing.nameValue === "双仓项目", `名称框该带着现在的名字，实际「${editing.nameValue}」`);
	check(editing.folders?.length === 2, `该显示 2 个源文件夹，实际 ${editing.folders?.length}`);
	check(editing.folders?.[0] === web && editing.folders?.[1] === api, `源文件夹不对：${editing.folders?.join("、")}`);
	check(editing.actions?.some((a) => a.text === "移除本地项目") === true, "编辑弹窗上没有「移除本地项目」");
	check(editing.actions?.some((a) => a.text === "保存") === true, "编辑弹窗上没有「保存」");
	// 主文件夹那一行不给叉：它是会话跑在里面的目录，删掉等于项目没了。
	check(
		(editing.labels ?? []).includes("主文件夹"),
		"主文件夹那一行没有标出来——不然用户会以为它能删",
	);

	process.stdout.write(`\n${"─".repeat(64)}\n`);
	if (problems.length === 0) process.stdout.write("全部通过。\n");
	else for (const problem of problems) process.stdout.write(`✗ ${problem}\n`);
	process.stdout.write(`截图：${dir}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
}
