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

import { uniqueProviderName } from "./provider-transfer.ts";
import { translate } from "../../i18n/translate.ts";
import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { applyModelChange, firstChatModelId, type ModelChange } from "./model-sync.ts";
import { useEffect, useMemo, useRef, useState } from "react";
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

	/*
	 * The list, with the provider it came from.
	 *
	 * A listing takes up to fifteen seconds, and the page lets you pick another provider meanwhile. The
	 * bare list used to open over whichever provider was selected when it landed, and applying it wrote
	 * provider A's models into provider B. So the answer carries its question, and one that no longer
	 * matches what is on screen is dropped.
	 */
	const [discovered, setDiscovered] = useState<{ providerId: string; models: string[] } | null>(null);
	const shown = useRef<string | null>(null);
	shown.current = selected?.id ?? null;

	function select(id: string) {
		setSelectedId(id);
		// The old result was about a different endpoint; leaving it up says the wrong thing.
		setTestResult(null);
		setModelTestResults({});
		setFetchModelsError(null);
		setDiscovered(null);
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
			name: uniqueProviderName(
				settings.providers.map((one) => one.name),
				translate("providers.newProvider"),
			),
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
			// The first model configured is what a fresh install will send with — one that can reply.
			defaultModelId: settings.defaultModelId ?? firstChatModelId([model]),
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

	async function fetchModelsFromEndpoint() {
		if (!selected) return;
		const providerId = selected.id;
		setFetchingModels(true);
		setFetchModelsError(null);
		try {
			const res = await bridge.providers.fetchModels(providerId);
			if (shown.current !== providerId) return;
			if (!res.ok) {
				setFetchModelsError(res.error || translate("providers.fetchFailed"));
				return;
			}
			/*
			 * An empty list still opens the dialog. A relay can serve models it does not list (the image
			 * models behind ours are exactly that), and the dialog is where a name can be typed in and
			 * where the configured ones can be removed — an error banner was a dead end on both counts.
			 */
			setDiscovered({ providerId, models: res.models });
		} catch (err) {
			if (shown.current === providerId) setFetchModelsError(err instanceof Error ? err.message : String(err));
		} finally {
			setFetchingModels(false);
		}
	}

	async function applyDiscoveredChange(change: ModelChange) {
		const providerId = discovered?.providerId;
		setDiscovered(null);
		// Read at apply time, not from this render: the dialog may have been open across a save.
		const current = useApp.getState().settings;
		if (!providerId || !current) return;
		const next = applyModelChange(current, providerId, change);
		if (next !== current) await saveSettings(next);
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
		discoveredModels: discovered && discovered.providerId === selected?.id ? discovered.models : null,
		fetchModelsFromEndpoint,
		applyDiscoveredChange,
		closeDiscoveredModal: () => setDiscovered(null),
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
