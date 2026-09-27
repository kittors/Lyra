/**
 * Long press on a phone: what it lands on, what it opens, and what it leaves alone.
 *
 * On a phone the long press is where a pointer's hover and right-click went. A conversation or
 * project row opens the very menu a right-click opens; a message gathers the buttons hovering would
 * have revealed; and nothing about it may fire on a tap, a scroll, a field or a menu that is already
 * open. Driven here with real touch events against the real layer, so the wiring is tested and not
 * only the arithmetic (that is `phone-long-press.test.ts`).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type SessionMeta } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionRow } from "../../src/features/sidebar/SessionRow.tsx";
import { HOLD_MS, pressTarget } from "../../src/mobile/long-press.ts";
import { PhoneTouch } from "../../src/mobile/PhoneTouch.tsx";
import { useApp } from "../../src/store/index.ts";
import { heldClear } from "../../src/ui/overlay/keep-clear.ts";
import { click, mount } from "../helpers/mount.ts";

const posted: { type: string; style?: string }[] = [];

beforeEach(() => {
	posted.length = 0;
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: { host: "mobile", platform: "darwin", clipboard: { writeText: async () => {}, readText: async () => "" } },
	});
	Object.defineProperty(window, "ReactNativeWebView", {
		configurable: true,
		value: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
	});
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	Reflect.deleteProperty(window, "ReactNativeWebView");
	for (const layer of document.querySelectorAll("[data-ly-lift]")) layer.remove();
});

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

type TouchWindow = typeof window & {
	Touch: new (init: { identifier: number; target: EventTarget; clientX: number; clientY: number }) => Touch;
	TouchEvent: new (type: string, init: TouchEventInit) => TouchEvent;
};

/** A finger landing on `target`, held for `ms`, and lifted. Returns the lift's touchend. */
async function hold(target: Element, ms: number) {
	const w = window as TouchWindow;
	const touch = new w.Touch({ identifier: 1, target, clientX: 40, clientY: 20 });
	await act(async () => {
		target.dispatchEvent(new w.TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch] }));
	});
	await wait(ms);
	const end = new w.TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [touch] });
	await act(async () => {
		target.dispatchEvent(end);
	});
	return end;
}

test("what a press lands on: rows open their menu, messages lift their bubble or their text", () => {
	document.body.innerHTML = `
		<div data-ly-hover-row data-ly-row="s1"><button><span id="title">标题</span></button></div>
		<div data-ly-hover-row data-ly-project="aurora"><button><span id="project">aurora</span></button></div>
		<div class="group/msg" id="sent"><div class="ly-user-bubble"><p id="said">把最后一个提交改规范</p></div><div data-ly-hover-reveal></div></div>
		<div class="group/msg" id="reply"><div id="answer"><p id="line">已接好</p></div><div data-ly-hover-reveal></div></div>
		<div class="group/msg"><textarea id="field"></textarea></div>
		<div data-ly-popover="1"><button id="item">置顶</button></div>
	`;
	const at = (id: string) => pressTarget(document.getElementById(id));

	assert.equal(at("title")?.kind, "row");
	assert.equal(at("project")?.kind, "row");
	assert.equal(at("said")?.kind, "message");
	assert.equal(at("said")?.lift.className, "ly-user-bubble", "发出去的消息抬起的是气泡");
	assert.equal(at("line")?.lift.id, "answer", "回复抬起的是正文，不带下面那排操作");
	assert.equal(at("field"), null, "输入框里的长按是选字、粘贴，不归这里");
	assert.equal(at("item"), null, "已经打开的菜单里不再起一层");
	document.body.innerHTML = "";
});

test("a long press on a row opens the row's own context menu, lifted, with a tap you can feel", async () => {
	let menus = 0;
	let opened = 0;
	const view = await mount(
		h(
			"div",
			null,
			h(PhoneTouch),
			h(
				"div",
				{
					"data-ly-hover-row": "",
					"data-ly-row": "s1",
					onContextMenu: (event: MouseEvent) => {
						event.preventDefault();
						menus++;
					},
				},
				h("button", { type: "button", onClick: () => opened++ }, h("span", null, "排查首页加载慢")),
			),
		),
	);
	try {
		const title = view.find("[data-ly-row] span");
		const end = await hold(title, HOLD_MS + 60);
		assert.equal(menus, 1, "长按给那一行送一次右键菜单");
		assert.deepEqual(posted, [{ type: "haptic", style: "medium" }]);
		assert.ok(document.querySelector("[data-ly-lift]"), "那一行被抬起来");
		assert.ok(view.find("[data-ly-row]").hasAttribute("data-ly-lift-source"), "原来那一行藏在复制品下面");
		assert.ok(heldClear(), "菜单要让开那一行");
		assert.equal(end.defaultPrevented, true, "松手不能再算一次点按");
		await click(view.find("[data-ly-row] button"));
		assert.equal(opened, 0, "长按之后紧跟的那一下点击不打开会话");
	} finally {
		await view.unmount();
	}
	assert.equal(heldClear(), null, "卸载时松开避让区");
});

