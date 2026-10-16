/**
 * The phone's own frame: menus as sheets, the composer's three controls, settings as pages.
 *
 * Each is a phone-only branch of something the desktop also draws, so each test checks the phone
 * and then that the desktop is still what it was — a phone branch that leaks is a desktop
 * regression nobody asked for.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { EmptyState } from "../../src/features/conversation/EmptyState.tsx";
import { PhoneSettings } from "../../src/features/settings/PhoneSettings.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { MenuBody, MenuItem, Popover } from "../../src/ui/overlay/Popover.tsx";
import { click, fire, mount } from "../helpers/mount.ts";

// Enough of the bridge for the composer to mount, and for a settings page to ask about the project's own layer.
const bridge = { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) }, settings: { layers: async () => null } };
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
	document.documentElement.style.removeProperty("--ly-menu-sheet");
	delete document.documentElement.dataset.reduceMotion;
});

/** What Android's back button counts — the bridge's `layerDepth`, verbatim. */
function layers(): number {
	let depth = 0;
	for (const el of document.querySelectorAll('[data-pane="drawer"]')) if (!el.hasAttribute("inert")) depth++;
	for (const el of document.querySelectorAll('[aria-modal="true"]')) if (!el.hasAttribute("inert") && !el.hasAttribute("data-pane")) depth++;
	return depth;
}

test("a menu hung off a control is a sheet where the host draws menus that way, and a layer for the back button", async () => {
	document.documentElement.style.setProperty("--ly-menu-sheet", "1");
	const button = document.createElement("button");
	document.body.append(button);
	const sheet = await mount(h(Popover, { anchor: button, onClose: () => {}, children: h(MenuBody, null, h(MenuItem, { children: "置顶" })) }));
	try {
		const card = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(card);
		assert.ok(card.classList.contains("ly-menu-sheet"), "从底边升起的那一种");
		assert.equal(card.getAttribute("aria-modal"), "true", "安卓的返回键数得到它");
		assert.ok(document.querySelector(".ly-menu-sheet-scrim"), "背后压暗的那一层，点它收起，不点穿到下面的按钮");
		assert.equal(card.style.top, "", "不再挂在按钮旁边：位置交给样式表钉在底边");
		assert.equal(layers(), 1);
	} finally {
		await sheet.unmount();
	}

	// Hung off a point — a long press — it stays beside what was held: a sheet would cover it.
	const held = await mount(h(Popover, { anchor: { x: 60, y: 330 }, onClose: () => {}, children: h(MenuBody, null, h(MenuItem, { children: "复制" })) }));
	try {
		const card = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(card && !card.classList.contains("ly-menu-sheet"), "长按出来的菜单仍贴着被按住的那一行");
		assert.equal(document.querySelectorAll(".ly-menu-sheet-scrim").length, 0);
	} finally {
		await held.unmount();
	}

	// Where the host does not declare it — the desktop, a tablet — a menu is the card it always was.
	document.documentElement.style.removeProperty("--ly-menu-sheet");
	const card = await mount(h(Popover, { anchor: button, onClose: () => {}, children: h(MenuBody, null, h(MenuItem, { children: "文件" })) }));
	try {
		const element = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(element && !element.classList.contains("ly-menu-sheet"));
		assert.equal(element.getAttribute("aria-modal"), null);
	} finally {
		await card.unmount();
		button.remove();
	}
});

test("the composer on a phone: the attachment, the model and send — the rest is in the model's sheet", async () => {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		const row = view.find(".ly-composer-bar");
		const labels = [...row.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
		const chip = labels.find((label) => label?.startsWith("选择模型"));
		assert.ok(chip?.startsWith("选择模型 · 推理强度："), `胶囊画着推理强度，名字里也说着：${chip}`);
		assert.ok(!labels.includes("帮我批准"), "审批方式不在这一行，在模型的弹层里");
		assert.ok(!labels.some((label) => label?.startsWith("推理强度")), "推理强度也是");
		assert.ok(row.querySelector(".ly-phone-turn-badge"), "模型胶囊上画着推理强度");
		assert.equal(row.querySelectorAll(".ly-phone-turn-danger").length, 0, "没开完全访问，就没有红点");
	} finally {
		await view.unmount();
	}

	useApp.setState({ settings: { ...useApp.getState().settings!, permissionMode: "full" } });
	const full = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		assert.ok(full.find(".ly-composer-bar .ly-phone-turn-danger"), "完全访问打开时胶囊上亮红点：它从不悄悄地开着");
	} finally {
		await full.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		const labels = [...wide.find(".ly-composer-bar").querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		assert.ok(labels.includes("完全访问"), "桌面端那一行照旧");
		assert.ok(labels.some((label) => label.startsWith("推理强度")));
		assert.equal(wide.all(".ly-phone-turn-badge").length, 0);
	} finally {
		await wide.unmount();
	}
});

test("the model sheet on a phone offers nothing that leads to a page the phone does not have", async () => {
	document.documentElement.style.setProperty("--ly-menu-sheet", "1");
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		const chip = [...view.find(".ly-composer-bar").querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("选择模型"));
		assert.ok(chip);
		await click(chip);
		const sheet = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(sheet, "弹层开着");
		const text = sheet.textContent ?? "";
		// No model, so no levels to pick: the permission row is what is always there.
		assert.ok(text.includes("权限模式"), "弹层里是这一轮的设置");
		assert.ok(!text.includes("管理供应商与模型"), "供应商在电脑上配：这一页手机上没有，点进去落在「常规」");
		assert.ok(text.includes("供应商要在电脑上添加"), "没有模型时说清楚去哪里加，而不是一个点了去错页的入口");
	} finally {
		await view.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	document.documentElement.style.removeProperty("--ly-menu-sheet");
	const wide = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(EmptyState)) }));
	try {
		const chip = [...wide.find(".ly-composer-bar").querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("选择模型"));
		assert.ok(chip);
		await click(chip);
		const menu = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(menu?.textContent?.includes("管理供应商与模型"), "桌面端照旧");
	} finally {
		await wide.unmount();
	}
});

