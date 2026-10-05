/**
 * The phone's own layout: the drawer's bottom bar, the empty screen, and menus that keep clear.
 *
 * Each of these is a phone-only branch of something the desktop also draws, so each test checks the
 * phone and then checks that the desktop is still what it was — a phone branch that leaks is a
 * desktop regression nobody asked for.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { EmptyState } from "../../src/features/conversation/EmptyState.tsx";
import { PhoneDock } from "../../src/features/sidebar/PhoneDock.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { CLEAR_GAP, holdClear } from "../../src/ui/overlay/keep-clear.ts";
import { MenuBody, MenuItem, Popover } from "../../src/ui/overlay/Popover.tsx";
import { click, fire, mount } from "../helpers/mount.ts";

/** Enough of the bridge for the composer the empty screen carries to mount. */
const bridge = { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) } };
const phone = { ...bridge, host: "mobile", platform: "darwin" };
const desktop = { ...bridge, host: "desktop", platform: "darwin" };

beforeEach(() => {
	Object.defineProperty(window, "lyra", { configurable: true, value: phone });
	useApp.setState({
		settings: { ...DEFAULT_SETTINGS, projects: [{ id: "a", path: "/p/aurora-notes", name: "aurora-notes", pinned: false, lastOpenedAt: 0 }] },
		workspace: { path: "/p/aurora-notes", name: "aurora-notes", isGitRepo: true, branch: "main" },
		view: "chat",
	});
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	holdClear(null);
	document.documentElement.style.removeProperty("--ly-menu-width-scale");
});

test("the drawer's bottom bar: search starts on focus and 取消 ends it", async () => {
	let toggles = 0;
	let searching = false;
	const view = await mount(
		h(PhoneDock, {
			searching,
			query: "",
			onQuery: () => {},
			onToggleSearch: () => {
				toggles++;
				searching = !searching;
			},
			onNavigate: () => {},
		}),
	);
	try {
		const field = view.find<HTMLInputElement>(".ly-phone-dock-search input");
		assert.equal(field.type, "search");
		assert.equal(field.getAttribute("aria-label"), "搜索会话");
		await act(async () => field.focus());
		assert.equal(toggles, 1, "聚焦搜索框就是开始搜索——键盘也是这一下点出来的");

		await view.rerender(h(PhoneDock, { searching: true, query: "Tab", onQuery: () => {}, onToggleSearch: () => toggles++, onNavigate: () => {} }));
		const cancel = view.find(".ly-phone-dock-cancel");
		assert.equal(cancel.textContent, "取消");
		assert.equal(view.all(".ly-phone-dock-primary").length, 0, "搜索时新对话让位给取消");
		await click(cancel);
		assert.equal(toggles, 2);
	} finally {
		await view.unmount();
	}
});

test("the drawer's bottom bar: settings and a new conversation, and the drawer goes away after either", async () => {
	let navigated = 0;
	let created = 0;
	useApp.setState({ newSession: async () => void created++ } as never);
	const view = await mount(h(PhoneDock, { searching: false, query: "", onQuery: () => {}, onToggleSearch: () => {}, onNavigate: () => navigated++ }));
	try {
		await click(view.find(".ly-phone-dock-primary"));
		assert.equal(created, 1);
		await click(view.find("button[aria-label='设置']"));
		assert.equal(useApp.getState().view, "settings");
		assert.equal(navigated, 2);
		for (const button of view.all("button")) {
			assert.ok(button.getAttribute("aria-label") || button.textContent?.trim(), "每颗按钮都有名字");
		}
	} finally {
		await view.unmount();
	}
});

test("the empty screen on a phone: the question in the middle, the starting points in one sideways row", async () => {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		const chips = view.all(".ly-phone-suggest .ly-phone-chip");
		assert.equal(chips.length, 4, "四个起点一个不少");
		assert.equal(view.find(".ly-phone-hero-title .whitespace-nowrap").textContent, "aurora-notes", "项目名不在连字符处折行");
		assert.equal(view.all(".ly-draft-chip").length, 0, "手机上不再是桌面那一排起点");

		await click(chips[0]);
		assert.ok(view.find<HTMLTextAreaElement>("textarea").value.trim(), "点起点是填进输入框，不是直接发出去");
	} finally {
		await view.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		assert.equal(wide.all(".ly-phone-suggest").length, 0, "桌面端没有横滑的那一排");
		assert.equal(wide.all(".ly-draft-chip").length, 4, "桌面端仍是四枚起点");
	} finally {
		await wide.unmount();
	}
});

test("a menu hung from a point keeps clear of what was lifted, and says where it went", async () => {
	const placed: number[] = [];
	holdClear({ rect: { top: 300, bottom: 356, left: 12, right: 336 }, onPlace: (spot) => placed.push(spot.top) });
	const view = await mount(
		h(Popover, { anchor: { x: 60, y: 330 }, onClose: () => {}, children: h(MenuBody, null, h(MenuItem, { children: "置顶" })) }),
	);
	try {
		const card = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(card);
		assert.equal(card.style.top, `${356 + CLEAR_GAP}px`, "菜单在那一行下面，不盖住它");
		assert.equal(card.style.left, "12px", "和那一行左对齐");
		assert.deepEqual(placed.slice(-1), [356 + CLEAR_GAP]);
	} finally {
		await view.unmount();
	}
});

test("anchored to a button, a menu is placed as it always was even while something is held", async () => {
	holdClear({ rect: { top: 300, bottom: 356, left: 12, right: 336 } });
	const button = document.createElement("button");
	document.body.append(button);
	const view = await mount(h(Popover, { anchor: button, onClose: () => {}, children: h(MenuBody, null, h(MenuItem, { children: "文件" })) }));
	try {
		const card = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.notEqual(card?.style.top, `${356 + CLEAR_GAP}px`, "只有从一个点挂出来的菜单才让位");
	} finally {
		await view.unmount();
		button.remove();
	}
});

test("the host can scale a menu's named width, and a width a caller chose is left alone", async () => {
	document.documentElement.style.setProperty("--ly-menu-width-scale", "1.3");
	const named = await mount(h(Popover, { anchor: { x: 10, y: 10 }, onClose: () => {}, width: "compact", children: h("div") }));
	try {
		assert.equal(document.querySelector<HTMLElement>("[data-ly-popover]")?.style.width, `${Math.round(190 * 1.3)}px`);
	} finally {
		await named.unmount();
	}
	const own = await mount(h(Popover, { anchor: { x: 10, y: 10 }, onClose: () => {}, width: 180, children: h("div") }));
	try {
		assert.equal(document.querySelector<HTMLElement>("[data-ly-popover]")?.style.width, "180px");
	} finally {
		await own.unmount();
	}
	document.documentElement.style.removeProperty("--ly-menu-width-scale");
	const plain = await mount(h(Popover, { anchor: { x: 10, y: 10 }, onClose: () => {}, width: "compact", children: h("div") }));
	try {
		assert.equal(document.querySelector<HTMLElement>("[data-ly-popover]")?.style.width, "190px", "没有声明倍率时和从前一样");
	} finally {
		await plain.unmount();
	}
	await fire(document.body, new Event("noop"));
});
