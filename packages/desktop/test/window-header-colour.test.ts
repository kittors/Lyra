/**
 * Windows 和 Linux 那条 header，左右两半必须是同一个颜色。
 *
 * 那条带子的右端是系统画的：最小化、最大化、关闭三颗按钮，由 `titleBarOverlay` 指定底色。左端
 * 到中间是页面画的 `.ly-window-header`。两边各有各的出处，而它们是同一条带子上相邻的两块——
 * 出处不同就会差色，于是窗口右上角浮出一块比周围浅一档的补丁，看上去像那里少画了点什么。
 *
 * 它就是这么来的：CSS 那边是 `--color-sidebar`，`setWindowTheme` 送出去的却是窗口底色
 * （`--color-shell`）。两者在浅色主题下是 #fafafa 和 #ffffff——真窗口里量过，差得不多，但足够
 * 看出一块方的。
 *
 * 所以这里守的是「同一个 token」而不是「同一个值」：值随主题走，token 是那条约定。一个人改了
 * header 的底色而没有动另一边的时候，红的应该是这里，而不是某台 Windows 机器上的截图。
 *
 * 只有这一处是文本断言，因为这条约定跨了三个文件和一次 IPC，没有一个运行期的地方同时看得见两边
 * ——macOS 上 `setTitleBarOverlay` 那一段根本不执行。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...parts: string[]) => readFileSync(join(import.meta.dirname, "..", ...parts), "utf8");

test("header 的底色与系统按钮那块底色出自同一个 token", () => {
	const css = read("src", "styles", "tabs.css");
	const theme = read("src", "features", "settings", "theme.ts");

	const painted = css.match(/\.ly-window-header\s*\{[^}]*background:\s*var\((--[\w-]+)\)/)?.[1];
	assert.ok(painted, "在 tabs.css 里找不到 .ly-window-header 的背景色");

	const sent = theme.match(/headerColor:\s*tokens\[["'](--[\w-]+)["']\]/)?.[1];
	assert.ok(sent, "theme.ts 没有把 header 的底色作为 headerColor 送给主进程");

	assert.equal(
		sent,
		painted,
		`送出去的是 ${sent}，而那条带子画的是 ${painted}——系统按钮身下会是另一个颜色`,
	);
});

test("主进程拿 headerColor 去画系统按钮，拿 color 去铺窗口自己的底", () => {
	const main = read("electron", "window.ts");

	const overlay = main.match(/setTitleBarOverlay\(\{[^}]*color:\s*colors\.(\w+)/)?.[1];
	assert.equal(overlay, "headerColor", "系统按钮那块底色应当取 headerColor");

	/*
	 * 另一半同样要守住。这两个值一度是同一个，把 overlay 改对之后如果顺手让窗口底色也跟着变成
	 * header 那一档，快速拖拽窗口边缘时透出来的就不再是页面的底色——那是另一个方向的同一个毛病。
	 */
	assert.match(
		main,
		/setBackgroundColor\(colors\.color\)/,
		"窗口自己的底色应当仍然取 color（快速缩放时透出的那一层）",
	);
});
