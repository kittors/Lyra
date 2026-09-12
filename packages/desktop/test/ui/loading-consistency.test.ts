/**
 * 全应用只有一种「正在忙」的记号。
 *
 * 这条不是审美洁癖，是它烂掉的方式决定的：loading 从来不是一次加进来的，是二十几个人在二十几个
 * 星期里各加一个。每一个单独看都没问题——手边有 `Loader2`，套一个 `animate-spin` 就转起来了，
 * 比找到 `Spinner` 在哪儿快。等到能看出不对的时候，侧栏的项目行、它下面的会话行、任务清单里的
 * 每一步已经是三种不同的记号，说的却是同一句话。
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
		"进度环。它画的是「下到几成」，转只是在说这一段进度未知；换成射线就没有地方放那段弧。",
	],
]);

/**
 * 每一条禁令，连同它该改成什么。
 *
 * 这里禁的是**转圈**，不是「除 Spinner 之外的一切」。侧栏会话行的呼吸波纹（`BreatheLoader` /
 * `ly-breathe`）不在名单上，而且是故意不在：那一列可能同时好几行在跑，一列并排明灭的记号会把
 * 标题挡在余光里读不了。第一版把它也算成「第二种 loading」删掉了，那是把统一当成了目的本身。
 */
const BANNED = [
	{ pattern: /\bLoader2\b/, fix: "换成 `Spinner`（ui/motion/loaders.tsx）" },
	{ pattern: /\banimate-spin\b/, fix: "换成 `Spinner`，不要把图标转起来" },
	{ pattern: /\bly-spin\b/, fix: "`ly-spin` 只留给更新徽章的进度环；「正在忙」用 `Spinner`" },
];

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
