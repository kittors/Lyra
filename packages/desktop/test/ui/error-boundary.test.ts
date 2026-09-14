/**
 * 崩掉之后那一屏，它自己得是好的。
 *
 * 这一屏是失败时唯一还在说话的东西，而它出现的时候没有人在旁边调试它——所以这里断言的都是「看的
 * 人下一步要做什么」：把组件栈复制走，以及重来一次。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { ErrorBoundary } from "../../src/ui/layout/ErrorBoundary.tsx";
import { mount } from "../helpers/mount.ts";

/** 一个一定会抛的子树，就是这道边界存在的理由。 */
function Throws(): never {
	throw new Error("测试用的崩溃");
}

/** React 会把这次错误也打到 console.error 上，测试输出里不需要那一屏红字。 */
async function mountCrashed() {
	const quiet = console.error;
	console.error = () => {};
	try {
		return await mount(h(ErrorBoundary, { children: h(Throws) }));
	} finally {
		console.error = quiet;
	}
}

test("ErrorBoundary：报错原文照抄，不转述", async () => {
	const view = await mountCrashed();
	assert.match(view.find("pre").textContent ?? "", /测试用的崩溃/);
	await view.unmount();
});

test("ErrorBoundary：重来那一枚排在说明之后，而且不是实心按钮", async () => {
	const view = await mountCrashed();
	const reload = [...document.querySelectorAll("button")].find((b) => /重新加载|重载|Reload|reload/i.test(b.getAttribute("aria-label") ?? ""));
	assert.ok(reload, "得有一枚重来的按钮");
	/*
	 * 说明在前、按钮在后。
	 *
	 * 这是「那一行字和上面左对齐」的可断言形式：按钮排在行首时，整段说明会被它推离左边缘。
	 * `compareDocumentPosition` 问的是文档顺序，正是这件事。
	 */
	const hint = [...document.querySelectorAll("span")].find((s) => (s.textContent ?? "").includes("dev server"));
	assert.ok(hint, "得有那句 dev server 的说明");
	assert.ok(
		hint.compareDocumentPosition(reload) & Node.DOCUMENT_POSITION_FOLLOWING,
		"重来的按钮要排在说明后面",
	);
	// 实心按钮会带上底色；这一枚只在 hover 时才有。
	assert.doesNotMatch(reload.className, /\bbg-ink\b/, "这一枚不该是实心的");
	await view.unmount();
});

test("ErrorBoundary：组件栈那一框角上有复制，且提示人复制它", async () => {
	const view = await mountCrashed();
	const copy = [...document.querySelectorAll("button")].find((b) => b.className.includes("group-hover/copy"));
	assert.ok(copy, "组件栈那一框要有复制键");
	assert.match(copy.className, /\bleft-1\.5\b/, "复制键在左上角——右边会压在长行上");
	assert.ok(copy.closest(".group\\/copy"), "它得挂在一个 group/copy 的框里，否则永远不出现");
	assert.ok(
		[...document.querySelectorAll("p")].some((p) => /issue/i.test(p.textContent ?? "")),
		"得有一句话说明提交问题时要带上组件栈",
	);
	await view.unmount();
});
