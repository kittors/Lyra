/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 「数据与存储」那一块，在真窗口里的样子和行为。
 *
 * 两件只有真窗口答得了的事：那张月历**画出来**好不好看（层级对不对、有没有被卡片裁掉、选中的一段
 * 是不是连成一条），以及删除是不是真的把文件从磁盘上拿走了。后者尤其不能只看界面——界面说「已删除
 * 12 条」和磁盘上真的少了 12 个文件是两回事，而这中间隔着一整条 IPC。
 *
 * 用临时 home，造 4 条分布在不同日期的会话，删中间那一段，然后数磁盘。
 *
 * Run: LYRA_E2E_ARTIFACTS=~/Desktop/清除统计测试 node --experimental-strip-types e2e/storage-cleanup-probe.ts
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9435;
const PROJECT_ID = "cccccccccccccccc";
const DAY = 86_400_000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 四条会话，最后活动时间分别是 60 / 40 / 20 / 今天。 */
const SESSIONS = [
	{ id: "s-60", daysAgo: 60, replies: 30 },
	{ id: "s-40", daysAgo: 40, replies: 20 },
	{ id: "s-20", daysAgo: 20, replies: 10 },
	{ id: "s-today", daysAgo: 0, replies: 5 },
];

let sessionsDir = "";

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		sessionsDir = join(home, "sessions", PROJECT_ID);
		const project = join(home, "demo-project");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "readme.md"), "# demo\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 940, x: 0, y: 0 }));
		await mkdir(sessionsDir, { recursive: true });

		const now = Date.now();
		const index = [];
		for (const spec of SESSIONS) {
			const at = now - spec.daysAgo * DAY;
			const meta = {
				id: spec.id, title: `固件 ${spec.id}`, cwd: project, projectId: PROJECT_ID, projectName: "demo-project",
				createdAt: at, updatedAt: at, modelId: "relay/gemini-3.8-flash-high", messageCount: spec.replies * 2, seq: 1,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			const lines = [JSON.stringify({ seq: 1, ts: at, type: "meta", meta })];
			let seq = 1;
			for (let i = 0; i < spec.replies; i++) {
				lines.push(JSON.stringify({ seq: ++seq, ts: at, type: "message", message: { role: "user", content: [{ type: "text", text: "。" }], timestamp: at } }));
				lines.push(JSON.stringify({
					seq: ++seq, ts: at, type: "message",
					message: {
						role: "assistant", content: [{ type: "text", text: "。".repeat(200) }], api: "openai-responses",
						provider: "relay", model: "gemini-3.8-flash-high", stopReason: "stop", timestamp: at,
						usage: { input: 40_000, output: 1_200, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 41_200, cost: { input: 0.03, output: 0.0045, cacheRead: 0, cacheWrite: 0, total: 0.0345, source: "catalog", catalogVersion: "2:89dfccad5490", rates: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 } } },
					},
				}));
			}
			await writeFile(join(sessionsDir, `${spec.id}.jsonl`), lines.join("\n") + "\n");
			index.push(meta);
		}
		await mkdir(join(home, "sessions"), { recursive: true });
		await writeFile(join(home, "sessions", "index.json"), JSON.stringify(index, null, 2));

		await writeFile(join(home, "settings.json"), JSON.stringify({
			version: 1,
			providers: [{ id: "relay", name: "公司中转", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "", enabled: true, models: [] }],
			mcpServers: [],
			projects: [{ id: "e2e", name: "demo-project", path: project, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
			alwaysAllow: [], sync: { enabled: false, port: 4523, token: null }, appearance: { theme: "light" },
		}));
	},
});

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
	console.log("  截图:", join(directory, name + ".png"));
}

