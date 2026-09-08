import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { BUILTIN_AGENTS, DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";
import { AgentsSettings } from "../../src/features/settings/AgentsSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";
import { I18nProvider } from "../../src/i18n/index.ts";

const model: ModelConfig = { id: "qa/model", modelId: "gpt-5.6-sol", providerId: "qa", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsThinking: true, supportsImages: false, supportsTools: true };
const settings: Settings = { ...DEFAULT_SETTINGS, defaultModelId: model.id, providers: [{ id: "qa", name: "QA", api: "openai-responses", baseUrl: "http://localhost", apiKey: "test", enabled: true, models: [model, { ...model, id: "qa/fast", name: "Fast", supportsThinking: false }] }] };
const capabilities = { agents: [{ name: "explore", source: "builtin", tools: "*", description: "Read" }], skills: [], skillDiagnostics: [], plugins: [], pluginDiagnostics: [], mcp: [], toolNames: [] } satisfies NonNullable<ReturnType<typeof useApp.getState>["capabilities"]>;
function setup(initial: Settings, save: (settings: Settings) => Promise<Settings>) {
	useApp.setState({ activeSessionId: "qa", meta: null, settings: initial, capabilities });
	Object.defineProperty(window, "lyra", { configurable: true, value: { agentDefinitions: { list: async () => ({ records: BUILTIN_AGENTS.map(definition => ({ definition, id: definition.name, scope: "builtin", editable: true, customized: false, revision: "1", raw: "", shadowedSources: [] })), tools: [] }) }, sessions: { capabilities: async () => capabilities }, settings: { save } } });
}
async function choose(text: string) {
	const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith(text));
	assert.ok(item, text); await click(item);
}

test("built-in profiles are configurable before a session exists and while a cold session has no capabilities", async () => {
	for (const sessionId of [null, "cold-session"]) {
		setup(settings, async (next) => next);
		useApp.setState({ activeSessionId: sessionId, capabilities: null });
		Object.defineProperty(window, "lyra", { configurable: true, value: { agentDefinitions: { list: async () => ({ records: BUILTIN_AGENTS.map(definition => ({ definition, id: definition.name, scope: "builtin", editable: true, customized: false, revision: "1", raw: "", shadowedSources: [] })), tools: [] }) }, sessions: { capabilities: async () => null } } });
		const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(AgentsSettings) }));
		try {
			// 名字来自 BUILTIN_AGENTS 本身，而不是抄一份：抄的那份在改名时不会红，只会悄悄少测两个。
			for (const name of BUILTIN_AGENTS.map((agent) => agent.name)) {
				assert.ok(view.host.querySelector(`[data-agent-profile="${name}"]`), `${sessionId}: ${name}`);
				assert.ok(view.host.querySelector(`[aria-label="${name} 模型"]`));
			}
			assert.ok(view.host.querySelector('[aria-label="compact 模型"]'));
			assert.equal(view.host.querySelector('[aria-label="compact 思考等级"]'), null);
		} finally { await view.unmount(); }
	}
});

test("project changes reload the catalogue without reopening settings", async () => {
	setup({ ...settings, projects: [{ id: "project", name: "Project", path: "/qa-project", pinned: false, lastOpenedAt: 0 }] }, async next => next);
	Object.defineProperty(window, "lyra", { configurable: true, value: { agentDefinitions: { list: async (projectId: string | null) => ({ records: [{ definition: { ...BUILTIN_AGENTS[0], description: projectId ? "Project exploration policy" : "Global policy" }, id: "definition", scope: "user", editable: true, customized: false, revision: "1", raw: "", shadowedSources: [] }], tools: [] }) } } });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(AgentsSettings) }));
	try {
		assert.match(view.text(), /Global policy/);
		await act(async () => { useApp.setState({ workspace: { path: "/qa-project", name: "Project", isGitRepo: false, branch: null } }); });
		assert.match(view.text(), /Project exploration policy/);
	} finally { await view.unmount(); useApp.setState({ workspace: null }); }
});

test("switching to a non-reasoning model clears the incompatible saved effort and offers no fake levels", async () => {
	let saved: Settings | undefined;
	setup({ ...settings, subAgentProfiles: { explore: { modelId: model.id, thinking: "ultra" } } }, async (next) => { saved = next; return next; });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(AgentsSettings) }));
	try {
		await click(view.find('[aria-label="explore 模型"]')); await choose("Fast");
		assert.deepEqual(saved?.subAgentProfiles?.explore, { modelId: "qa/fast" });
		assert.match(view.text(), /不支持思考/);
		assert.equal(view.host.querySelector('[aria-label="explore 思考等级"]'), null);
		await click(view.find('[aria-label="explore 模型"]')); await choose("跟随主会话");
		assert.deepEqual(saved?.subAgentProfiles, {});
		assert.ok(view.host.querySelector('[aria-label="explore 思考等级"]'));
	} finally { await view.unmount(); }
});

test("unavailable profiles stay visibly invalid and a failed save preserves the previous setting", async () => {
	setup({ ...settings, subAgentProfiles: { explore: { modelId: "removed/model" } } }, async () => { throw new Error("disk full"); });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(AgentsSettings) }));
	try {
		assert.match(view.text(), /模型不可用/);
		await click(view.find('[aria-label="explore 模型"]')); await choose("QA");
		assert.match(view.find('[role="alert"]').textContent ?? "", /disk full/);
		assert.equal(useApp.getState().settings?.subAgentProfiles?.explore.modelId, "removed/model");
		assert.equal(view.find<HTMLFieldSetElement>("fieldset").disabled, false);
	} finally { await view.unmount(); }
});
