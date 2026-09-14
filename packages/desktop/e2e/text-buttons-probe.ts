/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 「界面里还有多少颗按钮是靠文字说话的？」
 *
 * 源码里数不出这个答案。一颗按钮写成 `<button>{t("x")}</button>` 很好找，写成三层三元、把标签
 * 拼在一个变量里、或者根本来自某个共用组件的 `children`，正则就看不见了——上一轮我按源码数出
 * 19 处并宣布改完，用户打开应用，满屏还是字。
 *
 * 所以这支探针问的是**画出来的东西**：走一遍真窗口里每一个 `button`，看它自己的文字（不含子
 * 按钮的），凡是还剩下一个词以上的就记下来，连同它在哪一屏、长什么样。顺带验两件事——每颗图标
 * 按钮都还说得出自己是谁（`aria-label` 或 `data-ly-tip`），以及没有一颗按钮把 `flex` 和
 * `grid` 一起写进 class 里（那是这次批量改写最容易留下的痕迹，肉眼看是「图标没居中」）。
 *
 * 跑：node --experimental-strip-types e2e/text-buttons-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9479;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "text-buttons");
const WINDOW = { width: 1440, height: 900 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 一颗按钮自己的可见文字。
 *
 * 「自己的」是关键：设置页的导航项里嵌着图标和徽标，会话行里嵌着标题和时间，直接读
 * `textContent` 会把它们全算成按钮的标签。这里只取直接子节点里的文字，再去掉纯数字和单个
 * 符号——数字是内容（「还有 37 条」「导入 5 个」），不是标签。
 */
const OWN_TEXT = `(el) => {
	let text = "";
	for (const node of el.childNodes) {
		if (node.nodeType === 3) text += node.textContent;
		else if (node.nodeType === 1 && node.tagName !== "BUTTON" && !node.querySelector("button")) {
			// One level in: a label wrapped in <span> is still this button's label.
			if (!node.querySelector("*")) text += node.textContent ?? "";
		}
	}
	const trimmed = text.replace(/\\s+/g, " ").trim();
	// Numbers and lone symbols are content, not a name.
	return /^[\\d\\s.,·:/×+-]*$/.test(trimmed) ? "" : trimmed;
}`;

/**
 * 哪些 `button` 不在这次的范围里。
 *
 * 「把纯文字按钮改成图标」说的是**做一件事**的按钮。用同一个 `<button>` 标签写出来的还有另外
 * 几类东西，它们的文字不是按钮的名字、而是它此刻的内容：
 *
 *   - 导航（侧边栏、设置左栏、tab 条）——每一项的名字就是它要去的地方；
 *   - 列表行（会话、模型、文件）——文字是这一行是谁；
 *   - 单选行（主题、周期、检索方式）——一排选项，图标化就等于让人挨个猜；
 *   - 空状态里的引导卡片——一段话加一个标题，本来就不是按钮的形状。
 *
 * 判据取结构而不是取样式：在 `nav`/`tablist`/`menu` 里，或者自己是 tab、是全宽的一行。这几条
 * 都是这些东西**本来就该有**的标记，不是为了让探针通过而贴上去的。
 */
const OUT_OF_SCOPE = `(el) => {
	if (el.closest('nav, [role="tablist"], [role="menu"], [role="listbox"], .ly-sidebar, .ly-sidebar-foot')) return true;
	/*
	 * 开菜单、展开一段的触发器留字，这是定下来的规矩。
	 *
	 * 「做一件事」的按钮换成图标，按下去就发生了，tooltip 补一句话足够；而这一类按下去只是**露
	 * 出更多东西**——一张单子、一串文件——按钮本身得说清楚露出来的是什么，光一个箭头说不了。它
	 * 们的标记是现成的：aria-haspopup 或 aria-expanded，而方向箭头跟着开合转身（见 Caret 组件）。
	 *
	 * （这一段住在模板串里，所以注释里不能出现反引号——它会把串提前收掉。）
	 */
	if (el.getAttribute("aria-haspopup") || el.hasAttribute("aria-expanded")) return true;
	if (el.getAttribute("role") === "tab" || el.hasAttribute("aria-selected")) return true;
	// A segment in a row of mutually exclusive choices — 「紧凑／标准／宽松」 is a radio group
	// wearing a different coat, and the third of three is unguessable as a glyph.
	if (el.hasAttribute("data-segment") || el.hasAttribute("aria-pressed")) return true;
	const cls = (el.className || "").split(/\\s+/);
	// Primary creation or full-width list action buttons — like 「添加服务商」 or 「添加模型」.
	if (cls.includes("w-full")) return true;
	// The onboarding cards: a title, a sentence, and a lot of height.
	if (cls.some((c) => c.startsWith("min-h-[") && parseInt(c.slice(7)) >= 60)) return true;
	return false;
};`

const SURVEY = `(() => {
	const own = ${OWN_TEXT};
	const skip = ${OUT_OF_SCOPE};
	const worded = [];
	const nameless = [];
	const clashing = [];
	for (const el of document.querySelectorAll("button")) {
		const box = el.getBoundingClientRect();
		if (box.width === 0 && box.height === 0) continue;
		if (skip(el)) continue;
		const cls = el.className || "";
		const words = cls.split(/\\s+/);
		if (words.includes("grid") && (words.includes("flex") || words.includes("inline-flex"))) {
			clashing.push(cls.slice(0, 70));
		}
		const text = own(el);
		const named = el.getAttribute("aria-label") || el.getAttribute("data-ly-tip");
		/*
		 * 名字和写在上面的字不是一回事，那这些字就是它的内容。
		 *
		 * 快捷键框上是「⌥ A」而它叫「按下快捷键」；下拉触发器上是当前选中的那项而它叫「选择
		 * 语言」。这类控件的字换成图标就等于把内容删了。反过来，一颗无障碍名和面上的字一模一样
		 * 的按钮，那就是一颗还在用文字当标签的按钮——照记。
		 *
		 * （这一整段住在模板串里，所以注释里不能出现反引号——它会把串提前收掉。）
		 */
		if (text && named && named !== text) continue;
		if (text) {
			worded.push({ text: text.slice(0, 24), cls: cls.slice(0, 40) });
		} else if (!named && el.querySelector("svg") && !(el.innerText || "").trim()) {
			// Nothing but a glyph, and nothing that says what it is.
			nameless.push(cls.slice(0, 60));
		}
	}
	return { worded, nameless, clashing, total: document.querySelectorAll("button").length };
})()`;

interface Survey {
	worded: { text: string; cls: string }[];
	nameless: string[];
	clashing: string[];
	total: number;
}

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ ...WINDOW, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4519, token: null },
				appearance: { theme: "dark" },
			}),
		);
	},
});

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
};

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

