/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 「待批准的技能，那两颗按钮现在说得出自己是谁吗？」
 *
 * 这两颗以前是一个 ✓ 和一个 ✕，动词挂在 tooltip 上。按下左边那颗，候选的正文就进了以后每一个
 * 会话——一个「哪颗是哪颗」要靠悬停才知道的选择，不该是这种选择。
 *
 * 问的是**画出来的结果**而不是源码：候选区只在磁盘上真有候选时才渲染，所以这里往临时 home 的
 * 待确认目录里写一个 md，再走进技能页，逐颗问页面「你自己的可见文字是什么、你多高」。
 *
 * 跑：node --experimental-strip-types e2e/skill-candidate-buttons-probe.ts
 */

import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9483;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "skill-candidate-buttons");
const WINDOW = { width: 1280, height: 900 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 跑哪一种语言：`LY_PROBE_LOCALE=en` 换英文。
 *
 * 英文值得单跑一遍，而不是只看中文：「No thanks」比「不要」长一倍多，而这两颗按钮就贴在一张
 * 卡片的左下角。语言从固件里给定，不在界面上现切——那条路要穿过设置页的语言下拉，长且脆。
 */
const LOCALE = process.env.LY_PROBE_LOCALE === "en" ? "en" : "zh-CN";
const WORDS = {
	"zh-CN": { settingsNav: "插件", tab: "技能", enable: "启用", reject: "不要", newSession: "在这个项目里新建会话" },
	en: { settingsNav: "Plugins", tab: "Skills", enable: "Enable", reject: "No thanks", newSession: "New conversation in this project" },
}[LOCALE];

/**
 * 和 `projectIdFor` 同一个算法：候选住在 <home>/projects/<sha256(cwd)>/memory 底下。
 *
 * 跟 settings.json 里那个 `id` 不是一回事——会话按后者分目录，项目记忆按前者。两个混用的话
 * 候选会写进一个没人读的目录，而页面只会安静地画「没有待批准的」。
 */
const memoryId = (cwd: string) => createHash("sha256").update(cwd).digest("hex").slice(0, 16);

/**
 * 一个项目要在「项目」那一段里占一行，得有会话。
 *
 * 没有会话的项目本来就不列行，而这支探针要点进项目才有 `workspace.path`——没有它，
 * `reloadPending` 第一句就 `setPending([])` 了，候选区永远不画。`seq` 从 1 起。
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
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "readme.md"), "# project\n");
		await seedSession(home, "demo", root, "发版演示");
		await writeFile(join(home, "window.json"), JSON.stringify({ ...WINDOW, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "demo", path: root, name: "发版演示", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				// 内置技能不参与这次的问题，关掉之后候选区就是页面上唯一的一张卡片。
				disabledPlugins: ["*"],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				uiLocale: LOCALE,
				sync: { enabled: false, port: 4519, token: null },
				appearance: { theme: "dark" },
			}),
		);

		/*
		 * 候选本身，写进**两份**记忆目录。
		 *
		 * macOS 上临时目录是软链：seed 手里是 /var/folders/…，而窗口里的 `workspace.path` 经
		 * `canonicalPath` 解开之后是 /private/var/folders/…。两串字符的 sha256 不是一个，只按
		 * 前者建目录的话，主进程用 settings 里的路径数得出候选，组件用 workspace.path 数出来是空
		 * ——页面于是安静地不画候选区，而探针里每一条都报红却指不出为什么。
		 *
		 * `description` 是必需的，没有它 parseSkill 会把整个文件丢掉。
		 */
		const body = [
				"---",
				"description: 发版说明按七种语言各写一份，标题用版本号",
				"scope: portable",
				'sourceSessions: ["a1b2c3d4"]',
				"---",
				"",
				"写发版说明时：",
				"",
				"1. 先读 git log 里上一个 tag 之后的提交。",
				"2. 每种语言一份，不要机器翻译其中一份了事。",
				"3. 标题只写版本号，不写日期。",
		].join("\n");
		for (const cwd of new Set([root, await realpath(root)])) {
			const pending = join(home, "projects", memoryId(cwd), "memory", "skills", ".pending");
			await mkdir(pending, { recursive: true });
			await writeFile(join(pending, "release-notes.md"), body);
		}
	},
});

/**
 * 真的把指针挪过去按一下。
 *
 * `evaluate` 里的 `.click()` 打不开会话行——那一行要的是一次真实的按下。而打不开项目就没有
 * `workspace.path`，候选区于是一声不响地画成空。
 */
