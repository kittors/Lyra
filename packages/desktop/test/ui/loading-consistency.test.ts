/**
 * 「正在忙」只有规定的那几种记号，而且各说各的话。
 *
 * 这条不是审美洁癖，是它烂掉的方式决定的：loading 从来不是一次加进来的，是二十几个人在二十几个
 * 星期里各加一个。每一个单独看都没问题——手边有 `Loader2`，套一个 `animate-spin` 就转起来了，
 * 比找到现成那个在哪儿快。等到能看出不对的时候，侧栏的项目行、它下面的会话行、任务清单里的
 * 每一步已经是三种不同的记号，说的却是同一句话。
 *
 * 现在是两个记号而不是一个，所以这里除了「别自己画」还要守第二条：**别说错话**。`StatusSpinner`
 * 说「这一条正在跑」，`ActionSpinner` 说「你按的那下正在回来」；用错的方向是在按钮里放状态记号，
 * 或者在一列 ✓ ✗ 中间放按钮记号。判据在 `ui/motion/loaders.tsx` 的头注释里。
 *
 * 所以守在源码这一层，而不是守在某个组件的快照上：新写的那个 `Loader2` 根本不会经过任何现有
 * 组件的测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";

const SRC = new URL("../../src/", import.meta.url);

/**
 * 允许留下旧写法的地方，连同理由——白名单里没有理由的一行，下一个人只会照抄。
 */
const ALLOWED = new Map([
	[
		"features/update/UpdateBadge.tsx",
		"进度环。它画的是「下到几成」，转只是在说这一段进度未知；`ActionSpinner` 的弧长是固定的，没有地方放进度。",
	],
]);

/**
 * 每一条禁令，连同它该改成什么。
 *
 * 这里禁的是**自己画一个**，不是「除这两个之外的一切」。侧栏会话行的呼吸波纹（`BreatheLoader` /
 * `ly-breathe`）不在名单上，而且是故意不在：那一列可能同时好几行在跑，一列并排都在转的记号会把
 * 标题挡在余光里读不了。第一版把它也算成「第二种 loading」删掉了，那是把统一当成了目的本身。
 *
 * 裸的 `Spinner` 也在名单上，尽管那个名字已经不存在了。删掉它是故意的：三十八处调用点当初全是
 * 这一个名字，谁都不必想一想这一处在说哪句话。名字留在这里，是为了让照着旧代码抄的人撞上它。
 */
const BANNED = [
	{ pattern: /\bLoader2\b/, fix: "换成 `StatusSpinner` 或 `ActionSpinner`（ui/motion/loaders.tsx）" },
	{ pattern: /\banimate-spin\b/, fix: "换成那两个记号之一，不要把图标转起来" },
	{ pattern: /\bly-spin\b/, fix: "`ly-spin` 只留给更新徽章的进度环；「正在忙」用那两个记号" },
	{
		pattern: /\bSpinner\b/,
		fix: "没有裸的 `Spinner` 了。状态列里用 `StatusSpinner`，按钮和角标位用 `ActionSpinner`",
	},
];

/**
 * 允许出现 `StatusSpinner` 的地方，连同它为什么是状态而不是动作。
 *
 * 判据是：把这个记号删掉，原地会出现什么。这几处原地会出现另一个**状态图标**，别处会出现一个
 * 可点的**动作图标**。名单短是对的——全应用三十八处「正在忙」里，只有六处是在讲某个对象的状态。
 */
const STATUS_SITES = new Map([
	["features/task/Mark.tsx", "agent 任务清单的每一步，上下是完成的勾、失败的点、还没开始的虚线圆"],
	["features/git/PipelinesView.tsx", "流水线的 StatusIcon，同一个函数的兄弟分支是 CheckCircle2 / XCircle / Clock"],
	["features/git/ReleaseModal.tsx", "发布对话框里的 job 列表，兄弟分支是 Check / XCircle"],
	["features/sidechat/TaskStrip.tsx", "侧边聊天的任务条，和任务面板里的同一条是同一件事"],
	["features/conversation/ToolCard.tsx", "工具卡运行中，同一行后面跟着 CircleCheck / CircleX"],
	["features/conversation/HiccupTrace.tsx", "重试轨迹的 waiting，兄弟分支是 CircleCheck"],
]);

