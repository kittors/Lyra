/**
 * Grok's levels as a person sees them: the effort menu, the composer's button, the "no thinking" line.
 *
 * Every Grok model used to get the fallback 关/低/中/高: Grok 4.7 had no 超高, said 中 where xAI runs
 * high, and offered a 「关」 its API rejects. Grok 4.20 and Grok Build take no effort at all; their
 * one level is 「自动」, and the switch that turns reasoning off says it changes nothing there.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type ModelConfig, type SessionMeta, type Settings, type ThinkingLevel } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { EffortMenu } from "../../src/features/models/EffortMenu.tsx";
import { EffortTrigger } from "../../src/features/models/EffortTrigger.tsx";
import { ModelMenu } from "../../src/features/models/ModelMenu.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const grokModel = (modelId: string): ModelConfig => ({
	id: `xai/${modelId}`, providerId: "xai", modelId, name: modelId, contextWindow: 500_000, maxOutputTokens: 128_000, supportsThinking: true, supportsImages: true, supportsTools: true,
});
const g47 = grokModel("grok-4.7");
const g43 = grokModel("grok-4.3");
const g420 = grokModel("grok-4.20-0309-reasoning");
const settings: Settings = {
	...DEFAULT_SETTINGS,
	providers: [{ id: "xai", name: "xAI", api: "openai-responses", apiKey: "test", baseUrl: "http://localhost", enabled: true, models: [g47, g43, g420] }],
	defaultModelId: g47.id,
	thinking: "medium",
};

let previous: AppState;
let view: Mounted | undefined;

function onStage(model: ModelConfig, thinking: ThinkingLevel): void {
	const meta: SessionMeta = { id: "a", title: "a", cwd: "/work/a", projectId: "a", projectName: "a", createdAt: 1, updatedAt: 2, modelId: model.id, messageCount: 0, seq: 1, usage, thinking };
	useApp.setState({ activeSessionId: "a", pendingSessionId: null, meta, messages: [], sessions: [meta], sessionCache: {}, settings });
}

function show(body: ReturnType<typeof h>): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: "a" }, body) }));
}

/** The level names in the menu's help list, in order — kept mounted while folded. */
function listedLevels(): string[] {
	const list = document.querySelector(".ly-reveal");
	assert.ok(list, "no level list in the effort menu");
	return [...list.querySelectorAll(".flex.gap-2 > span:first-child")].map((one) => one.textContent ?? "");
}

const slider = () => document.querySelector<HTMLInputElement>('input[type="range"]');
const menu = () => h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} });

beforeEach(() => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: { agent: { setThinking: async () => {}, setModel: async () => {} } } });
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

test("Grok 4.7 的推理菜单是低/中/高/超高，没有它关不掉的「关」", async () => {
	onStage(g47, "xhigh");
	view = await show(menu());
	assert.deepEqual(listedLevels(), ["低", "中", "高", "超高"]);
	assert.equal(slider()?.max, "3");
	assert.equal(slider()?.value, "3", "「超高」 is the last stop");
});

test("存着「最高」或「关」的会话换到 Grok 4.7：按钮说的是实际发出去的超高和低", async () => {
	onStage(g47, "max");
	view = await show(h(EffortTrigger, { modelId: g47.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：超高");
	await view.unmount();
	onStage(g47, "off");
	view = await show(h(EffortTrigger, { modelId: g47.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：低");
});

test("能关推理的 Grok 4.3 上，「关」照旧是「关」", async () => {
	onStage(g43, "off");
	view = await show(h(EffortTrigger, { modelId: g43.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：关");
	await view.unmount();
	view = await show(menu());
	assert.deepEqual(listedLevels(), ["关", "低", "中", "高", "超高"]);
});

test("没有档位的 Grok 4.20：按钮和菜单都写「自动」，滑块按不动", async () => {
	onStage(g420, "high");
	view = await show(h(EffortTrigger, { modelId: g420.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：自动", "not 关, though nothing is named");
	await view.unmount();
	view = await show(menu());
	assert.deepEqual(listedLevels(), ["自动"]);
	assert.ok(slider()?.disabled, "one level, nothing to move to");
	assert.ok(document.body.textContent?.includes("这个模型总会推理"), "the line under the slider says why");
	assert.ok(!document.body.textContent?.includes("不支持"), "it reasons; 「不支持」 would say it does not");
});

test("模型菜单里「关闭思考」那一行：Grok 4.7 落到「低」，Grok 4.20 说关不掉也调不了", async () => {
	onStage(g47, "off");
	view = await show(h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.ok(document.body.textContent?.includes("关不掉推理，会用最低档「低」"));
	await view.unmount();
	onStage(g420, "off");
	view = await show(h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.ok(document.body.textContent?.includes("关不掉推理，想多久由模型自己定"));
	assert.ok(!document.body.textContent?.includes("跳过推理直接作答"), "the switch promises nothing it cannot do");
});