async function clickAt(selector: string): Promise<boolean> {
	const at = await app.evaluate<{ x: number; y: number; w: number; h: number } | null>(
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest", behavior: "instant" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`,
	);
	if (!at || at.w === 0 || at.h === 0) return false;
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await pause(200);
	/*
	 * 落点得真的落在它身上。
	 *
	 * 「元素在」不等于「点得着」：hover 才显形的那几颗，rect 可能还是 0，或者被别的东西压着。
	 * 不校验的话，一次什么都没点到的点击会照样报「点到了」——红在后面，指的却是别处。
	 */
	const onTarget = await app.evaluate<boolean>(
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const hit = document.elementFromPoint(${at.x}, ${at.y}); return Boolean(hit) && (el === hit || el.contains(hit) || hit.contains(el)); })()`,
	);
	if (!onTarget) return false;
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	return true;
}

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
	console.log(`   ↳ ${name}.png`);
};

/**
 * 那一对按钮，按它们画出来的样子。
 *
 * 从候选卡片往下找，而不是从整页找：页面上另有一堆按钮，`.ly-rule-excerpt` 所在的那张卡片才是
 * 这次要看的地方。高度和文字一起读——换组件之后它们该是 32px 的图文按钮，不再是 28px 的方块。
 *
 * （这一段住在模板串里，所以注释里不能出现反引号——它会把串提前收掉。）
 */
const SURVEY = `(() => {
	const excerpt = document.querySelector(".ly-rule-excerpt");
	if (!excerpt) return { found: false, buttons: [] };
	const card = excerpt.closest("div.px-4");
	if (!card) return { found: false, buttons: [] };
	const buttons = [...card.querySelectorAll("button")].map((el) => {
		const box = el.getBoundingClientRect();
		return {
			text: (el.textContent || "").replace(/\\s+/g, " ").trim(),
			tip: el.getAttribute("data-ly-tip"),
			aria: el.getAttribute("aria-label"),
			variant: el.getAttribute("data-variant"),
			height: Math.round(box.height),
			width: Math.round(box.width),
			glyph: Boolean(el.querySelector("svg")),
		};
	});
	return { found: true, buttons };
})()`;

interface Survey {
	found: boolean;
	buttons: {
		text: string;
		tip: string | null;
		aria: string | null;
		variant: string | null;
		height: number;
		width: number;
		glyph: boolean;
	}[];
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`  ${ok ? "✔" : "✖"} ${what}`);
	if (!ok) failures.push(what);
};

try {
	await mkdir(OUT, { recursive: true });
	await pause(3_000);

	console.log(`\n[1] 进项目（${LOCALE}）`);
	const diag = await app.evaluate<{ pending: { name: string }[] }>(`(async () => {
		const settings = await window.lyra.settings.get();
		const pending = await window.lyra.rules.pendingSkills(settings.projects[0].path);
		return { pending };
	})()`);
	// 固件真的落到了主进程读的那个目录——先立住这条，后面量到的空才说明得了问题。
	check(diag.pending.length === 1, `主进程数出来 ${diag.pending.length} 个候选（固件写进去 1 个）`);

	/*
	 * 「在这个项目里新建会话」——项目行上那颗，它明确会 openWorkspace。
	 *
	 * 分组头本身只折叠；而点开底下那条会话，这个固件里也没把 workspace 带上。没有
	 * `workspace.path`，`reloadPending` 第一句就 setPending([])，候选区一声不响地不画。
	 * 那颗按钮平时是藏着的，所以先把指针停在项目行上让它显形。
	 */
	await app.evaluate(`(() => { const r = document.querySelector("[data-ly-project]").getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
	const row = await app.evaluate<{ x: number; y: number }>(
		`(() => { const r = document.querySelector("[data-ly-project]").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
	);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...row });
	await pause(500);
	const clicked = await clickAt(`[data-ly-tip="${WORDS.newSession}"]`);
	check(clicked, `点到了「${WORDS.newSession}」`);
	await pause(2_500);

	console.log("\n[2] 插件 → 技能");
	/*
	 * 每一下都用真实鼠标，而且都先打个记号再点。
	 *
	 * 踩过的两脚：`evaluate` 里的 `.click()` 切不动这一排 tab；而「找到了按钮」也不等于「按下去
	 * 了」——前一版据此报「走到了技能页」，实际上八条红线全是在另一个页面上量的。clickAt 现在
	 * 自己校验落点，到没到技能页则由候选区在不在来回答。
	 */
	// 侧边栏是 `aside[data-pane]`——`.ly-sidebar` 这个类名并不存在，头一版拿它当过滤条件，
	// 于是 closest 恒为 null，两处都找不到人。
	const SIDEBAR = "aside[data-pane]";
	/**
	 * 按可见文字打个记号再用真实鼠标点它。
	 *
	 * `last` 是给「插件」准备的：设置页的左栏和侧边栏的目的地列表**同在** aside 里，两处都写着
	 * 这两个字，而去处完全不同（一个是设置里的扩展页，一个是市场）。设置左栏在 DOM 里靠后，所以
	 * 取最后一个；头一版取第一个，于是一路点进市场，再在市场自己的那排 tab 上量了八条红线。
	 */
	const mark = async (label: string, tag: string, inSidebar: boolean, last = false) => {
		const ok = await app.evaluate<boolean>(`(() => {
			const all = [...document.querySelectorAll("button, a")].filter((b) => {
				const inside = Boolean(b.closest(${JSON.stringify(SIDEBAR)}));
				if (inside !== ${inSidebar}) return false;
				return ${JSON.stringify(label)} === (b.textContent || "").trim().replace(/\\s*\\d+$/, "");
			});
			const hit = ${last} ? all.at(-1) : all[0];
			if (!hit) return false;
			hit.setAttribute(${JSON.stringify(tag)}, "");
			return true;
		})()`);
		if (!ok) return false;
		return clickAt(`[${tag}]`);
	};

	/*
	 * 从设置页进，不从侧边栏那个「插件」进。
	 *
	 * 侧边栏那一项去的是市场——DestinationNav 的注释把这条线划得很清楚：那边是挑和装，设置里
	 * 才是配置已经有的。SkillsSettings 只挂在后者底下，所以从市场点「技能」，切的是市场自己的
	 * 那一排，组件一次都没上过场。
	 */
	check(await clickAt(".ly-sidebar-foot button"), "点开了左下角的齿轮");
	await pause(1_600);

	check(await mark(WORDS.settingsNav, "data-probe-nav", true, true), `点到了设置页左栏的「${WORDS.settingsNav}」`);
	await pause(1_600);

	check(await mark(WORDS.tab, "data-probe-tab", false), `点到了「${WORDS.tab}」这一 tab`);
	await pause(2_000);

	const survey = await app.evaluate<Survey>(SURVEY);
	check(survey.found, "候选卡片渲染出来了");

	console.log("\n[3] 那一对按钮");
	for (const b of survey.buttons) {
		console.log(
			`   ${(b.text || "（没有字）").padEnd(8)} variant=${String(b.variant).padEnd(7)} ` +
				`${b.width}×${b.height} 图标=${b.glyph ? "有" : "无"} tip=${b.tip ?? "—"}`,
		);
	}

	const enable = survey.buttons.find((b) => b.variant === "primary");
	const reject = survey.buttons.find((b) => b.variant === "ghost");
	// 两颗都得先在，再谈它们长什么样——一个空数组会让下面每一条都「恒真」地过掉。
	check(Boolean(enable) && Boolean(reject), "两颗按钮都在（primary 一颗，ghost 一颗）");
	check(enable?.text === WORDS.enable, `启用那颗把动词写在了脸上（读到「${enable?.text ?? "—"}」）`);
	check(reject?.text === WORDS.reject, `拒绝那颗把动词写在了脸上（读到「${reject?.text ?? "—"}」）`);
	check(enable?.glyph === true, "启用那颗仍然带着勾");
	// 32 是 Button 的 md 一档。英文下这两个词长得多，撑成两行的话高度会先说出来。
	check(enable?.height === 32 && reject?.height === 32, `两颗都是 32px，没被撑高（${enable?.height}／${reject?.height}）`);
	check(
		Boolean(enable) && Boolean(reject) && !enable?.aria && !reject?.aria,
		"有字之后不再重复一个 aria-label——可见文字就是它的名字",
	);
	check(
		(enable?.width ?? 0) > 40 && (reject?.width ?? 0) > 40,
		`不再是方块（${enable?.width}／${reject?.width}）`,
	);

	await shot(LOCALE === "en" ? "02-skills-candidate-en" : "01-skills-candidate");

	console.log("\n[4] 结论");
	if (failures.length) {
		console.log(`\n   ${failures.length} 条没过：`);
		for (const f of failures) console.log(`     ✖ ${f}`);
	} else {
		console.log("\n   全过。");
	}
	console.log(`\n   截图在 ${OUT}`);
} finally {
	// `process.exit` 不写在这里：它会把上面抛出来的异常一起吞掉。
	await app.stop();
}

if (failures.length) process.exitCode = 1;
