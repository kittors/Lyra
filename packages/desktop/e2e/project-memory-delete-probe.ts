/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * 项目记忆能不能删掉——在真窗口里，用真鼠标。
 *
 * 在这之前这一栏只能看：每一条都会被注入这个项目的每一次请求，而撤回一条错的记忆，唯一的办法是
 * 自己去 `~/.lyra/projects` 底下翻那个项目的记忆目录。用户记忆早就有那颗垃圾桶按钮了，项目记忆
 * 没有。
 *
 * 要验的是一条链，中间断在哪儿都只会表现为「点了没反应」：
 *   按钮画出来了 → 真鼠标点得到 → IPC 到得了主进程 → 文件真的被改了 → 界面重读后那一条不见了。
 * 只断言 DOM 里少了一行是不够的——把 React 状态里那一项抠掉也能做到，而文件原封不动。所以最后
 * 一步直接去读磁盘。
 *
 * 不是测试——`node e2e/project-memory-delete-probe.ts`——跑 `out/` 产物，改完先 `pnpm build`。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectIdFor, writeLessons } from "@lyra/core";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const PORT = 9646;
const OUT = join(homedir(), ".lyra/scratch/project-memory");
const LESSONS = [
	{ text: "这个仓库的端口固定在 4100，别去猜。", at: 1_700_000_000_000 },
	{ text: "改完 CSS 要跑 pnpm style，否则 CI 必红。", at: 1_700_000_001_000 },
	{ text: "第三条：留着看它会不会被误删。", at: 1_700_000_002_000 },
];
const EXTRACTED = "## 这个项目\n后台抽取写下的那一份，整体重写，只能整份丢掉。";

let memoryDir = "";

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }));

		/*
		 * 用 core 自己的 `writeLessons` 写，不手搓 `learned.md`。
		 *
		 * 那个文件的格式由 `renderLessons`/`parseLessons` 一对函数定义；手写一份「看起来对」的，
		 * 验的就成了我对格式的理解，而不是这条链路。
		 */
		process.env.LYRA_HOME = home;
		memoryDir = join(home, "projects", projectIdFor(root), "memory");
		await mkdir(memoryDir, { recursive: true });
		await writeLessons(root, LESSONS);
		await writeFile(join(memoryDir, "MEMORY.md"), EXTRACTED, "utf8");

		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
				hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
				alwaysAllow: [], sync: { enabled: false, port: 4519, token: null },
				personalization: { customInstructions: "", enableMemory: true, enableProjectMemory: true, enableToolAssistedMemory: true, tone: "friendly" },
			}),
		);
	},
});

const wire = await frameGrabber(PORT);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
const realClick = async (x: number, y: number) => {
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await wire.send("Input.dispatchMouseEvent", { type, x, y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
};
/** 真鼠标点一个选择器命中的元素；先滚到中间，靠窗口边缘的点击会静默落空。 */
const clickSelector = async (selector: string): Promise<boolean> => {
	const spot = await wire.evaluate<{ x: number; y: number } | null>(
		`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			el.scrollIntoView({ block: "center" });
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) return null;
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`,
	);
	if (!spot) return false;
	await realClick(spot.x, spot.y);
	return true;
};

const onDisk = async () => ({
	learned: await readFile(join(memoryDir, "learned.md"), "utf8").catch(() => ""),
	extracted: await readFile(join(memoryDir, "MEMORY.md"), "utf8").catch(() => null),
});

try {
	await mkdir(OUT, { recursive: true });
	await settle(2500);

	// 设置 → 个性化
	if (!(await clickSelector(".ly-sidebar-foot button"))) throw new Error("没找到设置入口");
	await settle(1600);
	const navigated = await wire.evaluate<boolean>(
		`(() => {
			const item = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === "个性化");
			if (!item) return false;
			item.setAttribute("data-probe-nav", "");
			item.scrollIntoView({ block: "center" });
			return true;
		})()`,
	);
	if (!navigated) throw new Error("设置里没有「个性化」这一项");
	await clickSelector("[data-probe-nav]");
	await settle(1400);

	const count = () =>
		wire.evaluate<{ lessons: number; deleteButtons: number; extracted: number; extractedDelete: number; clearAll: number; texts: string[] }>(
			`(() => ({
				lessons: document.querySelectorAll('[data-project-lesson]').length,
				deleteButtons: document.querySelectorAll('[data-project-lesson-delete]').length,
				extracted: document.querySelectorAll('[data-project-extracted]').length,
				extractedDelete: document.querySelectorAll('[data-project-extracted-delete]').length,
				clearAll: document.querySelectorAll('[data-project-memory-clear]').length,
				texts: [...document.querySelectorAll('[data-project-lesson]')].map((e) => (e.textContent || '').slice(0, 20)),
			}))()`,
		);

	const before = await count();
	console.log("=== 打开时 ===");
	console.log(JSON.stringify(before, null, 1));
	await writeFile(join(OUT, "01-before.png"), await wire.shot());

	// 删掉第一条
	if (!(await clickSelector("[data-project-lesson-delete]"))) throw new Error("第一条上没有删除按钮");
	await settle(1200);
	const afterOne = await count();
	const diskOne = await onDisk();

	// 再删掉抽取的那一份
	const hadExtracted = afterOne.extracted > 0;
	if (hadExtracted && !(await clickSelector("[data-project-extracted-delete]"))) throw new Error("抽取那一份上没有删除按钮");
	await settle(1200);
	const afterExtracted = await count();
	const diskExtracted = await onDisk();

	console.log("\n=== 删掉一条 + 抽取那一份之后 ===");
	console.log(JSON.stringify(afterExtracted, null, 1));
	await writeFile(join(OUT, "02-after.png"), await wire.shot());

	console.log("\n=== 判定 ===");
	const verdict = [
		[before.lessons === 3, `三条记忆都画出来了（实际 ${before.lessons}）`],
		[before.deleteButtons === 3, `每条都有删除按钮（实际 ${before.deleteButtons}）`],
		[before.extracted === 1 && before.extractedDelete === 1, "抽取那一份也有自己的删除按钮"],
		[before.clearAll === 1, "有「全部忘掉」的入口"],
		[afterOne.lessons === 2, `点一下少一条（实际 ${afterOne.lessons}）`],
		[!afterOne.texts.some((t) => t.includes("4100")), "消失的正是被点的那一条"],
		[!diskOne.learned.includes("4100"), "磁盘上的 learned.md 里也真的没了"],
		[diskOne.learned.includes("pnpm style"), "别的条目没被误删"],
		[afterExtracted.extracted === 0, `抽取那一份从界面上消失（实际 ${afterExtracted.extracted}）`],
		[diskExtracted.extracted === null, "MEMORY.md 真的被删掉了"],
		[afterExtracted.lessons === 2, "删抽取那份没有连累剩下的记忆"],
	] as const;
	for (const [ok, what] of verdict) console.log(`${ok ? "✅" : "❌"} ${what}`);
	console.log(verdict.every(([ok]) => ok) ? "\n全部通过" : "\n有未通过项");
	console.log(`截图 → ${OUT}`);
} finally {
	wire.close();
	await app.stop();
}
