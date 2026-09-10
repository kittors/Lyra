/**
 * 拉取来的模型，导入之后是什么样。
 *
 * 客户看到的是：弹窗里每一行都写 200K，导进来全变成 1M。两件独立的事凑在一起——弹窗那个数字是
 * 写死的字符串，跟任何数据都没连着；而导入走的是离线目录，`gemini-3.x-flash` 上游确实是 1M。
 *
 * 最容易漏掉的是第三件事：光把导入的数字改成 200K 是不够的。`withCatalogDefaults` 在**每次读**
 * 设置和**每次写**设置时都跑，只要那一行标着 `metadataSource: "catalog"`，它就会拿目录值把上下文
 * 和输出上限覆盖回去。所以这里的往返用例才是真正守住这个修复的那一条。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProviderConfig } from "@lyra/core";
import { withCatalogDefaults } from "@lyra/core/model-catalog";

import {
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_OUTPUT_TOKENS,
	defaultWindowLabel,
	importedModel,
} from "../src/features/settings/model-defaults.ts";

/** 一个中转供应商：主机名不在目录里，模型名却认得出来——这正是客户的情形。 */
const relay: Pick<ProviderConfig, "id" | "baseUrl"> = {
	id: "new-provider",
	baseUrl: "https://relay.example.com/v1",
};

test("目录认得的模型，也按我们的上限导入，而不是上游的", () => {
	// gemini-3.5-flash 在目录里是 1048576 / 65536。认得它是好事，照抄它的窗口不是。
	const model = importedModel(relay, "gemini-3.5-flash-low");
	assert.equal(model.contextWindow, DEFAULT_CONTEXT_WINDOW);
	assert.equal(model.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
});

test("目录不认得的模型，一样是这两个数", () => {
	const model = importedModel(relay, "some-private-model-v9");
	assert.equal(model.contextWindow, DEFAULT_CONTEXT_WINDOW);
	assert.equal(model.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
	assert.equal(model.modelId, "some-private-model-v9");
	assert.equal(model.id, "new-provider/some-private-model-v9");
});

test("存一遍读一遍，200K 还在——这是整个修复的要害", () => {
	const model = importedModel(relay, "gemini-3.5-flash-low");
	// 写设置一次，读设置一次：两处都会跑 withCatalogDefaults。
	const roundTripped = withCatalogDefaults(relay, withCatalogDefaults(relay, model));
	assert.equal(roundTripped.contextWindow, DEFAULT_CONTEXT_WINDOW, "目录把窗口改回去了，等于没改");
	assert.equal(roundTripped.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
});

test("能力位和价格仍然从目录来——那些是目录真的知道的东西", () => {
	const model = importedModel(relay, "gemini-3.5-flash-low");
	assert.equal(model.supportsTools, true, "工具调用默认关掉的话，这个模型在 code agent 里没法用");
	const stored = withCatalogDefaults(relay, model);
	assert.ok(stored.pricing, "价格没了，用量统计就成了一列零");
});

test("弹窗上那行字和导入写进去的是同一个数", () => {
	// 它曾经是一个写死的 "200K"，跟导入毫无关系——两边一起变，才不会再次各说各话。
	assert.equal(defaultWindowLabel(), `${Math.round(DEFAULT_CONTEXT_WINDOW / 1000)}K`);
});