test("settings on a phone: a list of pages, one pushed over it, and back — by button, by Escape, and by name", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	useApp.setState({ view: "settings" });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(PhoneSettings)) }));
	try {
		assert.equal(view.find(".ly-phone-large-title").textContent, "设置");
		const rows = view.all(".ly-phone-group-row");
		assert.ok(rows.length >= 4, "分组列出的每一页");
		assert.equal(layers(), 1, "设置本身算一层：返回键从这里回到会话");

		await click(rows[0]);
		const page = view.find("[data-ly-phone-page]");
		assert.equal(page.getAttribute("data-ly-phone-page"), "general");
		assert.equal(page.getAttribute("role"), "dialog");
		assert.equal(layers(), 2, "推进来的一页再算一层");
		assert.ok(view.find(".ly-phone-stack").hasAttribute("inert"), "下面的列表让出焦点");

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});
		assert.equal(view.all("[data-ly-phone-page]").length, 0, "Esc——也就是安卓的返回键——退回列表");
		assert.equal(useApp.getState().view, "settings");

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});
		assert.equal(useApp.getState().view, "chat", "列表上再按一次，回到会话");

		// Asked for by name — 「管理供应商与模型」 — it opens on that page, even if it was the last one shown.
		await act(async () => {
			useApp.getState().setView("settings");
			useApp.getState().setSettingsSection("appearance");
		});
		assert.equal(view.find("[data-ly-phone-page]").getAttribute("data-ly-phone-page"), "appearance");
		await click(view.find(".ly-phone-back"));
		assert.equal(view.all("[data-ly-phone-page]").length, 0, "‹ 设置 回到列表");
		await act(async () => useApp.getState().setSettingsSection("appearance"));
		assert.equal(view.find("[data-ly-phone-page]").getAttribute("data-ly-phone-page"), "appearance", "同一页再点名一次也会打开");

		// A page the phone does not have leaves the list showing — not 常规 opened in its place.
		await act(async () => useApp.getState().setSettingsSection("models"));
		assert.equal(view.all("[data-ly-phone-page]").length, 0, "点名「供应商与模型」，停在列表上");
	} finally {
		await view.unmount();
	}
});

test("leaving settings puts it back on its list, and a page goes back with its own exit", async () => {
	useApp.setState({ view: "settings" });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(PhoneSettings)) }));
	try {
		await click(view.all(".ly-phone-group-row")[1]);
		await click(view.find(".ly-phone-back"));
		const page = view.find("[data-ly-phone-page]");
		assert.ok(page.hasAttribute("data-leaving"), "退场的那一段动画在播，页还在");
		await fire(page, new Event("animationend", { bubbles: true }));
		assert.equal(view.all("[data-ly-phone-page]").length, 0, "播完才拿掉");

		await click(view.all(".ly-phone-group-row")[0]);
		await act(async () => useApp.getState().setView("chat"));
		await act(async () => useApp.getState().setView("settings"));
		assert.equal(view.all("[data-ly-phone-page]").length, 0, "收起再打开，回到列表");
	} finally {
		await view.unmount();
	}
});

test("the conversation's bar on a phone: the drawer, the conversation, a new one — and the conversation's sheet", async () => {
	const { PhoneTopBar } = await import("../../src/features/split/PhoneTopBar.tsx");
	document.documentElement.style.setProperty("--ly-menu-sheet", "1");
	const meta = { id: "s1", title: "整理发布流程", projectId: "a", projectName: "aurora-notes", cwd: "/p/aurora-notes", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2 };
	useApp.setState({ meta, activeSessionId: null } as never);
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(PhoneTopBar, { sessionId: null })) }));
	try {
		const buttons = view.all("[data-ly-phone-bar] button").map((button) => button.getAttribute("aria-label"));
		assert.deepEqual(buttons, ["打开会话列表", "整理发布流程，会话选项", "新对话"], "三样，一端一个，标题在中间");
		await click(view.find(".ly-phone-bar-title"));
		const sheet = document.querySelector<HTMLElement>("[data-ly-popover]");
		assert.ok(sheet);
		assert.ok(sheet.classList.contains("ly-menu-sheet"), "会话的弹层从底边升起");
		assert.equal(sheet.querySelector(".ly-phone-sheet-heading-title")?.textContent, "整理发布流程");
		assert.ok(sheet.textContent?.includes("重命名"), "原来 ⋯ 里的操作都在");
	} finally {
		await view.unmount();
	}

	// A new conversation has no name yet, and the new-conversation button would only start it again.
	useApp.setState({ meta: null } as never);
	const blank = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, null, h(PhoneTopBar, { sessionId: null })) }));
	try {
		assert.deepEqual(blank.all("[data-ly-phone-bar] button").map((button) => button.getAttribute("aria-label")), ["打开会话列表"]);
		assert.ok(blank.find("[data-ly-phone-bar] [data-placeholder]"), "右边留着它的宽度，抽屉按钮不会挪位");
	} finally {
		await blank.unmount();
	}
});
