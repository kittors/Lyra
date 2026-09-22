/**
 * The question asked before something cannot be taken back.
 *
 * `docs/todolist.md` records twelve places wired to this — uninstalling a plugin, deleting a branch,
 * discarding working-tree changes, removing an MCP server. The component's comment states two
 * decisions that are easy to lose in a refactor and expensive to lose in production: cancel holds
 * the focus, and the destructive button is the one that is not focused. A rewrite that swaps them
 * turns Enter from "never mind" into "do it".
 *
 * Body tests cover wording and actions; focus is tested through the real modal shell.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useState } from "react";

import { Confirm, ConfirmBody, useConfirmGate } from "../../src/ui/overlay/Confirm.tsx";
import { click, mount } from "../helpers/mount.ts";

function open(overrides: Record<string, unknown> = {}) {
	return mount(
		h(ConfirmBody, {
			title: "卸载 Chrome？",
			detail: "它的技能和目录会一并删除。",
			confirmLabel: "卸载",
			onConfirm: () => {},
			onCancel: () => {},
			...overrides,
		}),
	);
}

test("Confirm: 标题、说明与动词都照原样显示", async () => {
	const view = await open();
	const text = view.text();

	// 标题点名了要删的东西，不是「确定吗？」——这是组件注释里写死的要求。
	assert.match(text, /卸载 Chrome？/);
	assert.match(text, /它的技能和目录会一并删除。/);
	assert.match(text, /卸载/);

	await view.unmount();
});

test("Confirm: 焦点在取消上，不在那个不可逆的按钮上", async () => {
	const view = await mount(h(Confirm, { title: "卸载 Chrome？", confirmLabel: "卸载", onConfirm: () => {}, onCancel: () => {} }));
	const buttons = document.querySelectorAll<HTMLButtonElement>('[data-ly-modal] button');

	assert.equal(buttons.length, 2, "两个出口：取消与执行");
	const [cancel, confirm] = buttons;

	// 名字写在按钮上，不在 aria-label 上：这两颗曾经是一个叉一个勾，动词藏在 tooltip 里。
	assert.equal(cancel!.textContent, "取消");
	assert.equal(confirm!.textContent, "卸载");
	// The shell owns focus so short dialogs do not scroll past their title at mount.
	assert.equal(document.activeElement, cancel, "取消必须持有焦点");
	assert.notEqual(document.activeElement, confirm, "焦点不能落在不可逆的那一半上");

	await view.unmount();
});

test("Confirm: 执行按钮用危险色，取消不用", async () => {
	const view = await open();
	const [cancel, confirm] = view.all<HTMLButtonElement>("button");

	assert.match(confirm!.className, /ly-dialog-action-danger/, "不可逆的动作要看起来不可逆");
	assert.doesNotMatch(cancel!.className, /ly-dialog-action-danger/, "取消是安全的那一个");

	await view.unmount();
});

test("Confirm: 两个按钮各自只触发自己的回调", async () => {
	let confirmed = 0;
	let cancelled = 0;
	const view = await open({ onConfirm: () => confirmed++, onCancel: () => cancelled++ });
	const [cancel, confirm] = view.all<HTMLButtonElement>("button");

	await click(cancel!);
	assert.deepEqual([confirmed, cancelled], [0, 1]);

	await click(confirm!);
	assert.deepEqual([confirmed, cancelled], [1, 1]);

	await view.unmount();
});

test("Confirm: 没有 detail 时不留空段落", async () => {
	const view = await open({ detail: undefined });
	assert.equal(view.all("p").length, 0, "标题已经说清楚时不该多一个空行");
	await view.unmount();
});

/**
 * 按下之后、退场动画播完之前，这个组件被卸载了。
 *
 * 这不是边角情形，是这个应用里最常见的一条路径：确认框是菜单弹出来的，而菜单在按下的那一刻
 * 就开始收自己。哪一边先收完，决定的是「删除」到底算不算数。
 *
 * 两个入口都要挡住。`useConfirmer` 那次的表现是什么都不发生（换模型的按钮按下去、弹窗消失、
 * 模型没变）；`useConfirmGate` 更糟一点——它有自己的卸载兜底，会把没等到的答案判成取消，
 * 于是一次「删除」被记成了一次「算了」。
 */
test("Confirm: 已经按下的确认，不会被卸载改判", async () => {
	let done = 0;
	const view = await mount(h(Confirm, { title: "删掉？", confirmLabel: "删", onConfirm: () => { done++; }, onCancel: () => {} }));
	const confirm = [...document.querySelectorAll("[data-ly-modal] button")].find((each) => (each.getAttribute("aria-label") ?? each.textContent) === "删");
	assert.ok(confirm);
	await click(confirm);
	assert.equal(done, 0, "动画还在播，还没轮到它");
	await view.unmount();
	assert.equal(done, 1, "卸载不是反悔");
});

test("Confirm: 一次也没答过的问题，卸载时算取消", async () => {
	let cancelled = 0;
	const view = await mount(h(Confirm, { title: "删掉？", confirmLabel: "删", onConfirm: () => {}, onCancel: () => { cancelled++; } }));
	await view.unmount();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(cancelled, 0, "没人按过任何东西时，卸载不该替他回答");
});

/** 一个用 `useConfirmGate` 问过一次问题的组件，和那个还没落地的答案。 */
async function askThroughGate() {
	const box: { ask?: () => void; answer: boolean | null } = { answer: null };
	function Host() {
		const gate = useConfirmGate();
		const [, force] = useState(0);
		box.ask = () => {
			void gate.ask({ title: "删掉？", confirmLabel: "删" }).then((given) => { box.answer = given; });
			force((n) => n + 1);
		};
		return gate.element;
	}
	const view = await mount(h(Host));
	box.ask?.();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.ok(document.querySelector("[data-ly-modal]"), "确认框没出来");
	return { view, box };
}

test("useConfirmGate: 按下确认后被卸载，await 拿到的是 true", async () => {
	const { view, box } = await askThroughGate();
	const confirm = [...document.querySelectorAll("[data-ly-modal] button")].find((each) => (each.getAttribute("aria-label") ?? each.textContent) === "删");
	assert.ok(confirm);

	await click(confirm);
	await view.unmount();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(box.answer, true, "按下的是「删」——卸载不能把它改判成取消");
});

test("useConfirmGate: 没答就被卸载，await 拿到 false 而不是永远不返回", async () => {
	const { view, box } = await askThroughGate();
	await view.unmount();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(box.answer, false, "问题跟着组件走了，等它的那个 await 必须有个结果");
});
