/**
 * 那张脸真的会眨眼、会被指针逗、会随状态换表情——挂载出来量，不看代码里写了什么。
 *
 * 眨眼和悬停都不是 React 渲染出来的：它们是往 DOM 上直接挂一个属性、让 CSS 放一段动画。这种东西
 * 类型检查和快照都看不见，一个没接上的定时器在屏幕上和「设计如此」长得一模一样，所以这里一条条问
 * DOM：属性挂上了没有、眼睛挪了没有、表情换了没有。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, createElement as h } from "react";
import { AgentAvatar } from "../../src/ui/avatar/AgentAvatar.tsx";
import { AvatarStack } from "../../src/ui/avatar/AvatarStack.tsx";
import { blinkPause } from "../../src/lib/agent-avatar.ts";
import { fire, mount } from "../helpers/mount.ts";

const face = { shape: "cloud", color: "violet" } as const;

beforeEach(() => {
	document.documentElement.dataset.reduceMotion = "off";
});
afterEach(() => {
	delete document.documentElement.dataset.reduceMotion;
	mock.timers.reset();
});

test("it draws the shape it was given and says which one it is", async () => {
	const view = await mount(h(AgentAvatar, { avatar: face, size: 40, seed: "plan" }));
	const root = view.find(".ly-avatar");
	assert.equal(root.dataset.avatar, "cloud-violet");
	assert.equal(root.dataset.mood, "idle");
	assert.equal(root.style.getPropertyValue("--ly-avatar-size"), "40px");
	assert.ok(view.find(".ly-avatar-body").getAttribute("d"), "a body");
	assert.equal(view.all(".ly-avatar-eyes > g").length, 2, "two eyes");
	assert.equal(root.getAttribute("aria-hidden"), "true", "decorative next to a name");
	await view.unmount();
});

test("each mood has its own eyes", async () => {
	const eyes = async (mood: "idle" | "working" | "waiting" | "done" | "failed" | "stopped") => {
		const view = await mount(h(AgentAvatar, { avatar: face, mood, seed: "x" }));
		const glyph = view.find(".ly-avatar-eyes > g > *");
		const shape = `${glyph.tagName.toLowerCase()}:${glyph.getAttribute("d") ?? glyph.getAttribute("height")}`;
		await view.unmount();
		return shape;
	};
	// 一个一个挂：并排的 act 会互相踩，后面每一条测试都跟着坏。
	const drawn: string[] = [];
	for (const mood of ["idle", "waiting", "done", "failed", "stopped"] as const) drawn.push(await eyes(mood));
	assert.equal(new Set(drawn).size, drawn.length, `five different pairs of eyes: ${drawn.join(" | ")}`);
	assert.equal(await eyes("working"), await eyes("idle"), "working keeps its eyes open — the scan and the bob are what move");
});

test("it blinks on its own every few seconds, and stops once it has finished", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mount(h(AgentAvatar, { avatar: face, seed: "blinker" }));
	// finally 里卸载：留一张脸挂着，它的眨眼会在后台一直排下去，整个文件就退不出去了。
	try {
		const root = view.find(".ly-avatar");
		assert.equal(root.hasAttribute("data-blink"), false, "not straight away");
		await act(async () => mock.timers.tick(6500));
		assert.equal(root.hasAttribute("data-blink"), true, "within 6.5 seconds it has blinked");
		await view.rerender(h(AgentAvatar, { avatar: face, seed: "blinker", mood: "done" }));
		root.removeAttribute("data-blink");
		await act(async () => mock.timers.tick(20000));
		assert.equal(root.hasAttribute("data-blink"), false, "a finished one keeps its happy eyes still");
	} finally {
		await view.unmount();
	}
});

test("the pointer coming in pokes it, moving looks at the pointer, leaving looks back", async () => {
	const view = await mount(h("div", { "data-ly-avatar-host": "", id: "row" }, h(AgentAvatar, { avatar: face, seed: "hover", host: "[data-ly-avatar-host]" })));
	const root = view.find(".ly-avatar");
	const row = view.find("#row");
	await fire(row, new window.PointerEvent("pointerenter"));
	assert.equal(root.hasAttribute("data-poke"), true, "entering anywhere on the row pokes the face");
	assert.equal(root.hasAttribute("data-blink"), true, "and it blinks at you");
	const frames = mock.method(window, "requestAnimationFrame", (run: FrameRequestCallback) => {
		run(0);
		return 1;
	});
	await fire(row, new window.PointerEvent("pointermove", { clientX: 500, clientY: 0 }));
	assert.ok(Number.parseFloat(root.style.getPropertyValue("--ly-look-x")) > 0, `looks right, toward the pointer: ${root.style.getPropertyValue("--ly-look-x")}`);
	await fire(row, new window.PointerEvent("pointerleave"));
	assert.equal(root.style.getPropertyValue("--ly-look-x"), "", "looks ahead again");
	frames.mock.restore();
	await view.unmount();
});

test("reduced motion: no poke and no following the pointer", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	const view = await mount(h(AgentAvatar, { avatar: face, seed: "still" }));
	const root = view.find(".ly-avatar");
	await fire(root, new window.PointerEvent("pointerenter"));
	await fire(root, new window.PointerEvent("pointermove", { clientX: 500, clientY: 0 }));
	assert.equal(root.hasAttribute("data-poke"), false);
	assert.equal(root.style.getPropertyValue("--ly-look-x"), "");
	await view.unmount();
});

test("finishing work is marked with a hop; opening onto work already done is not", async () => {
	const view = await mount(h(AgentAvatar, { avatar: face, seed: "cheer", mood: "working" }));
	const root = view.find(".ly-avatar");
	await view.rerender(h(AgentAvatar, { avatar: face, seed: "cheer", mood: "done" }));
	assert.equal(root.hasAttribute("data-cheer"), true, "working → done hops");
	await view.unmount();
	const opened = await mount(h(AgentAvatar, { avatar: face, seed: "cheer", mood: "done" }));
	assert.equal(opened.find(".ly-avatar").hasAttribute("data-cheer"), false, "a finished one found on arrival stays put");
	await opened.unmount();
	const failed = await mount(h(AgentAvatar, { avatar: face, seed: "shake", mood: "working" }));
	await failed.rerender(h(AgentAvatar, { avatar: face, seed: "shake", mood: "failed" }));
	assert.equal(failed.find(".ly-avatar").hasAttribute("data-shake"), true, "working → failed shakes its head");
	await failed.unmount();
});

test("a stack names every face, and folds the overflow into a count", async () => {
	const faces = Array.from({ length: 9 }, (_, index) => ({ key: String(index), avatar: face, seed: String(index), tip: `face ${index}` }));
	const view = await mount(h(AvatarStack, { faces, max: 6 }));
	assert.equal(view.all("[data-stack-face]").length, 5, "five faces and a count fit in six");
	assert.equal(view.text(), "+4");
	assert.equal(view.find("[data-stack-face]").getAttribute("aria-label"), "face 0");
	await view.unmount();
});

test("连眨两下的那一次，第二下跟着交差一起撤掉——交差之后一下都不眨", async (t) => {
	/*
	 * 五次里有一次连眨两下，第二下是另排的一个定时器。它从前没人管：交差的那一刻正好赶上连眨，
	 * 240ms 之后弯着的眼睛又眨了一下。随机数钉死在「连眨」那一边，这条就不再是五次里红一次。
	 */
	t.mock.method(Math, "random", () => 0.1);
	mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mount(h(AgentAvatar, { avatar: face, seed: "twice" }));
	try {
		const root = view.find(".ly-avatar");
		// 走到第一下正好眨出来的那一刻：第二下还在 240ms 之后排着，这时候交差。
		await act(async () => mock.timers.tick(blinkPause("twice", () => 0.1)));
		assert.equal(root.hasAttribute("data-blink"), true);
		await view.rerender(h(AgentAvatar, { avatar: face, seed: "twice", mood: "done" }));
		root.removeAttribute("data-blink");
		await act(async () => mock.timers.tick(20000));
		assert.equal(root.hasAttribute("data-blink"), false, "交差之后一下都不眨");
	} finally {
		await view.unmount();
		mock.timers.reset();
	}
});
