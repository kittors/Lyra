/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 审计整改的三批改动，在真窗口里各量一个数，边验边录。
 *
 * 三批各自缺的证据不一样：
 *
 *   **C1**（五个工具从没被告知给模型）。归一之后 core 的测试是绿的，但那些测试读的是同一个常量。
 *   真正的问题当初正是「静态表和 kernel 表漂了」——两张表各自自洽、合起来不对。所以这里问的是桌面
 *   端**跑起来之后**的那份工具清单里有没有 `recall`/`rule`/`learn`/`lsp`/`web_search`，走的是设置
 *   页上真的画出来的那排名字，不是任何一张源码里的表。审计报告自己也把这一条列在「没有验证的」。
 *
 *   **H2**（新加的「禁止命令联网」开关）。这一节是这一轮才有的，单测里没有它，而它在 Windows 上
 *   长得不一样（那台机器上的沙箱断不了网，所以不给开关、给一句说明）。
 *
 *   **I1**（四条漏网的硬编码中文）。改成 `t()` 之后 happy-dom 的组件测试能证明键存在，证明不了它
 *   在真窗口里被读出来——而这四条本来就是「检查说绿、实际有洞」的产物。这里切一次语言，看同一个
 *   位置的字跟着变，那是键真的接上了才会发生的事。
 *
 * 用法：node --experimental-strip-types e2e/audit-fixes-demo.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra审计整改测试");
const PORT = 9463;
const SESSION_ID = randomUUID();
const WORK = "/tmp/lyra-audit-fixes";

/** C1 的那五个。桌面端的工具清单里一个都不能少。 */
const MISSING_FIVE = ["recall", "rule", "learn", "lsp", "web_search"];

async function seed(home: string): Promise<void> {
	const cwd = join(WORK, "proj");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 审计整改演示\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 940, x: 0, y: 0 }));

	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	// 序号从 1 起，meta 占掉第一个——`seq: 0` 的 meta 会被 `record.seq > sinceSeq` 读掉，会话连
	// 列表都进不去。
	const at = Date.now() - 600_000;
	const record = (seq: number, role: string, text: string) =>
		JSON.stringify({
			seq,
			ts: at + seq * 1000,
			type: "message",
			message: { role, content: [{ type: "text", text }], timestamp: at + seq * 1000 },
		});

	const lines = [
		JSON.stringify({
			seq: 1,
			ts: at,
			type: "meta",
			meta: {
				id: SESSION_ID,
				title: "审计整改演示",
				cwd,
				projectId,
				projectName: "proj",
				createdAt: at,
				updatedAt: at,
				modelId: null,
				messageCount: 2,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 },
				seq: 0,
			},
		}),
		record(2, "user", "这一轮改了哪些东西？"),
		record(3, "assistant", "工具清单归一、命令分类器加固、沙箱多了一条网络轴。"),
	];
	await writeFile(join(dir, `${SESSION_ID}.jsonl`), `${lines.join("\n")}\n`);

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: cwd, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			// 自定义那一档，`browser.searchUrl` 的输入框只在它下面才画出来——要验的正是那个
			// `aria-label`，它曾经是一句写死的中文。
			browser: { searchEngine: "custom", searchUrl: "https://example.com/search?q=%s" },
			sync: { enabled: false, port: 4531, token: null },
		}),
	);
}