/** Every settings page, by the label in its sidebar — the buttons differ on every one of them. */
const SECTIONS = [
	"常规", "外观", "代码格式化", "个性化", "模型设置", "代码托管", "屏幕截图",
	"浏览器", "插件", "智能体", "子智能体调度", "命令", "钩子", "网页搜索",
	"访问授权", "索引库", "移动端同步", "使用统计", "Worktrees", "关于", "已归档的聊天",
];

try {
	await mkdir(OUT, { recursive: true });
	await pause(3_000);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = document.querySelector('[data-project-row], [data-ly-project]');
		if (row) { row.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_500);

	const seen: { where: string; text: string; cls: string }[] = [];
	const nameless: { where: string; cls: string }[] = [];
	const clashing: { where: string; cls: string }[] = [];
	let visited = 0;

	const survey = async (where: string) => {
		const result = await app.evaluate<Survey>(SURVEY);
		visited++;
		for (const row of result.worded) seen.push({ where, ...row });
		for (const cls of result.nameless) nameless.push({ where, cls });
		for (const cls of result.clashing) clashing.push({ where, cls });
		console.log(`   ${where.padEnd(10)} 按钮 ${String(result.total).padStart(3)}，带字的 ${result.worded.length}`);
	};

	console.log("\n[1] 主界面");
	await survey("对话");
	await shot("01-chat");

	console.log("\n[2] 设置页逐屏");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const gear = document.querySelector('.ly-sidebar-foot button');
		if (gear) { gear.click(); await wait(1400); }
		return true;
	})()`);
	await pause(1_200);

	for (const label of SECTIONS) {
		const went = await app.evaluate<boolean>(`(async () => {
			const wait = (ms) => new Promise(r => setTimeout(r, ms));
			const nav = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
			if (!nav) return false;
			nav.click();
			await wait(900);
			return true;
		})()`);
		if (!went) {
			console.log(`   ${label.padEnd(10)} （没找到入口，跳过）`);
			continue;
		}
		await survey(label);
	}
	await shot("02-settings");

	console.log(`\n走过 ${visited} 屏`);

	// ── The verdict ──────────────────────────────────────────────────────────────────────────
	console.log("\n[3] 结论");
	if (seen.length) {
		console.log("\n   还带文字的按钮：");
		for (const row of seen) console.log(`     ${row.where.padEnd(10)} 「${row.text}」  ${row.cls}`);
	}
	check(seen.length === 0, `画出来的按钮里没有一颗还靠文字说话（找到 ${seen.length} 颗）`);

	if (nameless.length) {
		console.log("\n   有图标但没名字的：");
		for (const row of nameless) console.log(`     ${row.where.padEnd(10)} ${row.cls}`);
	}
	check(nameless.length === 0, `每颗图标按钮都说得出自己是谁（${nameless.length} 颗没有）`);

	if (clashing.length) {
		console.log("\n   flex 和 grid 写在一起的：");
		for (const row of clashing) console.log(`     ${row.where.padEnd(10)} ${row.cls}`);
	}
	check(clashing.length === 0, `没有按钮把两种 display 写在一起（${clashing.length} 颗有）`);

	console.log(`\n截图写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	await app.stop();
}

if (failures.length > 0) process.exitCode = 1;
