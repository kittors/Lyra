import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { BUILTIN_AGENTS, DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import { effortLabel, ModelSelect } from "../../src/features/models/index.ts";
import { AgentsSettings } from "../../src/features/settings/AgentsSettings.tsx";
import { ModelEditor } from "../../src/features/settings/ModelEditor.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { MESSAGE_CATALOGS } from "../../src/i18n/messages/index.ts";

const models = Array.from({ length: 12 }, (_, i) => ({ id: `qa/${i}`, modelId: `model-${i}`, providerId: "qa", name: `Model ${i}`, supportsThinking: true, supportsImages: false, supportsTools: true, contextWindow: 128000, maxOutputTokens: 8192 }));
const settings: Settings = { ...DEFAULT_SETTINGS, providers: [{ id: "qa", name: "QA", api: "openai-responses", apiKey: "test", baseUrl: "http://localhost", enabled: true, models }], defaultModelId: "qa/0", favoriteModelIds: ["qa/9"] };

test("configuration picker shares favourites/search and never selects the active chat model", async () => {
	let chosen = "";
	let chatChanges = 0;
	const original = useApp.getState().setModel;
	useApp.setState({ settings, messages: [{ role: "user", timestamp: 1, content: [{ type: "text", text: "Existing conversation" }] }], setModel: async () => { chatChanges++; } });
	const view = await mount(h(ModelSelect, { ariaLabel: "Test model", value: "qa/0", inheritLabel: "继承", onChange: (id) => { chosen = id; } }));
	try {
		await click(view.find("button"));
		const menu = document.querySelector('[aria-label="选择模型"]'); assert.ok(menu);
		assert.equal(menu.querySelector<HTMLElement>("[data-model]")?.dataset.model, "qa/9");
		assert.doesNotMatch(menu.textContent ?? "", /关闭思考|设为新会话/);
		const search = menu.querySelector("input"); assert.ok(search);
		await fire(search, new Event("focusin", { bubbles: true }));
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
		assert.ok(setter); setter.call(search, "model-11");
		await fire(search, new Event("input", { bubbles: true }));
		assert.equal(menu.querySelectorAll("[data-model]").length, 1);
		const target = menu.querySelector('[data-model="qa/11"] button'); assert.ok(target);
		await click(target);
		assert.equal(chosen, "qa/11"); assert.equal(chatChanges, 0);
		assert.equal(useApp.getState().settings?.defaultModelId, "qa/0");
	} finally { await view.unmount(); useApp.setState({ setModel: original }); }
});

test("a failed role save leaves the explicit unavailable model visible", async () => {
	const original = useApp.getState().saveSettings;
	Object.defineProperty(window, "lyra", { configurable: true, value: { agentDefinitions: { list: async () => ({ records: BUILTIN_AGENTS.map(definition => ({ definition, id: definition.name, scope: "builtin", editable: true, customized: false, revision: "1", raw: "", shadowedSources: [] })), tools: [] }) } } });
	/*
	 * 给一个具体的智能体钉死一个不存在的模型，而不是借道同名的模型角色。
	 *
	 * 这条原来写的是 `modelRoles: { fast: … }`，靠的是「智能体 `fast`」和「模型角色 `fast`」恰好同名
	 * ——`agentProfile` 会把同名角色的旧绑定当成这个智能体的配置。智能体改叫 `simple` 之后那层巧合
	 * 没了，而这条要测的从来不是巧合，是「显式选了一个用不了的模型，保存又失败时，界面还得照实说」。
	 * 旧名下的配置能不能被新名读到，是 core 的 `agent-rename` 在管。
	 */
	const agent = BUILTIN_AGENTS.find((definition) => definition.model === "@fast");
	assert.ok(agent, "应该有一个内置智能体跟着 @fast 角色走");
	useApp.setState({ activeSessionId: null, capabilities: null, settings: { ...settings, subAgentProfiles: { [agent.name]: { modelId: "missing/model" } } }, saveSettings: async () => { throw new Error("disk full"); } });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(AgentsSettings) }));
	try {
		const trigger = view.find(`[aria-label="${agent.name} 模型"]`);
		assert.match(trigger.textContent ?? "", /模型不可用/);
		await click(trigger);
		const target = document.querySelector('[data-model="qa/9"] button'); assert.ok(target); await click(target);
		assert.match(view.find('[role="alert"]').textContent ?? "", /disk full/);
		assert.equal(useApp.getState().settings?.subAgentProfiles?.[agent.name]?.modelId, "missing/model");
	} finally { await view.unmount(); useApp.setState({ saveSettings: original }); }
});

test("editing a model retains its explicit thinking capabilities and unrelated protocol settings", async () => {
	assert.equal(effortLabel("medium", models[0], (key) => MESSAGE_CATALOGS.en[key]), "Medium");
	assert.equal(effortLabel("ultra", { ...models[0], thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "" }] }), "自适应");
	assert.equal(effortLabel("ultra", { ...models[0], thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "" }] }, (key) => MESSAGE_CATALOGS.en[key]), "自适应");
	assert.equal(effortLabel("off", { ...models[0], thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "" }] }), "关闭");
	const model = { ...models[0], supportsTools: false, thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "Provider-defined", budgetTokens: 4096 }], samplingParams: { top_p: 0.9 } };
	let saved: typeof models[number] | undefined;
	const view = await mount(h(ModelEditor, { model, provider: { id: "qa", baseUrl: "http://localhost" }, onSave: (next) => { saved = next; }, onCancel: () => {} }));
	try {
		const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "保存"); assert.ok(save);
		await click(save);
		// The real dialog commits on its exit animation; happy-dom has no animation clock.
		const overlay = document.querySelector("[data-ly-modal]");
		if (overlay) await fire(overlay, new Event("animationend", { bubbles: true }));
		assert.deepEqual(saved, { ...model, id: "qa/model-0", pricing: undefined, catalogRef: undefined, metadataSource: "manual" });
	} finally { await view.unmount(); }
});
