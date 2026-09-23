/**
 * 访达、废纸篓，是 macOS 的说法。
 *
 * Windows 上叫资源管理器和回收站，Linux 上是文件管理器和回收站。照着 Mac 写死的文案在 PC 上
 * 让人去找一个不存在的程序——「可以在访达里找回」。主进程给的那个 reveal 标签又是写死的中文，
 * 于是英文界面的菜单里也冒出一句「在资源管理器中显示」。
 */

import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";

import { GeneralSettings } from "../../src/features/settings/GeneralSettings.tsx";
import { useDefinitionRemoval } from "../../src/features/settings/useDefinitionRemoval.tsx";
import { WorktreesSettings } from "../../src/features/settings/WorktreesSettings.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

function host(platform: string, extra: Record<string, unknown> = {}) {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform, ...extra } });
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

beforeEach(() => {
	useApp.setState({
		settings: { ...DEFAULT_SETTINGS, projects: [{ path: "/repo", name: "repo", pinned: false, lastOpenedAt: 1 }] },
		saveSettings: async (next: Settings) => {
			useApp.setState({ settings: next });
		},
	} as never);
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
});

// The general page starts the update check's never-ending timer; see `settings-platform.test.ts`.
after(() => (window as unknown as { happyDOM: { abort(): Promise<void> } }).happyDOM.abort());

async function show(locale: "zh-CN" | "en", children: ReactNode) {
	const view = await mount(h(I18nProvider, { locale, children }));
	await settle();
	return view;
}

test("「默认打开方式」里那一项不照抄主进程写死的中文", async () => {
	// What the main process actually sends: a Chinese sentence, whatever language the window is in.
	host("win32", {
		system: { openTargets: async () => [{ id: "reveal", label: "在资源管理器中显示", aliases: [] }], openExternal: async () => {} },
		settings: { layers: async () => null },
	});
	// Chosen, so it is the value the row shows rather than one entry of a closed menu.
	const settings = useApp.getState().settings!;
	useApp.setState({ settings: { ...settings, editor: { ...settings.editor, defaultOpenTarget: "reveal" } } } as never);
	const view = await show("en", h(GeneralSettings));
	try {
		assert.ok(view.text().includes("Show in File Explorer"), view.text().slice(0, 300));
		assert.ok(!view.text().includes("资源管理器"));
	} finally {
		await view.unmount();
	}
});

test("工作树那一行的「显示」按钮，说的是这台机器的文件管理器，用的是界面的语言", async () => {
	const worktrees = async () => [{ worktree: true, path: "/wt/a", label: "a", branch: "feat" }];
	for (const [platform, locale, label] of [
		["win32", "zh-CN", "在资源管理器中显示"],
		["linux", "zh-CN", "在文件管理器中显示"],
		["darwin", "zh-CN", "在访达中显示"],
		["win32", "en", "Show in File Explorer"],
		["darwin", "en", "Show in the Finder"],
	] as const) {
		host(platform, { git: { worktrees } });
		const view = await show(locale, h(WorktreesSettings));
		try {
			const reveal = view.host.querySelector("button:has(.lucide-folder-open)");
			assert.equal(reveal?.getAttribute("aria-label"), label, `${platform} / ${locale}`);
		} finally {
			await view.unmount();
		}
	}
});

function Removal() {
	const removal = useDefinitionRemoval("skill", "/project", () => {});
	return h("div", null, h("button", { "data-test-remove": "", onClick: () => removal.ask("demo", "/project/demo") }, "remove"), removal.element);
}

test("删技能时的确认框，在 Windows 上说回收站", async () => {
	host("win32");
	const view = await show("zh-CN", h(Removal));
	try {
		await click(view.find("[data-test-remove]"));
		const dialog = document.querySelector('[role="dialog"]')?.textContent ?? "";
		assert.ok(dialog.includes("回收站"), dialog);
		assert.ok(!dialog.includes("废纸篓"), dialog);
		assert.ok([...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent === "移入回收站"));
	} finally {
		await view.unmount();
	}
});
