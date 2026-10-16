/**
 * The effort menu, the composer's effort button and the "no thinking" switch on a GPT model.
 *
 * GPT-6.1 Sol had no rule of its own and was drawn with the fallback's four levels: 关/低/中/高,
 * with `xhigh` and `max` nowhere, and a 「关」 that sends `none` — which its API rejects. Its own
 * ladder is 低/中/高/超高/最高, and turning thinking off on it runs 低. These read what a person
 * sees: the levels listed, where the slider stands, the word on the button, the switch's line.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type ModelConfig, type SessionMeta, type Settings, type ThinkingLevel } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { EffortMenu } from "../../src/features/models/EffortMenu.tsx";
import { EffortTrigger } from "../../src/features/models/EffortTrigger.tsx";
import { ModelMenu } from "../../src/features/models/ModelMenu.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { fire, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const gptModel = (modelId: string): ModelConfig => ({
	id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId, contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsThinking: true, supportsImages: true, supportsTools: true,
});
const sol = gptModel("gpt-6.1-sol");
const luna = gptModel("gpt-5.6-luna");
const settings: Settings = {
	...DEFAULT_SETTINGS,
	providers: [{ id: "relay", name: "中转", api: "openai-responses", apiKey: "test", baseUrl: "http://localhost", enabled: true, models: [sol, luna] }],
	defaultModelId: sol.id,
	thinking: "medium",
};

let previous: AppState;
let view: Mounted | undefined;

/** Puts one conversation on stage, on `model`, at `thinking`. */
function onStage(model: ModelConfig, thinking: ThinkingLevel): void {
	const meta: SessionMeta = { id: "a", title: "a", cwd: "/work/a", projectId: "a", projectName: "a", createdAt: 1, updatedAt: 2, modelId: model.id, messageCount: 0, seq: 1, usage, thinking };
	useApp.setState({ activeSessionId: "a", pendingSessionId: null, meta, messages: [], sessions: [meta], sessionCache: {}, settings });
}

function show(body: ReturnType<typeof h>): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: "a" }, body) }));
}

/** The level names in the menu's help list, in order — kept mounted while folded, so readable without opening it. */
function listedLevels(): string[] {
	const list = document.querySelector(".ly-reveal");
	assert.ok(list, "no level list in the effort menu");
	return [...list.querySelectorAll(".flex.gap-2 > span:first-child")].map((one) => one.textContent ?? "");
}

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

test("GPT-6.1 Sol 的推理菜单是它自己那五档，最高一档是「最高」", async () => {
	onStage(sol, "max");
	view = await show(h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.deepEqual(listedLevels(), ["低", "中", "高", "超高", "最高"]);
	const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
	assert.ok(slider, "no effort slider");
	assert.equal(slider.max, "4");
	assert.equal(slider.value, "4", "「最高」 is the last stop");
});

test("关思考的会话在 GPT-6.1 Sol 上落在「低」：滑块、标题和输入框按钮说的是同一件事", async () => {
	onStage(sol, "off");
	view = await show(h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
	assert.equal(slider?.value, "0", "the slider stands on 低, the level sent");
	assert.ok(!listedLevels().includes("关"), "a 「关」 this model cannot honour");
	await view.unmount();
	view = await show(h(EffortTrigger, { modelId: sol.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：低");
});

test("能关推理的 GPT-5.6 上，「关」照旧是「关」", async () => {
	onStage(luna, "off");
	view = await show(h(EffortTrigger, { modelId: luna.id }));
	assert.equal(view.find("button").getAttribute("aria-label"), "推理强度：关");
	await view.unmount();
	view = await show(h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.deepEqual(listedLevels(), ["关", "低", "中", "高", "超高", "最高"]);
});

test("新对话页上挪滑块，档位和「上次的档位」一次存好，不会被第二次保存冲回去", async () => {
	/*
	 * Measured in a real window: on the blank screen, moving from 最高 to 超高 left the button at 最高.
	 * The menu saved the level, then `lastThinking` beside it from the settings it was drawn with, and
	 * the second save — still carrying 最高 — landed last. The stand-in resolves in call order, as IPC does.
	 */
	const saves: Settings[] = [];
	useApp.setState({
		activeSessionId: null, pendingSessionId: null, meta: null, messages: [], sessions: [], sessionCache: {},
		settings: { ...settings, thinking: "max", lastThinking: "max" },
		saveSettings: async (next: Settings) => {
			saves.push(next);
			await new Promise((resolve) => setTimeout(resolve, 20));
			useApp.setState({ settings: next });
		},
	});
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: null }, h(EffortMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} })) }));
	const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
	assert.ok(slider, "no effort slider");
	assert.equal(slider.value, "4", "starts on 最高");
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "3");
	await fire(slider, new Event("input", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 120));
	await act(async () => {});
	assert.equal(useApp.getState().settings?.thinking, "xhigh", "the level went back to what it was before the press");
	assert.equal(useApp.getState().settings?.lastThinking, "xhigh");
	assert.equal(saves.length, 1, "one press, one save");
});

test("关不掉推理的模型上，「关闭思考」那一行说明它实际用的是哪一档", async () => {
	onStage(sol, "off");
	view = await show(h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.ok(document.body.textContent?.includes("关不掉推理，会用最低档「低」"), "the switch promises an answer without reasoning");
	await view.unmount();
	onStage(luna, "off");
	view = await show(h(ModelMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} }));
	assert.ok(document.body.textContent?.includes("跳过推理直接作答"), "a model that can stop reasoning keeps the usual line");
	assert.ok(!document.body.textContent?.includes("关不掉推理"));
});
