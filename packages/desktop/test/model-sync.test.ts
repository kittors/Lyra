/**
 * 拉取弹窗决定的事：哪些留下、哪些加进来、哪些拿掉，以及拿掉之后默认模型指向哪里。
 *
 * 弹窗原来只会「导入」：已经加过的灰掉不能动，接口没列出的名字加不进去，列出的全加过之后就
 * 成了一个只能点取消的死胡同。现在勾选框表示「应用之后它在不在列表里」，这里守的是那几条
 * 容易在调用处写错的规则——尤其是默认模型：生图模型也是模型，但它不能成为对话的默认模型。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";

import {
	applyModelChange,
	changeOf,
	cleanModelIds,
	firstChatModelId,
	isNewModelName,
	rowMatches,
	syncRows,
} from "../src/features/settings/model-sync.ts";

const model = (modelId: string, extra: Partial<ModelConfig> = {}): ModelConfig => ({
	id: `relay/${modelId}`,
	providerId: "relay",
	modelId,
	name: modelId,
	contextWindow: 200_000,
	maxOutputTokens: 65_536,
	supportsThinking: true,
	supportsImages: true,
	supportsTools: true,
	...extra,
});

const settingsWith = (models: ModelConfig[], extra: Partial<Settings> = {}): Settings => ({
	...DEFAULT_SETTINGS,
	providers: [{ id: "relay", name: "Relay", baseUrl: "https://relay.example", api: "openai-responses", apiKey: "k", enabled: true, models }],
	defaultModelId: models[0]?.id ?? null,
	...extra,
});

test("接口重复列出、带空白的名字，只剩一行", () => {
	assert.deepEqual(cleanModelIds([" gemini-a ", "gemini-a", "", "  ", "gemini-b"]), ["gemini-a", "gemini-b"]);
});

test("已有的按原顺序在上面，可添加的在下面；手动输入的排在可添加的最前面", () => {
	const rows = syncRows(["b", "a", "c"], [model("c"), model("x")], ["typed-1", "typed-2"]);
	assert.deepEqual(rows.configured.map((row) => row.modelId), ["c", "x"]);
	assert.deepEqual(rows.available.map((row) => row.modelId), ["typed-2", "typed-1", "b", "a"]);
	// 已有但这次没被列出的，要能看出来——不然下线的模型永远清不掉。
	assert.equal(rows.configured.find((row) => row.modelId === "x")?.listed, false);
	assert.equal(rows.configured.find((row) => row.modelId === "c")?.listed, true);
});

test("手动输入一个已经列出或已有的名字，不会多出第二行", () => {
	const rows = syncRows(["a"], [model("b")], ["a", "b", "c"]);
	assert.deepEqual([...rows.configured, ...rows.available].map((row) => row.modelId).sort(), ["a", "b", "c"]);
});

test("什么都不动：已有的全留下，列出的全加进来——和原来的导入一样一键完成", () => {
	const rows = syncRows(["a", "b", "img"], [model("a")], []);
	assert.deepEqual(changeOf(rows, new Set()), { add: ["b", "img"], remove: [] });
});

test("取消勾选已有的就是移除，取消勾选可添加的就是不加", () => {
	const rows = syncRows(["a", "b"], [model("a"), model("old")], []);
	assert.deepEqual(changeOf(rows, new Set(["old", "b"])), { add: [], remove: ["old"] });
});

test("全都加过了：默认没有任何改动——不再是一个只能点取消的死胡同，但也不会自己动手", () => {
	const rows = syncRows(["a", "b"], [model("a"), model("b")], []);
	assert.deepEqual(changeOf(rows, new Set()), { add: [], remove: [] });
	assert.equal(rows.available.length, 0);
});

test("大小写不同的名字算同一个，不提供「添加」", () => {
	const rows = syncRows(["gpt-4o"], [], []);
	assert.equal(isNewModelName("GPT-4o", rows), false);
	assert.equal(isNewModelName("  gemini-3.1-flash-image ", rows), true);
	assert.equal(isNewModelName("   ", rows), false);
});

test("搜索框说的「厂商」是真的：google 能搜到 gemini", () => {
	const [row] = syncRows(["gemini-3.8-flash-high"], [], []).available;
	assert.equal(rowMatches(row, "google"), true);
	assert.equal(rowMatches(row, "8-flash"), true);
	assert.equal(rowMatches(row, "claude"), false);
	assert.equal(rowMatches(row, ""), true);
});

test("加进来的模型用导入的默认值，已有的配置原样保留、顺序不变", () => {
	const kept = model("a", { name: "我的别名", contextWindow: 1_000_000 });
	const next = applyModelChange(settingsWith([kept, model("b")]), "relay", { add: ["c"], remove: ["b"] });
	const models = next.providers[0].models;
	assert.deepEqual(models.map((one) => one.modelId), ["a", "c"]);
	assert.equal(models[0], kept, "已有模型的自定义配置被重建了");
	assert.equal(models[1].id, "relay/c");
	assert.equal(models[1].metadataSource, "manual");
});

test("没有改动时返回同一个对象，不触发保存", () => {
	const settings = settingsWith([model("a")]);
	assert.equal(applyModelChange(settings, "relay", { add: ["a"], remove: [] }), settings);
	assert.equal(applyModelChange(settings, "missing", { add: ["b"], remove: [] }), settings);
});

test("移除默认模型：默认模型清空，有新加的能对话的模型就用它", () => {
	const settings = settingsWith([model("a"), model("b")], { defaultModelId: "relay/a" });
	assert.equal(applyModelChange(settings, "relay", { add: [], remove: ["a"] }).defaultModelId, null);
	assert.equal(applyModelChange(settings, "relay", { add: ["c"], remove: ["a"] }).defaultModelId, "relay/c");
	assert.equal(applyModelChange(settings, "relay", { add: [], remove: ["b"] }).defaultModelId, "relay/a");
});

test("生图模型不会成为对话的默认模型", () => {
	const empty = settingsWith([], { defaultModelId: null });
	const next = applyModelChange(empty, "relay", { add: ["gemini-3.1-flash-image", "gemini-3.8-flash-high"], remove: [] });
	assert.equal(next.defaultModelId, "relay/gemini-3.8-flash-high");
	const onlyImage = applyModelChange(empty, "relay", { add: ["gemini-3.1-flash-image"], remove: [] });
	assert.equal(onlyImage.defaultModelId, null);
	assert.equal(firstChatModelId([model("x-image", { imageOutput: true })]), null);
});

test("移除默认的生图模型，生图默认值一起清掉；别的不动", () => {
	const image = model("gemini-3.1-flash-image");
	const settings = settingsWith([model("a"), image], { imageModelId: image.id });
	assert.equal(applyModelChange(settings, "relay", { add: [], remove: ["gemini-3.1-flash-image"] }).imageModelId, null);
	assert.equal(applyModelChange(settings, "relay", { add: [], remove: ["a"] }).imageModelId, image.id);
});
