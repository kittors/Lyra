/**
 * 拉取到一半换了供应商：A 的列表不能开在 B 上，更不能写进 B。
 *
 * 拉取最多等 15 秒，这期间左边的供应商列表照样能点。以前结果回来时只看「现在选中的是谁」，于是
 * A 拉回来的模型开在 B 的弹窗里，一点「导入」就进了 B 的列表——两个中转的模型名常常一样，看不出
 * 来是错的，要到对话报 404 才知道。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";

import { I18nProvider } from "../../src/i18n/index.ts";
import { ModelSettings } from "../../src/features/settings/ModelSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

const model = (providerId: string, modelId: string): ModelConfig => ({
	id: `${providerId}/${modelId}`,
	providerId,
	modelId,
	name: modelId,
	contextWindow: 200_000,
	maxOutputTokens: 65_536,
	supportsThinking: true,
	supportsImages: true,
	supportsTools: true,
});

const settings: Settings = {
	...DEFAULT_SETTINGS,
	providers: [
		{ id: "a", name: "中转甲", baseUrl: "https://a.example", api: "openai-responses", apiKey: "k", enabled: true, models: [model("a", "alpha")] },
		{ id: "b", name: "中转乙", baseUrl: "https://b.example", api: "openai-responses", apiKey: "k", enabled: true, models: [model("b", "beta")] },
	],
	defaultModelId: "a/alpha",
};

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

test("拉取 A 的途中换到 B：A 的列表回来时不打开弹窗，B 的列表没被动过", async () => {
	let answer!: (value: { ok: boolean; models: string[] }) => void;
	const saved: Settings[] = [];
	useApp.setState({ settings, activeSessionId: null, meta: null, capabilities: null });
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			settings: { save: async (next: Settings) => { saved.push(next); return next; } },
			providers: { fetchModels: () => new Promise((resolve) => { answer = resolve; }) },
		},
	});
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(ModelSettings) }));
	try {
		const fetch = view.all<HTMLButtonElement>("button").find((button) => button.textContent?.trim() === "拉取模型");
		assert.ok(fetch, "没找到「拉取模型」");
		await click(fetch);
		const other = view.all<HTMLButtonElement>("button").find((button) => button.textContent?.includes("中转乙"));
		assert.ok(other, "没找到第二个供应商");
		await click(other);
		await act(async () => answer({ ok: true, models: ["alpha", "gamma"] }));
		await settle();
		assert.ok(!document.querySelector("[data-ly-fetch-row]"), "A 的列表开在了 B 上");
		assert.equal(saved.length, 0, "什么都没点，设置却被写了");
	} finally {
		await view.unmount();
	}
});
