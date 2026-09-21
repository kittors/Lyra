/**
 * 装不下的输入框，两头化开——这件事全靠两个字符串连在一起。
 *
 * 一个是类名 `ly-field-fade`，一个是变量名 `--ly-field-fade-top` / `-bottom`。中间没有任何一道
 * 检查：类名和自定义属性都是字符串，typecheck 不看，lint 不看，改错了照样能跑、能构建、能打包，
 * 只是每一个输入框的上下边缘悄悄变回硬切。同一个坑在 `Scroller` 上踩过一次（见 `scroll.css` 里
 * `ly-fade-y` 上面那段），当时全app的渐隐一起没了，而没有一条测试红。
 *
 * 所以这里三头都钉：组件挂了那个类、hook 写的是那两个名字、样式表里认的也是这两个名字。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { act, createElement as h, useRef } from "react";

import { CommandText } from "../../src/features/composer/CommandText.tsx";
import { TextArea } from "../../src/ui/inputs/TextArea.tsx";
import { mount } from "../helpers/mount.ts";

const FIELDS_CSS = new URL("../../src/styles/fields.css", import.meta.url);

/** jsdom 不排版，两个高度都是 0。自己造一个「装不下」出来。 */
function overflow(field: HTMLTextAreaElement, hidden: number, at: number): void {
	Object.defineProperty(field, "scrollHeight", { value: 100 + hidden, configurable: true });
	Object.defineProperty(field, "clientHeight", { value: 100, configurable: true });
	field.scrollTop = at;
}