async function sources(dir: URL, prefix = ""): Promise<{ path: string; text: string }[]> {
	const found: { path: string; text: string }[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			found.push(...(await sources(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)));
			continue;
		}
		if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
		found.push({ path: `${prefix}${entry.name}`, text: await readFile(new URL(entry.name, dir), "utf8") });
	}
	return found;
}

test("没有第二种 loading 混进来", async () => {
	const offences: string[] = [];
	for (const { path, text } of await sources(SRC)) {
		if (path === "ui/motion/loaders.tsx") continue; // 那一个记号自己的家，注释里会提到旧写法的名字。
		const allowed = ALLOWED.get(path);
		for (const { pattern, fix } of BANNED) {
			// 逐行看，行号才能指到人；顺带跳过注释里提及旧名字的情况。
			for (const [index, line] of text.split("\n").entries()) {
				if (!pattern.test(line)) continue;
				if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
				if (allowed) continue;
				offences.push(`${path}:${index + 1}  ${line.trim()}\n    → ${fix}`);
			}
		}
	}
	assert.deepEqual(offences, [], `这些地方自己画了一个 loading：\n\n${offences.join("\n\n")}\n`);
});

test("白名单里的每一项都还用得上", async () => {
	// 一条留着理由的例外，在它自己消失之后就只是一句谎话了。
	for (const [path] of ALLOWED) {
		const text = await readFile(new URL(path, SRC), "utf8");
		assert.ok(
			BANNED.some(({ pattern }) => pattern.test(text)),
			`${path} 已经不用旧写法了，把它从 ALLOWED 里删掉`,
		);
	}
});

test("状态那个记号只出现在状态列里", async () => {
	/*
	 * 两个记号之后，用错的方向不再是「自己画一个」，而是「拿错一个」。
	 *
	 * 拿错哪一个都读得通——都在转，都是个圆——所以没人会在 code review 里看出来。能看出来的是在
	 * 屏幕上：按钮里放状态记号，它就不再是那个刚被按下的图标的替身，按钮忙起来时中间空出一个洞；
	 * 一列 ✓ ✗ 中间放按钮记号，那圈轨道会让它读成「这一条有进度」。
	 */
	const offences: string[] = [];
	for (const { path, text } of await sources(SRC)) {
		if (path === "ui/motion/loaders.tsx") continue; // 那两个记号自己的家。
		if (!/<StatusSpinner\b/.test(text)) continue;
		if (STATUS_SITES.has(path)) continue;
		offences.push(
			`${path}\n    → 这一处用了状态记号。它旁边真的是一列 ✓ ✗ 吗？` +
				`是就把它连同理由加进 STATUS_SITES，不是就换成 ActionSpinner`,
		);
	}
	assert.deepEqual(offences, [], `这些地方的记号可能说错了话：\n\n${offences.join("\n\n")}\n`);
});

test("STATUS_SITES 里的每一项都还用得上", async () => {
	// 同上：一条留着理由的名单，在它指的东西消失之后就只是一句谎话了。
	for (const [path] of STATUS_SITES) {
		const text = await readFile(new URL(path, SRC), "utf8");
		assert.ok(/<StatusSpinner\b/.test(text), `${path} 已经不用状态记号了，把它从 STATUS_SITES 里删掉`);
	}
});

test("侧栏会话行的呼吸波纹留着", async () => {
	/*
	 * 这一条是捞回来的。
	 *
	 * 一次「把全局 loading 统一掉」的改动顺手把它也换成了射线——理由是「只有一种记号」，而那是把
	 * 统一当成了目的本身。它回答的不是同一个问题：一列会话可能同时好几行在跑，而那一列还要用来
	 * 读标题，射线并排明灭会把标题挡在余光里。所以它留着，并且由这条守着。
	 */
	const status = await readFile(new URL("features/conversation/SessionStatus.tsx", SRC), "utf8");
	assert.match(status, /BreatheLoader/, "会话行的 running 状态该用 BreatheLoader");

	const css = await readFile(new URL("styles/loading.css", SRC), "utf8");
	for (const rule of [/@keyframes ly-breathe-wave/, /@keyframes ly-breathe-core/, /@keyframes ly-breathe-hue/, /\.ly-breathe i \{/, /\.ly-breathe b \{/]) {
		assert.match(css, rule, `styles/loading.css 里少了 ${rule.source}——波纹会变成一个不动的方块`);
	}
});
