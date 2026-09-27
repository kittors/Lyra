import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { PluginsView } from "../../src/features/plugins/PluginsView.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

/*
 * 扫盘还没回来的时候，市场不能先下结论说「什么都没有」——那是一句还没问完就给出的回答。回来之后
 * 才说：没有配来源，就说没有来源。
 */
test("a local scan cannot report an empty catalogue before it answers", async () => {
	let finish!: (scan: Awaited<ReturnType<LyraApi["plugins"]["list"]>>) => void;
	const scan = new Promise<Awaited<ReturnType<LyraApi["plugins"]["list"]>>>((resolve) => { finish = resolve; });
	Object.defineProperty(window, "lyra", { configurable: true, value: { plugins: { list: () => scan, environment: async () => [] } } });
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, pluginRegistries: [], skillRegistries: [] }, workspace: { path: "/tmp/catalog-loading-test" } as never, pluginFocus: null });
	const view = await mount(h(PluginsView));
	try {
		await click(view.all<HTMLButtonElement>("[data-market] [role=tab]").find((button) => button.textContent?.startsWith("技能"))!);
		assert.doesNotMatch(view.text(), /尚未添加插件市场|市场里暂时是空的/);
		await act(async () => { finish({ plugins: [], mcpBundles: [], skills: [], skillDiagnostics: [], shadowedSkills: [], pluginDiagnostics: [] }); });
		assert.match(view.text(), /尚未添加插件市场/);
	} finally { await view.unmount(); }
});