test("a tap is only a tap, and a scroll never becomes a press", async () => {
	let menus = 0;
	const view = await mount(
		h(
			"div",
			null,
			h(PhoneTouch),
			h(
				"div",
				{ "data-ly-hover-row": "", "data-ly-row": "s1", onContextMenu: () => menus++ },
				h("button", { type: "button" }, h("span", null, "升级到 React 19")),
			),
		),
	);
	try {
		await hold(view.find("[data-ly-row] span"), 90);
		assert.equal(menus, 0);

		const w = window as TouchWindow;
		const target = view.find("[data-ly-row] span");
		const start = new w.Touch({ identifier: 2, target, clientX: 40, clientY: 20 });
		const moved = new w.Touch({ identifier: 2, target, clientX: 40, clientY: 60 });
		await act(async () => {
			target.dispatchEvent(new w.TouchEvent("touchstart", { bubbles: true, touches: [start], changedTouches: [start] }));
			target.dispatchEvent(new w.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [moved], changedTouches: [moved] }));
		});
		await wait(HOLD_MS + 60);
		assert.equal(menus, 0, "手指滑走了就是在滚动");
		assert.equal(posted.length, 0);
		assert.equal(document.querySelector("[data-ly-lift]"), null);
	} finally {
		await view.unmount();
	}
});

test("a long press on a message offers what its hover row offers, and a way to select its text", async () => {
	let copied = 0;
	const view = await mount(
		h(
			"div",
			null,
			h(PhoneTouch),
			h(
				"div",
				{ className: "group/msg" },
				h("div", { className: "prose-dw" }, h("p", null, "令牌桶放在 sync.Map 里。")),
				h(
					"div",
					{ "data-ly-hover-reveal": "" },
					h("span", null, "9月26日 14:12"),
					h("button", { type: "button", "data-ly-tip": "复制", "aria-label": "复制这条消息", onClick: () => copied++ }, h("svg", { className: "lucide lucide-copy" })),
				),
			),
		),
	);
	try {
		await hold(view.find(".prose-dw p"), HOLD_MS + 60);
		const menu = document.querySelector("[data-ly-popover]");
		assert.ok(menu, "消息长按出菜单");
		const items = [...menu.querySelectorAll("button")].map((button) => button.textContent?.trim());
		assert.deepEqual(items, ["复制", "选择文本"]);
		assert.ok(menu.textContent?.includes("9月26日 14:12"), "时间挪到菜单顶上，不会因为那一行藏起来就丢了");

		await click([...menu.querySelectorAll("button")].find((button) => button.textContent?.includes("复制"))!);
		await wait(40);
		assert.equal(copied, 1, "菜单里的复制按的是原来那颗按钮");
		assert.equal(document.querySelector("[data-ly-popover]"), null, "选完菜单就收起");
	} finally {
		await view.unmount();
	}
});

test("「选择文本」 opens the message in a sheet where text can be selected", async () => {
	const view = await mount(
		h(
			"div",
			null,
			h(PhoneTouch),
			h("div", { className: "group/msg" }, h("div", { className: "prose-dw" }, h("p", null, "把 Tab 交给表格。")), h("div", { "data-ly-hover-reveal": "" })),
		),
	);
	try {
		await hold(view.find(".prose-dw p"), HOLD_MS + 60);
		const select = [...document.querySelectorAll("[data-ly-popover] button")].find((button) => button.textContent?.includes("选择文本"));
		assert.ok(select);
		await click(select);
		await wait(40);
		const sheet = document.querySelector("[data-ly-phone-sheet] [role='dialog']");
		assert.ok(sheet, "底部弹出一张面板");
		assert.ok(sheet.querySelector("[data-ly-selectable]")?.textContent?.includes("把 Tab 交给表格。"));
	} finally {
		await view.unmount();
	}
});

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const session: SessionMeta = {
	id: "s1",
	title: "排查首页加载慢",
	cwd: "/a",
	projectId: "a",
	projectName: "aurora-notes",
	createdAt: Date.now() - 86_400_000,
	updatedAt: Date.now() - 86_400_000,
	modelId: "",
	messageCount: 2,
	seq: 2,
	usage,
};

test("a conversation row on a phone reads its date under the title; the desktop's row is unchanged", async () => {
	useApp.setState({ settings: { ...DEFAULT_SETTINGS }, sessions: [session], activity: {}, activeSessionId: null });
	const phone = await mount(h(LayoutProvider, null, h(SessionRow, { session, onOpen: () => {}, onArchive: () => {} })));
	try {
		assert.equal(phone.find(".ly-row-when").textContent, "昨天");
		assert.ok(phone.find("[data-ly-row] button").textContent?.includes("排查首页加载慢"));
	} finally {
		await phone.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: { host: "desktop", platform: "darwin" } });
	const desktop = await mount(h(LayoutProvider, null, h(SessionRow, { session, onOpen: () => {}, onArchive: () => {} })));
	try {
		assert.equal(desktop.all(".ly-row-when").length, 0, "桌面端的会话行不多出一行日期");
		assert.equal(desktop.all("[data-ly-hover-reveal] button").length, 2, "桌面端的置顶、归档仍在悬停条上");
	} finally {
		await desktop.unmount();
	}
});