test("统一的多行输入框：外壳管边界，字那一层挂着遮罩", async () => {
	const view = await mount(h(TextArea, { value: "写点什么", onChange: () => {} }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	assert.ok(field.classList.contains("ly-textarea"), "字那一层要有 .ly-textarea");
	assert.ok(field.classList.contains("ly-field-fade"), "字那一层要有 .ly-field-fade，遮罩画在它身上");
	/*
	 * 描边必须在外壳上。遮罩收的是元素画出的一切——边框和字同在一个元素上，滚到顶端时框的上下两
	 * 条边会跟着字一起淡掉，看起来像框破了个口子。
	 */
	const shell = view.find(".ly-textarea-shell");
	assert.ok(!shell.classList.contains("ly-field-fade"), "外壳不该被遮罩，否则它的描边会跟着淡掉");
	assert.ok(shell.contains(field), "字那一层在外壳里面");

	await view.unmount();
});

test("装得下就不化开，装不下才化开，而且只化开藏了东西的那一头", async () => {
	const view = await mount(h(TextArea, { value: "写点什么", onChange: () => {} }));
	const field = view.find<HTMLTextAreaElement>("textarea");
	const host = view.find(".ly-scroll-host");
	const depth = (end: "top" | "bottom") => Number.parseFloat(host.style.getPropertyValue(`--ly-field-fade-${end}`));

	// 一屏装得下：两头都是 0，遮罩因此是整块不透明的，等于没有。
	assert.equal(depth("top"), 0);
	assert.equal(depth("bottom"), 0);

	// 滚到中间：上下都藏着东西，两头都化开。
	overflow(field, 200, 100);
	await act(async () => field.dispatchEvent(new Event("scroll")));
	assert.ok(depth("top") > 0, "上面藏了东西就该化开");
	assert.ok(depth("bottom") > 0, "下面藏了东西就该化开");

	// 回到顶端：上面没有东西了，再化开就是把「还有更多」说成了背景噪音。
	overflow(field, 200, 0);
	await act(async () => field.dispatchEvent(new Event("scroll")));
	assert.equal(depth("top"), 0, "顶端不该有上渐隐");
	assert.ok(depth("bottom") > 0);

	// 到了底，同理反过来。
	overflow(field, 200, 200);
	await act(async () => field.dispatchEvent(new Event("scroll")));
	assert.ok(depth("top") > 0);
	assert.equal(depth("bottom"), 0, "到底了不该有下渐隐");

	await view.unmount();
});

test("刚推开两个像素，就只化开两个像素", async () => {
	const view = await mount(h(TextArea, { value: "写点什么", onChange: () => {} }));
	const field = view.find<HTMLTextAreaElement>("textarea");
	const host = view.find(".ly-scroll-host");

	overflow(field, 200, 2);
	await act(async () => field.dispatchEvent(new Event("scroll")));
	/*
	 * 跟着滚动量长出来，不是两档开关：`min(一行, 已经滚过去多少)`。补间反而会让虚化落在滚轮后
	 * 面——滚动本身每一帧都在更新这个数，它自己就是连续的。
	 */
	assert.equal(host.style.getPropertyValue("--ly-field-fade-top"), "2.0px");

	await view.unmount();
});

test("矮框里收得更浅，中间那几行还得能读", async () => {
	const view = await mount(h(TextArea, { value: "写点什么", onChange: () => {} }));
	const field = view.find<HTMLTextAreaElement>("textarea");
	const host = view.find(".ly-scroll-host");
	const depth = (end: "top" | "bottom") => Number.parseFloat(host.style.getPropertyValue(`--ly-field-fade-${end}`));

	/*
	 * 一个三行高的提交信息框：上下各化开一整行就是一半内容在雾里。上限是可视高度的五分之一，
	 * 和 `scrollFade` 给短面板留的是同一条线。
	 */
	Object.defineProperty(field, "scrollHeight", { value: 400, configurable: true });
	Object.defineProperty(field, "clientHeight", { value: 90, configurable: true });
	field.scrollTop = 150;
	await act(async () => field.dispatchEvent(new Event("scroll")));
	assert.equal(depth("top"), 18, "90px 高的框，最深就是 18px");
	assert.equal(depth("bottom"), 18);

	// 同样滚到中间，高的那个框就用得起一整行。
	Object.defineProperty(field, "clientHeight", { value: 300, configurable: true });
	await act(async () => field.dispatchEvent(new Event("scroll")));
	assert.ok(depth("top") > 18, "高框不受那条线约束，化开一整行");

	await view.unmount();
});

test("主输入框的镜像层单独占一层，不和横向那条遮罩挤在一个元素上", async () => {
	function Harness() {
		const mirror = useRef<HTMLDivElement>(null);
		return h(CommandText, {
			value: "/compact 一段很长的参数",
			decoration: { command: { start: 0, end: 8, hint: " 压缩上下文" } },
			mirror,
		});
	}
	const view = await mount(h(Harness));

	const mirror = view.find("[data-command-mirror]");
	const fading = mirror.parentElement;
	assert.ok(fading?.classList.contains("ly-field-fade"), "镜像层外面要有一层专管上下渐隐的");
	/*
	 * 横向那条留在更外面。两者都是 `mask-image`，写在同一个元素上是同一个属性的两次声明——后来
	 * 的整条替换掉前一条，不会合成。而它们真的会同时发生：一条带长参数的斜杠命令，右端要为提示
	 * 文字化开，上下又因为装不下要化开。
	 */
	assert.ok(!fading?.classList.contains("ly-fade-edge"), "横向那条不该和上下这条同在一个元素上");
	assert.ok(fading?.parentElement?.classList.contains("ly-fade-edge"), "横向那条在更外面那一层");

	await view.unmount();
});

test("样式表里认的是同一个类名和同一对变量", () => {
	/*
	 * 这一条看着像在测 CSS，其实测的是两个文件之间那根看不见的线。组件挂 `.ly-field-fade`，样式
	 * 表也得正好叫这个；hook 写 `--ly-field-fade-top`，遮罩也得正好读这个。任何一边单独改名，上
	 * 面几条全绿，而屏幕上一点渐隐都没有。
	 */
	const css = readFileSync(FIELDS_CSS, "utf8");
	assert.ok(css.includes(".ly-field-fade {"), "样式表里要有 .ly-field-fade");
	assert.ok(css.includes("@property --ly-field-fade-top"), "两个长度要注册，不注册就不是 <length>");
	assert.ok(css.includes("@property --ly-field-fade-bottom"));
	/*
	 * **可继承**，这是它们和 `--ly-fade-top` 那一族唯一实质的差别：主输入框的字有两层（textarea
	 * 和画标记的镜像层），写在共同的外壳上继承下去，两层才读得到同一个数。改成 false，镜像层就
	 * 永远是 0——一层淡了、另一层没淡。
	 */
	const registrations = css.slice(css.indexOf("@property --ly-field-fade-top"), css.indexOf(".ly-field-fade {"));
	assert.ok(!registrations.includes("inherits: false"), "两个长度必须可继承，镜像层靠继承读到它们");
	assert.ok(css.includes("var(--ly-field-fade-top)"), "遮罩要读这两个变量");
	assert.ok(css.includes("var(--ly-field-fade-bottom)"));
});
