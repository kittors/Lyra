import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Globe, Terminal } from "lucide-react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import { DockView } from "../../src/features/dock/DockView.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { registerPanels } from "../../src/features/dock/panels/registry.ts";
import { toggleScopedPanel } from "../../src/features/dock/popout.ts";
import { useApp } from "../../src/store/index.ts";
import { translate } from "../../src/i18n/translate.ts";
import { click, mount } from "../helpers/mount.ts";

test("tabs layout: every panel stays mounted in one right-hand pane, and only the current tab shows", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "darwin" } });
	window.localStorage.clear();
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, panelLayout: "tabs" } } });
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, tab: {}, tabShare: 0.4, host: null });
	const unregister = registerPanels([
		{ kind: "terminal", label: "common.terminal", icon: Terminal, shortcut: "", render: () => h("input", { "data-test-terminal": "" }) },
		{ kind: "browser", label: "browser.title", icon: Globe, shortcut: "", render: () => h("input", { "data-test-browser": "" }) },
	]);
	const scope = "tabs";
	const view = await mount(h(LayoutProvider, { children: h(DockView, { scope, header: () => null, children: h("textarea") }) }));
	const pane = (kind: string) => view.find(`[data-dock-pane="${kind}"]`) as HTMLElement;
	try {
		await act(() => { usePaneDock.getState().open(scope, "terminal"); });
		const terminal = view.find("[data-test-terminal]");
		// 「+」里只列还没开的面板，点一下开成新标签；开过的不再列。
		await click(pane("terminal").querySelector(`button[aria-label="${translate("pane.addTab")}"]`)!);
		const items = [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
		const offered = items.map((item) => item.textContent ?? "");
		assert.ok(!offered.some((text) => text.includes(translate("common.terminal"))), "an open panel was offered again");
		const browserItem = items.find((item) => item.textContent?.includes(translate("browser.title")));
		assert.ok(browserItem, `the browser was not offered: ${offered.join(", ")}`);
		await click(browserItem);
		assert.equal(usePaneDock.getState().tab[scope], "browser");

		// 两个面板占同一格，在对话右边，只有新开的那个看得见。
		assert.equal(pane("terminal").style.left, pane("browser").style.left);
		assert.equal(pane("browser").style.width, "40.000000%");
		assert.equal(pane("browser").inert, false);
		assert.equal(pane("terminal").inert, true);
		assert.equal(view.all("[data-dock-grip]").length, 0, "the tabs layout has nothing to drag");

		// 点标签切过去，终端的 DOM 还是原来那一个。
		await click(pane("browser").querySelector('[data-panel-tab="terminal"] [role="tab"]')!);
		assert.equal(pane("terminal").inert, false);
		assert.equal(pane("browser").inert, true);
		assert.ok(view.find("[data-test-terminal]") === terminal, "switching tabs remounted the panel");

		// 工具栏按钮按到后台标签是切过去，按到当前标签才是关。
		await act(() => { toggleScopedPanel(scope, "browser"); });
		assert.equal(pane("browser").inert, false);
		await act(() => { toggleScopedPanel(scope, "browser"); });
		assert.equal(view.all('[data-dock-pane="browser"] [data-panel-tab="browser"]').length, 0);
		// 关掉当前标签，落到剩下的那个上。
		assert.equal(pane("terminal").inert, false);
	} finally {
		await view.unmount();
		unregister();
		usePaneDock.setState({ trees: {}, focused: {}, tab: {} });
	}
});
