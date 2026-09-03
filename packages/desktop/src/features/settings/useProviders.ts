/**
 * Editing the provider list, as operations rather than as state.
 *
 * Every one of these is "read the settings, produce the next settings, save" — and each has a
 * consequence that is easy to forget at the call site: removing a provider can orphan the default
 * model, removing that model has to clear it, and adding the first model should become the default
 * so a fresh install can send a message without a second trip to this page.
 *
 * Keeping them together is what makes those rules checkable in one place. The page above is then
 * only a layout.
 */

import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { useEffect, useMemo, useState } from "react";
import type { ProviderTestResult } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

export function useProviders() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const providers = useMemo(() => settings?.providers ?? [], [settings]);

	const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
	const [testingModelId, setTestingModelId] = useState<string | null>(null);
	const [modelTestResults, setModelTestResults] = useState<Record<string, ProviderTestResult>>({});
	const [fetchingModels, setFetchingModels] = useState(false);
	const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

	const selected = useMemo(
		() => providers.find((p) => p.id === selectedId) ?? providers[0] ?? null,
		[providers, selectedId],
	);

	useEffect(() => {
		if (!selected && providers.length > 0) setSelectedId(providers[0].id);
	}, [providers, selected]);

	function select(id: string) {
		setSelectedId(id);
		// The old result was about a different endpoint; leaving it up says the wrong thing.
		setTestResult(null);
		setModelTestResults({});
		setFetchModelsError(null);
	}

	async function update(id: string, patch: Partial<ProviderConfig>) {
		if (!settings) return;
		await saveSettings({
			...settings,
			providers: settings.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
		});
	}

	async function add() {
		if (!settings) return;
		const id = `provider-${Date.now().toString(36)}`;
		const provider: ProviderConfig = {
			id,
			name: "新供应商",
			baseUrl: "https://",
			api: "openai-responses",
			apiKey: "",
			enabled: true,
			models: [],
		};
		await saveSettings({ ...settings, providers: [...settings.providers, provider] });
		select(id);
	}

	async function remove(id: string) {
		if (!settings) return;
		const remaining = settings.providers.filter((p) => p.id !== id);
		// A model from the removed provider must not stay selected as the default.
		const defaultStillValid = remaining.some((p) => p.models.some((m) => m.id === settings.defaultModelId));
		await saveSettings({
			...settings,
			providers: remaining,
			defaultModelId: defaultStillValid ? settings.defaultModelId : (remaining[0]?.models[0]?.id ?? null),
		});
		setSelectedId(remaining[0]?.id ?? null);
	}

	async function saveModel(providerId: string, model: ModelConfig, original: ModelConfig | null) {
		if (!settings) return;
		await saveSettings({
			...settings,
			providers: settings.providers.map((p) =>
				p.id !== providerId
					? p
					: {
							...p,
							models: original ? p.models.map((m) => (m.id === original.id ? model : m)) : [...p.models, model],
						},
			),
			// The first model configured is what a fresh install will send with.
			defaultModelId: settings.defaultModelId ?? model.id,
		});
	}

	async function removeModel(providerId: string, modelId: string) {
		if (!settings) return;
		await saveSettings({
			...settings,
			providers: settings.providers.map((p) =>
				p.id !== providerId ? p : { ...p, models: p.models.filter((m) => m.id !== modelId) },
			),
			defaultModelId: settings.defaultModelId === modelId ? null : settings.defaultModelId,
		});
	}

	async function setDefaultModel(modelId: string) {
		if (!settings) return;
		await saveSettings({ ...settings, defaultModelId: modelId });
	}

	async function test(modelId?: string) {
		if (!selected) return;
		if (modelId) {
			setTestingModelId(modelId);
			try {
				const res = await bridge.providers.test(selected.id, modelId);
				setModelTestResults((prev) => ({ ...prev, [modelId]: res }));
			} finally {
				setTestingModelId(null);
			}
		} else {
			setTesting(true);
			setTestResult(null);
			try {
				setTestResult(await bridge.providers.test(selected.id));
			} finally {
				setTesting(false);
			}
		}
	}

	const [discoveredModels, setDiscoveredModels] = useState<string[] | null>(null);

	async function fetchModelsFromEndpoint() {
		if (!selected) return;
		setFetchingModels(true);
		setFetchModelsError(null);
		try {
			const res = await bridge.providers.fetchModels(selected.id);
			if (!res.ok) {
				setFetchModelsError(res.error || "获取模型列表失败");
				return;
			}
			if (res.models.length === 0) {
				setFetchModelsError("该端点未返回任何模型");
				return;
			}

			setDiscoveredModels(res.models);
		} catch (err) {
			setFetchModelsError(err instanceof Error ? err.message : String(err));
		} finally {
			setFetchingModels(false);
		}
	}

	async function importDiscoveredModels(modelIds: string[]) {
		if (!selected || !settings) return;
		const existingIds = new Set(selected.models.map((m) => m.modelId));
		const newModels: ModelConfig[] = modelIds
			.filter((mId) => !existingIds.has(mId))
			.map((mId) => ({
				id: `${selected.id}/${mId}`,
				providerId: selected.id,
				modelId: mId,
				name: mId,
				contextWindow: 200_000,
				maxOutputTokens: 16_384,
				supportsThinking: true,
				supportsImages: true,
				supportsTools: true,
			}));

		if (newModels.length > 0) {
			await saveSettings({
				...settings,
				providers: settings.providers.map((p) =>
					p.id === selected.id ? { ...p, models: [...p.models, ...newModels] } : p,
				),
				defaultModelId: settings.defaultModelId ?? newModels[0]?.id ?? null,
			});
		}
		setDiscoveredModels(null);
	}

	return {
		providers,
		selected,
		defaultModelId: settings?.defaultModelId ?? null,
		testing,
		testResult,
		testingModelId,
		modelTestResults,
		fetchingModels,
		fetchModelsError,
		discoveredModels,
		fetchModelsFromEndpoint,
		importDiscoveredModels,
		closeDiscoveredModal: () => setDiscoveredModels(null),
		select,
		add,
		update,
		remove,
		saveModel,
		removeModel,
		setDefaultModel,
		test,
	};
}