const logsOnDisk = async () => (await readdir(sessionsDir).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort();

const UI = `
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const label = (element) => (element.innerText || "").replace(/\\s+/g, " ").trim();
	const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.checkVisibility({ visibilityProperty: true }) && label(el) === text);
	const openStorage = async () => {
		click(document.querySelector(".ly-sidebar-foot button"));
		await wait(600);
		const nav = byText("nav button", "存储");
		if (!nav) throw new Error("侧边栏里没有「存储」");
		return nav;
	};
	const cleanup = () => document.querySelector('[data-usage-cleanup="true"]');
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 940, deviceScaleFactor: 2, mobile: false });
	await pause(2_600);

	console.log("磁盘上的日志（删之前）:", await logsOnDisk());

	/*
	 * 先打开一条会话。
	 *
	 * 那个 bug 只在「删掉的正是窗口当前开着的那条」时才发作：窗口不得不从它身上挪开，而从前那一
	 * 挪顺手把视图切回了聊天页。没打开任何会话的话，这条路根本不会走到。
	 */
	const row = await ui<{ id: string; x: number; y: number } | null>(`
		click(byText("button", "聊天"));
		await wait(700);
		const row = document.querySelector("[data-ly-row]");
		if (!row) return null;
		const box = row.getBoundingClientRect();
		return { id: row.dataset.lyRow, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
	`);
	if (!row) throw new Error("侧边栏里一条会话都没有");

	/*
	 * 真实鼠标，不是 evaluate 里的 .click()。
	 *
	 * 会话行认的是真的指针按下与抬起；合成出来的那个 MouseEvent 走不通这条路，行看着被点了，
	 * 会话其实没打开——于是下面那个「删掉的是当前这条」的前提悄悄不成立，探针会给出一个看着
	 * 正常的错结论。
	 */
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: row.x, y: row.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: row.x, y: row.y, button: "left", clickCount: 1 });
	await pause(1_500);

	// 量的是画出来的结果：欢迎页还在，就说明这条会话根本没打开。
	const onSession = await ui<boolean>(`return !/要在 .+ 内开发什么/.test(document.body.innerText);`);
	console.log("打开了会话:", row.id, " 真的进去了:", onSession);
	if (!onSession) throw new Error("会话没打开，后面那条结论不成立");

	const landed = await ui<boolean>(`
		click(await openStorage());
		for (let i = 0; i < 120; i++) {
			if (cleanup()) return true;
			await wait(100);
		}
		return false;
	`);
	console.log("清理面板出现:", landed);
	if (!landed) throw new Error("「数据与存储」没画出来");

	console.log("\n面板文字:", await ui<string>(`return label(cleanup());`));
	await shot("1-数据与存储");

	/*
	 * 把月历打开，量它画出来的样子。
	 *
	 * 问的是「有没有被裁掉」而不是「在不在 DOM 里」：这一块排在页面最后，浮层要是跟着卡片的
	 * overflow 走，它会被切掉半张——而元素照样在，`querySelector` 照样找得到。
	 */
	const panel = await ui<{ open: boolean; width: number; height: number; clipped: boolean; zIndex: string; shortcuts: string[]; shortcutRows: number; room: { available: number; needed: number }; dividers: number }>(`
		click(cleanup().querySelector("[data-ly-date-range]"));
		await wait(400);
		const panel = document.querySelector('[role="dialog"][data-ly-popover], [data-ly-popover][role="dialog"]')
			?? [...document.querySelectorAll('[role="dialog"]')].find((el) => el.querySelector("[data-ly-day]"));
		if (!panel) return { open: false, width: 0, height: 0, clipped: true, zIndex: "", shortcuts: [], shortcutRows: 0, room: { available: 0, needed: 0 }, dividers: -1 };
		const box = panel.getBoundingClientRect();
		const card = cleanup().getBoundingClientRect();
		return {
			open: true,
			width: Math.round(box.width),
			height: Math.round(box.height),
			// 卡片底下还有空间、而面板却超出了窗口，就是被挤了。
			clipped: box.bottom > window.innerHeight + 1 || box.top < 0,
			zIndex: getComputedStyle(panel).zIndex,
			shortcuts: [...panel.querySelectorAll("[data-ly-range-shortcut]")].map(label),
			// 快捷项占了几行。四个并列的答案排成「三个加一个」，读起来像分了组——差一个像素就会这样。
			shortcutRows: new Set([...panel.querySelectorAll("[data-ly-range-shortcut]")].map((el) => Math.round(el.getBoundingClientRect().top))).size,
			/*
			 * 快捷那一排还剩多少地方。
			 *
			 * 「够不够放得下」用眼睛看不出来——差一个像素和差三十个像素，截图上都是「掉到第二行」。
			 * 这两个数是唯一能回答「该加宽面板还是该收紧药丸」的东西。
			 */
			room: (() => { const row = panel.querySelector("[data-ly-range-shortcut]").parentElement; const pills = [...row.children].map((el) => el.getBoundingClientRect().width); return { available: Math.round(row.clientWidth), needed: Math.round(pills.reduce((a, b) => a + b, 0) + (pills.length - 1) * 4) }; })(),
			// 「不用间隔线」：面板里不该有任何一条横着的边。
			dividers: [...panel.querySelectorAll("*")].filter((el) => {
				const s = getComputedStyle(el);
				return (parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0) && el.getBoundingClientRect().width > 100;
			}).length,
		};
	`);
	console.log("\n=== 月历面板 ===");
	console.log(panel);
	await shot("2-日期选择器");

	// 选一段：40 天前那条落在里面，60 天前和 20 天前的不在。
	const picked = await ui<{ label: string; selected: string[]; fits: boolean; needs: number }>(`
		const days = [...document.querySelectorAll("[data-ly-day]:not([disabled])")].map((el) => el.dataset.lyDay).sort();
		const today = new Date();
		const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
		const at = (back) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back); return key(d); };
		const from = at(50), to = at(30);
		const pick = (k) => { const el = document.querySelector('[data-ly-day="' + k + '"]'); if (el) click(el); };
		// 月历开在当月，往回翻两个月才够得到 50 天前。
		for (let i = 0; i < 3; i++) {
			if (document.querySelector('[data-ly-day="' + from + '"]')) break;
			click(document.querySelector('[aria-label="上个月"]'));
			await wait(150);
		}
		pick(from);
		await wait(150);
		for (let i = 0; i < 3; i++) {
			if (document.querySelector('[data-ly-day="' + to + '"]')) break;
			click(document.querySelector('[aria-label="下个月"]'));
			await wait(150);
		}
		pick(to);
		await wait(300);
		void days;
		const field = cleanup().querySelector("[data-ly-date-range]");
		const text = field.querySelector("span");
		return {
			label: label(field),
			selected: [...document.querySelectorAll("[data-ly-day][data-selected]")].map((el) => el.dataset.lyDay),
			// 字段装不装得下里面那行字。装不下就会截断成「2026/8/2 – 2026/8…」，而日期截断了等于没写。
			fits: text.scrollWidth <= text.clientWidth,
			needs: Math.ceil(field.getBoundingClientRect().width + (text.scrollWidth - text.clientWidth)),
		};
	`);
	console.log("\n=== 选了一段 ===");
	console.log("字段上印着:", picked.label, " 端点:", picked.selected);
	console.log("这行字装得下吗:", picked.fits, " 字段要多宽:", picked.needs);
	await shot("3-选中一段");

	/*
	 * 布局稳不稳：选完日期之后，那三行还在原来的位置上吗。
	 *
	 * 从前这一块是一行 `flex-wrap`，右边那组一变宽就整组换行——同一张卡片，选完日期长得完全是
	 * 另一个样子。截图上看得出来，但看不出来是「差一点」还是「差很多」，所以量行的纵坐标。
	 */
	const layout = await ui<{ rows: number; movedBy: number[] }>(`
		const tops = () => [...cleanup().querySelectorAll("[data-settings-row]")].map((el) => Math.round(el.getBoundingClientRect().top));
		const before = tops();
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await wait(300);
		const after = tops();
		return { rows: before.length, movedBy: after.map((top, i) => top - before[i]) };
	`);
	console.log("\n=== 布局 ===");
	console.log("行数:", layout.rows, " 选完日期之后各行挪了:", layout.movedBy, "px");

	/*
	 * 全部清掉——**包括窗口当前开着的那条**。
	 *
	 * 这是那个 bug 的复现条件：当前会话被删，窗口不得不从它身上挪开，而从前那一挪顺手把视图切回
	 * 了聊天页。人明明在设置页按的清除，屏幕却跳去了对话页，中间没有任何东西解释发生了什么。
	 */
	await ui(`
		click(cleanup().querySelector("[data-ly-date-range]"));
		await wait(400);
		const all = [...document.querySelectorAll("[data-ly-range-shortcut]")].find((el) => label(el) === "全部时间");
		if (!all) throw new Error("面板里没有「全部时间」");
		click(all);
		await wait(300);
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await wait(400);
	`);

	// 点清除，走完确认。
	const cleared = await ui<{ asked: string; confirmed: boolean; done: string; stayed: boolean; frames: number; framesAway: number }>(`
		click(cleanup().querySelector("[data-usage-clear]"));
		await wait(400);
		const dialog = document.querySelector("[data-ly-modal]");
		const asked = dialog ? label(dialog) : "(没有确认框)";
		const confirm = dialog && dialog.querySelector("button.ly-dialog-action-danger");
		if (confirm) click(confirm);
		/*
		 * 逐帧盯着，不是等一会儿再看一眼。
		 *
		 * 「跳去对话页又跳回来」和「一直没动」在事后的一次采样里长得一模一样。要问的是这两秒里
		 * 有没有哪一帧不在设置页上，那就得每一帧都问。
		 */
		let framesAway = 0;
		let frames = 0;
		const deadline = performance.now() + 2000;
		await new Promise((resolve) => {
			const step = () => {
				frames += 1;
				if (!cleanup()) framesAway += 1;
				if (performance.now() > deadline) resolve(); else requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
		const stayed = Boolean(cleanup());
		return { asked, confirmed: Boolean(confirm), done: stayed ? label(cleanup()) : "(已经不在设置页了)", stayed, frames, framesAway };
	`);
	console.log("\n=== 确认并删除 ===");
	console.log("问了什么:", cleared.asked);
	console.log("按了确认:", cleared.confirmed);
	console.log("删完还在设置页:", cleared.stayed, ` （两秒 ${cleared.frames} 帧里，有 ${cleared.framesAway} 帧不在设置页）`);
	console.log("面板现在说:", cleared.done);
	await shot("4-删除之后");

	console.log("\n磁盘上的日志（删之后）:", await logsOnDisk());

	/*
	 * 删完回工作区，看那条被删的会话在渲染层有没有真的消失。
	 *
	 * 这一步是为了分清两件事：广播压根没到（那跳不跳都和这段代码无关），还是到了、列表更新了、
	 * 只是没有把人带走。
	 */
	const back = await ui<{ rows: number; welcome: boolean }>(`
		const home = byText("button", "返回工作区");
		if (home) click(home);
		await wait(1200);
		return {
			rows: document.querySelectorAll("[data-ly-row]").length,
			welcome: /要在 .+ 内开发什么/.test(document.body.innerText),
		};
	`);
	console.log("回到工作区：侧边栏还有", back.rows, "条会话，欢迎页", back.welcome ? "在" : "不在");
} finally {
	await app.stop();
}