let app: RunningApp;
const frames: Frame[] = [];
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${what}`);
	if (!ok) failures.push(what);
};

/**
 * 走一遍设置导航，停在某一项上。用真鼠标——`.click()` 在这个界面里打不开东西。
 *
 * 设置入口只在还没打开时点。第一版每次都点，于是第二次调用把刚打开的设置又关掉了，接下来那一页
 * 的断言全部落空——报出来的样子和「这一节没写」一模一样。
 */
let settingsOpened = false;

async function openSettings(drive: ReturnType<typeof driver>, label: string): Promise<boolean> {
	/*
	 * 记一个标志，而不是去页面上问「设置开着吗」。
	 *
	 * 问过两种写法，两种都错：每次都点，第二次把刚打开的设置关掉了；改成 `document.querySelector
	 * ("nav button")` 判断，那个选择器在设置没开的时候也命中——页面别处也有 `nav`——于是一次都
	 * 没点开。这个函数自己知道它点没点过，不用猜。
	 */
	if (!settingsOpened) {
		await drive.click(".ly-sidebar-foot button");
		await pause(1600);
		settingsOpened = true;
	}
	/*
	 * 标记之前先把上一次的记号摘掉，标记之后把它滚到中间。
	 *
	 * 两件事各自坑过一次。不摘旧记号，`[data-probe-nav]` 选中的永远是第一次标的那一项。不滚，
	 * 靠下的几项会停在窗口边缘——量到的是 `y=638`、窗口高 `680`，`checkVisibility()` 说可见，
	 * 真实鼠标点下去却什么都没发生，页面还停在上一页。滚到 `y=342` 之后同一次点击就进去了。
	 */
	const found = await app.evaluate<boolean>(`(() => {
		document.querySelector("[data-probe-nav]")?.removeAttribute("data-probe-nav");
		const item = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
		if (!item) return false;
		item.setAttribute("data-probe-nav", "");
		item.scrollIntoView({ block: "center" });
		return true;
	})()`);
	if (!found) return false;
	await pause(900);
	await drive.click("[data-probe-nav]");
	await pause(1400);
	return true;
}

app = await startApp({ port: PORT, seed });
const drive = driver(app);
const stop = await startRecording(PORT, frames);

try {
	await mkdir(OUT_DIR, { recursive: true });
	await pause(2600);

	// 打开那个 seed 出来的会话——工具清单是按 `activeSessionId` 查的，没有会话它只会说「先开一个」。
	console.log("\n\x1b[1mC1：五个工具在桌面端的工具清单里\x1b[0m");
	await drive.click('[class*="group/session"] button');
	await pause(1500);

	const opened = await openSettings(drive, "命令");
	check(opened, "设置导航里有「命令」这一项");
	await pause(1200);

	// 这一页有两个 tab，默认停在「命令」那个（斜杠命令）；工具清单在第二个后面。
	const toTools = await app.evaluate<boolean>(`(() => {
		const tab = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "工具");
		if (!tab) return false;
		tab.setAttribute("data-probe-tab", "");
		return true;
	})()`);
	check(toTools, "命令页上有「工具」这个 tab");
	if (toTools) {
		await drive.click("[data-probe-tab]");
		await pause(1600);
	}

	/*
	 * 从「内置工具（N）」那个小节标题往下取，而不是抓整页的 `.font-mono`。
	 *
	 * 第一版抓整页，拿回来的是 `/compact /clear /commands`——那是这一页上面那张斜杠命令表，同样
	 * 用等宽字。数字对不上还好说，名字对不上就会让人以为工具清单真的少了东西。
	 */
	const inventory = await app.evaluate<{ names: string[]; count: number; heading: string | null; empty: string | null }>(`(() => {
		const heads = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && /^内置工具（\\d+）$/.test(el.innerText?.trim() ?? ""));
		const head = heads[0] ?? null;
		const card = head ? head.parentElement?.querySelector("div") ?? head.nextElementSibling : null;
		const scope = head ? head.parentElement : null;
		const chips = scope ? [...scope.querySelectorAll("span.font-mono")].map((s) => s.innerText.trim()) : [];
		return {
			names: chips,
			count: chips.length,
			heading: head ? head.innerText.trim() : null,
			empty: scope && /打开会话后查看/.test(scope.innerText) ? "要先打开一个会话" : null,
		};
	})()`);
	check(inventory.heading !== null, `找得到「内置工具」那一节（${inventory.heading}）`);
	check(inventory.heading !== null && inventory.empty === null, `这一节不是空的（${inventory.empty ?? (inventory.heading ? "有内容" : "连标题都没找到")}）`);
	console.log(`  窗口上画出来的内置工具：${inventory.count} 个`);
	console.log(`  ${inventory.names.join(" ")}`);
	for (const tool of MISSING_FIVE) {
		check(inventory.names.includes(tool), `工具清单里有 ${tool}`);
	}
	await pause(900);

	// H2：新加的那一节
	console.log("\n\x1b[1mH2：访问授权页的「命令联网」一节\x1b[0m");
	const toAccess = await openSettings(drive, "访问授权");
	check(toAccess, "设置导航里有「访问授权」这一项");
	await pause(1200);

	const network = await app.evaluate<{
		heading: boolean;
		title: string | null;
		detail: string | null;
		hasSwitch: boolean;
		checked: string | null;
	}>(`(() => {
		const headings = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.innerText?.trim() === "命令联网");
		const row = [...document.querySelectorAll("[data-settings-row]")].find((r) => /禁止命令联网/.test(r.innerText));
		const sw = row?.querySelector('[role="switch"]');
		return {
			heading: headings.length > 0,
			title: row ? row.innerText.split("\\n")[0].trim() : null,
			detail: row ? (row.innerText.split("\\n")[1] ?? "").trim() : null,
			hasSwitch: Boolean(sw),
			checked: sw ? sw.getAttribute("aria-checked") : null,
		};
	})()`);
	check(network.heading, "小节标题「命令联网」画出来了");
	check(network.title === "禁止命令联网", `行标题是「禁止命令联网」（实际：${network.title}）`);
	check(Boolean(network.detail && network.detail.includes("localhost")), "说明里讲了 localhost 不受影响");
	check(network.hasSwitch, "这台机器（macOS）上给的是开关，不是那句「保证不了」");
	check(network.checked === "false", `默认是关的（aria-checked=${network.checked}）`);
	await pause(900);

	// 开关真的写得进设置里吗——这一节的全部意义就是让这个值可配。
	const marked = await app.evaluate<boolean>(
		`(() => { const row = [...document.querySelectorAll("[data-settings-row]")].find((r) => /禁止命令联网/.test(r.innerText)); const sw = row?.querySelector('[role="switch"]'); if (!sw) return false; sw.setAttribute("data-probe-switch", ""); return true; })()`,
	);
	check(marked, "找得到那个开关，可以点它");
	if (marked) {
		await drive.click("[data-probe-switch]");
		await pause(1400);
		const after = await app.evaluate<string | null>(
			`document.querySelector('[data-probe-switch]')?.getAttribute("aria-checked") ?? null`,
		);
		check(after === "true", `点一下之后是开的（aria-checked=${after}）`);
		await pause(800);
		// 关回去，免得这份 profile 留着一个开着的网络禁令。
		await drive.click("[data-probe-switch]");
		await pause(1000);
	}

	// I1：切语言，看同一个位置的字跟着走
	console.log("\n\x1b[1mI1：四条文案真的走了 i18n\x1b[0m");
	const toBrowser = await openSettings(drive, "浏览器");
	check(toBrowser, "设置导航里有「浏览器」这一项");
	await pause(1200);
	const zhLabel = await app.evaluate<string | null>(
		`document.querySelector('[aria-label="自定义搜索地址"]')?.getAttribute("aria-label") ?? null`,
	);
	check(zhLabel === "自定义搜索地址", `中文界面上搜索框的 aria-label 走了 t()（${zhLabel}）`);
	await pause(800);

	const toGeneral = await openSettings(drive, "常规");
	check(toGeneral, "设置导航里有「常规」这一项");
	await pause(1000);
	/*
	 * 语言选择是自定义的 Dropdown，不是原生 `<select>`。
	 *
	 * 第一版找 `document.querySelectorAll("select")`，一个都没有——页面上那个「界面语言 ˅」是一个
	 * 带 `aria-label` 的按钮加一层弹出列表。两步真鼠标：点开，再点 English 那一行。
	 */
	const opener = await app.evaluate<boolean>(`(() => {
		const el = document.querySelector('[aria-label="界面语言"]');
		if (!el) return false;
		el.setAttribute("data-probe-lang", "");
		el.scrollIntoView({ block: "center" });
		return true;
	})()`);
	check(opener, "找得到「界面语言」那个下拉");
	let switched = false;
	if (opener) {
		await pause(700);
		await drive.click("[data-probe-lang]");
		await pause(1100);
		// 每一项是两行——一个语言标记加语言名，和收起来时那个「中 / 简体中文」一样。所以按包含匹配，
		// 并且只在 `role="menuitem"` 里找：`English` 这个词在这一页别处也出现。
		switched = await app.evaluate<boolean>(`(() => {
			const option = [...document.querySelectorAll('[role="menuitem"]')].find((n) => (n.innerText ?? "").includes("English"));
			if (!option) return false;
			option.setAttribute("data-probe-en", "");
			return true;
		})()`);
		if (switched) {
			await drive.click("[data-probe-en]");
			await pause(1600);
		}
	}
	check(switched, "下拉里点得到 English");
	await pause(1800);

	const toBrowserEn = await openSettings(drive, "Browser");
	check(toBrowserEn, "切了语言之后导航项也变成英文了（Browser）");
	await pause(1200);
	/*
	 * 只在 `[data-search-custom]` 那个盒子里找，不在整页里找 `/search/i`。
	 *
	 * 整页找会先撞上侧边栏那个 `Search chats`——一条看起来很像、其实不是它的 `aria-label`。断言
	 * 因此变绿，而变绿的理由是错的：抓错元素的绿比红更难发现。
	 */
	const enLabel = await app.evaluate<string | null>(`(() => {
		const box = document.querySelector("[data-search-custom]");
		const el = box?.querySelector("[aria-label]");
		return el ? el.getAttribute("aria-label") : null;
	})()`);
	check(
		Boolean(enLabel && !/[\u4e00-\u9fa5]/.test(enLabel)),
		`同一个 aria-label 在英文界面上不再是中文（${enLabel}）`,
	);
	await pause(900);

	const toAccessEn = await openSettings(drive, "Access");
	check(toAccessEn, "英文导航里有 Access");
	await pause(1200);
	/*
	 * 按这一节自己的标题找，不按 `/network/`。
	 *
	 * 权限模式那一行的说明里也有 "network"（`Lyra can ... access the network without approval`），
	 * 它排在前面，于是断言拿着那一行变绿——而那一行和这一轮的改动毫无关系。
	 */
	const enNetwork = await app.evaluate<{ title: string | null; detail: string | null }>(`(() => {
		const row = [...document.querySelectorAll("[data-settings-row]")].find((r) => /Keep commands off the network/i.test(r.innerText));
		if (!row) return { title: null, detail: null };
		const lines = row.innerText.split("\\n");
		return { title: lines[0].trim(), detail: (lines[1] ?? "").trim() };
	})()`);
	check(
		Boolean(enNetwork.title && !/[\u4e00-\u9fa5]/.test(enNetwork.title)),
		`这一轮新加的那一节也跟着切了（${enNetwork.title}）`,
	);
	check(
		Boolean(enNetwork.detail && /localhost/.test(enNetwork.detail)),
		"英文说明里同样讲了 localhost",
	);
	await pause(1500);
} finally {
	await stop();
	const video = join(OUT_DIR, "审计整改三批改动.mp4");
	await encode(frames, video, 12, 1200).catch((error: unknown) => console.error("录像失败：", error));
	console.log(`\n录像：${video}（${frames.length} 帧）`);
	await app.stop();
}

console.log(
	failures.length === 0
		? "\n\x1b[32m三批改动在真窗口里全部成立\x1b[0m"
		: `\n\x1b[31m${failures.length} 条没成立：\x1b[0m\n  ${failures.join("\n  ")}`,
);
// 不用 process.exit：它会吞掉上面 finally 里可能抛出的异常。
process.exitCode = failures.length === 0 ? 0 : 1;
