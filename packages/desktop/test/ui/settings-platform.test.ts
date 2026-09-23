/**
 * 设置页上只对某个系统成立的东西，要按这台机器是什么系统来画。
 *
 * 这几条钉的都是「在 Windows / Linux 上看到了只属于 macOS 的东西」：一个在那边什么都不改的开关，
 * 以及第一帧先按 macOS 画、等 IPC 回来再改口的那一跳。
 */

import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { createElement as h, type ComponentType } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";

import { AboutSettings } from "../../src/features/settings/AboutSettings.tsx";
import { AccessSettings } from "../../src/features/settings/AccessSettings.tsx";
import { AppearanceSettings } from "../../src/features/settings/AppearanceSettings.tsx";
import { GeneralSettings } from "../../src/features/settings/GeneralSettings.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

function withPlatform(platform: string, extra: Record<string, unknown> = {}) {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform, ...extra } });
}

/**
 * Mount, look, and always unmount.
 *
 * A failed assertion that skips the unmount leaves these pages mounted, and something inside them
 * keeps the event loop alive: the file then never finishes and never says which test broke.
 */
async function look(page: ComponentType, check: (view: Mounted) => void) {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(page) }));
	try {
		check(view);
	} finally {
		await view.unmount();
	}
}

beforeEach(() => {
	useApp.setState({
		settings: DEFAULT_SETTINGS,
		saveSettings: async (next: Settings) => {
			useApp.setState({ settings: next });
		},
	} as never);
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
});

/*
 * 关于页一挂上就开始每 6 小时查一次更新，而且那个定时器刻意从不停（见 `features/update/store.ts`
 * 的 `start`）。窗口里这是对的；在这里它会让整个文件跑完了也不退出。每个测试文件是单独的进程，
 * 收尾时把这扇窗的定时器全部作废，碰不到别的文件。
 */
after(() => (window as unknown as { happyDOM: { abort(): Promise<void> } }).happyDOM.abort());

test("字体平滑只在 macOS 上出现：-webkit-font-smoothing 在别的系统上什么都不改", async () => {
	for (const platform of ["win32", "linux"]) {
		withPlatform(platform);
		await look(AppearanceSettings, (view) => {
			assert.ok(!view.text().includes("字体平滑"), `${platform} 上不该出现字体平滑开关`);
			// 同一张卡片里的其余几行还在——藏的是那一行，不是整块。
			assert.ok(view.text().includes("恢复默认"));
		});
	}

	withPlatform("darwin");
	await look(AppearanceSettings, (view) => assert.ok(view.text().includes("字体平滑")));
});

/*
 * 平台从 preload 同步读，不等 IPC。
 *
 * 这里的 `system.platform()` 故意永远不回来：只要还有哪一页在等它，第一帧画的就是初值
 * "darwin"——Windows 上先亮出一颗其实开不了的断网开关、关于页先写着 darwin，回包之后才改口。
 */
const neverAnswers = () => new Promise<string>(() => {});

function windowsHost() {
	withPlatform("win32", {
		system: { platform: neverAnswers, openTargets: async () => [], openExternal: async () => {} },
		settings: { layers: async () => null },
		updates: { state: async () => ({ kind: "idle" }), onProgress: () => () => {} },
	});
}

test("权限页第一帧就按 Windows 画：断网开关不出现，换成那句为什么", async () => {
	windowsHost();
	await look(AccessSettings, (view) => {
		assert.ok(view.text().includes("断不了网"), "Windows 上应直接说明断网做不到");
		assert.ok(!view.host.querySelector('[aria-label="禁止命令联网"]'), "Windows 上不该先画出断网开关");
	});
});

test("关于页与通用页第一帧写的就是这台机器的平台", async () => {
	windowsHost();
	for (const page of [AboutSettings, GeneralSettings]) {
		await look(page, (view) => {
			assert.ok(view.text().includes("win32"), `${page.name} 第一帧应写 win32`);
			assert.ok(!view.text().includes("darwin"));
		});
	}
});
