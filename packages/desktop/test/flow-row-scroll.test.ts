/**
 * 装不下的一行字，两处收尾必须是同一种做法：虚化，加悬停自读。
 *
 * 客户拿两张截图问的就是这件事。一张是转录里的推理行被剁在「…」上——那三个点报告了「这里被截
 * 了」，却不说截掉的是什么；一张是侧边栏一个十三个字、盒子明明装得下的标题，鼠标一放上去少掉最后
 * 一个字，断口齐得像裁纸刀裁的。
 *
 * 真实行为由三支探针在真窗口里量（`sidebar-title-scroll-probe`、`flow-summary-scroll-probe`、
 * `thinking-ticker-probe`）。这里守的是那几条容易在重构里悄悄消失的约定——上一次它们消失时，钉着
 * 它们的探针因为选择器过时变成了哑弹，一串 ✓ 印了很久，功能早就没了。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("「装不下」分两种：越出盒子，和悬停时被控件压住", async () => {
	const source = await read("src/ui/scroll/ScrollText.tsx");
	// 控件占掉的宽度算进可读空间：读不到就是装不下，跟是谁挡的无关。
	assert.match(source, /--ly-row-controls/);
	assert.match(source, /part - \(room - reserve\)/);
	// 两个状态各自成立，不能合成一个。
	assert.match(source, /data-ly-scroll-fit=\{scrolls \? \(clipped \? "over" : "yield"\) : undefined\}/);
	// 滚不滚看的是「读不全」，不是「越出盒子」。
	assert.match(source, /const scrolls = hidden > 1;/);
	assert.match(source, /const clipped = over > 1;/);
});

test("滚动壳的标记不和输入框让位那个撞名", async () => {
	const scroll = await read("src/ui/scroll/ScrollText.tsx");
	const composer = await read("src/styles/composer.css");
	// 输入框早就用了 `data-ly-fit`（值是 1/2，见 ComposerShell）。两个无关的东西共用一个属性名，
	// `[data-ly-fit]` 这种不带值的选择器迟早会扫到对方。
	assert.match(composer, /\[data-ly-fit="1"\]/);
	assert.doesNotMatch(scroll, /data-ly-fit[^-]/);
});

test("只在悬停时被压住的那种，虚化跟着控件来，不常驻", async () => {
	const css = await read("src/styles/marquee.css");
	assert.match(css, /\.ly-fade-edge\[data-ly-scroll-fit="yield"\]\s*\{\s*--ly-fade-right:\s*0;/);
	assert.match(css, /\[data-ly-hover-row\]:hover \.ly-fade-edge\[data-ly-scroll-fit="yield"\]\s*\{\s*--ly-fade-right:\s*22px;/);
	// `:has()` 单独成条：Lightning CSS 剪过一整个逗号组，连 `:hover` 那半边一起。
	assert.match(css, /\[data-ly-hover-row\]:has\(:focus-visible\) \.ly-fade-edge\[data-ly-scroll-fit="yield"\]/);
});

test("左边那道虚化只给会滚的壳", async () => {
	const css = await read("src/styles/marquee.css");
	// 过程行的骨架挂上 `ly-scroll` 之后，不限定就会扫到正在逐字写的那一句——它自己在 flow-row.css
	// 里声明了两头的深浅，而短句子那一档是 0。
	assert.match(css, /\.ly-scroll:hover \.ly-fade-edge\[data-ly-scroll-fit\]/);
	assert.doesNotMatch(css, /\.ly-scroll:hover \.ly-fade-edge\s*\{/);
});

test("过程行停下来之后也是虚化加悬停自读", async () => {
	const source = await read("src/features/conversation/FlowRow.tsx");
	assert.match(source, /ui\/scroll\/ScrollText/);
	// 正在写的那一句不换壳：字尾顶右另有一套，而且它是帧循环直接写进 DOM 的。
	assert.match(source, /\{followEnd \? summary : <ScrollText text=\{summary\} \/>\}/);
	// 悬停自读的钩子属于整行。
	assert.match(source, /const shell = `ly-flow-row ly-scroll /);
});

test("正在写的那一句，深浅仍由 flow-row 自己说了算", async () => {
	const css = await read("src/styles/flow-row.css");
	assert.match(css, /\.ly-flow-summary\[data-follow-end\]\s*\{\s*--ly-fade-left:\s*0;\s*--ly-fade-right:\s*0;/);
	assert.match(css, /\.ly-flow-summary\[data-follow-end\]\[data-clipped\]\s*\{\s*--ly-fade-left:\s*20px;\s*--ly-fade-right:\s*12px;/);
});
