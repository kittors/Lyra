/**
 * Which model is whose.
 *
 * One relay can serve models from five houses, and two providers can serve the same model under
 * the same name with different keys, different endpoints and different context windows. The menu
 * used to draw one flat list of names, so 「grok-4.6」 appeared twice, identically, and picking
 * either was a coin toss — the fact that told them apart was in a `title` attribute nobody hovers.
 *
 * The arithmetic lives here, away from the drawing, because "which rows are ambiguous" and "what
 * does the search match" are rules, and a rule that is only expressed as JSX cannot be tested.
 */

import type { ModelConfig, ProviderConfig, Settings } from "@lyra/core";

export interface ModelGroup {
	provider: ProviderConfig;
	models: ModelConfig[];
}

/** One row of the menu, in the order it is drawn. */
export interface ModelRow {
	provider: ProviderConfig;
	model: ModelConfig;
}

/**
 * Enabled providers that actually have models, in the order they are configured.
 *
 * Deliberately not sorted by "most recently used" or with the current provider hoisted: the list
 * is a place people learn positions in, and one that rearranges itself under the pointer costs
 * more than the row it saves. A provider with no models is left out — a heading over nothing is a
 * heading that reads as a failed load.
 */
export function groupModels(providers: ProviderConfig[] | undefined): ModelGroup[] {
	return (providers ?? [])
		.filter((provider) => provider.enabled && provider.models.length > 0)
		.map((provider) => ({ provider, models: provider.models }));
}

/** Every row, in drawing order — what the number keys count through. */
export function flattenGroups(groups: ModelGroup[]): ModelRow[] {
	return groups.flatMap((group) => group.models.map((model) => ({ provider: group.provider, model })));
}

/**
 * The starred models, in the order they were starred.
 *
 * Not in provider order: the shortlist is a list somebody built by hand, and re-sorting it by
 * anything else would move rows they put where they wanted them. Ids that no longer resolve —
 * a provider switched off, a model deleted — are skipped rather than drawn as a dead row.
 */
export function favouriteRows(groups: ModelGroup[], favourites: string[] | undefined): ModelRow[] {
	if (!favourites?.length) return [];
	const byId = new Map(flattenGroups(groups).map((row) => [row.model.id, row]));
	const rows: ModelRow[] = [];
	for (const id of favourites) {
		const row = byId.get(id);
		if (row) rows.push(row);
	}
	return rows;
}

/**
 * Add or remove a star, keeping the order stable.
 *
 * Appended rather than prepended: a shortlist that reorders itself every time you star something
 * is one you have to re-read each time you open it.
 */
export function toggleFavourite(favourites: string[] | undefined, id: string): string[] {
	const current = favourites ?? [];
	return current.includes(id) ? current.filter((each) => each !== id) : [...current, id];
}

/**
 * The groups that match a query, keeping a group only for the rows that matched.
 *
 * Matches the provider's name as well as the model's, so typing a house name narrows to that
 * house — which is the search anyone with four relays configured actually performs. Case- and
 * space-insensitive because model ids are written every which way (`GLM-5.3`, `glm 5.3`).
 */
export function filterGroups(groups: ModelGroup[], query: string): ModelGroup[] {
	const needle = query.trim().toLowerCase().replace(/[\s_-]/g, "");
	if (!needle) return groups;
	const hit = (text: string) => text.toLowerCase().replace(/[\s_-]/g, "").includes(needle);

	return groups
		.map((group) => ({
			provider: group.provider,
			models: hit(group.provider.name)
				? group.models
				: group.models.filter((model) => hit(model.name) || hit(model.modelId)),
		}))
		.filter((group) => group.models.length > 0);
}

/**
 * Model names that more than one provider offers.
 *
 * Compared on the displayed name rather than on `modelId`, because the confusion is entirely
 * visual: two rows reading `grok-4.6` are indistinguishable whatever their wire ids are, and two
 * rows reading `Grok 4.6 (fast)` and `grok-4.6` are not, even when the wire id is identical.
 */
export function ambiguousNames(groups: ModelGroup[]): Set<string> {
	const seen = new Map<string, string>();
	const clashes = new Set<string>();
	for (const group of groups) {
		for (const model of group.models) {
			const key = model.name.trim().toLowerCase();
			const owner = seen.get(key);
			if (owner === undefined) seen.set(key, group.provider.id);
			else if (owner !== group.provider.id) clashes.add(key);
		}
	}
	return clashes;
}

/**
 * What the composer says it is running, and whether that is enough to identify it.
 *
 * `provider` is always known; `ambiguous` is what decides whether it has to be shown. Naming the
 * house on every chip would be honest and unreadable — the composer strip has room for one short
 * label — so it appears exactly when the model name alone would be a lie by omission.
 */
export function modelIdentity(
	settings: Settings | null,
	modelId: string | null | undefined,
): { model: ModelConfig; provider: ProviderConfig; ambiguous: boolean } | null {
	if (!settings || !modelId) return null;
	for (const provider of settings.providers) {
		const model = provider.models.find((each) => each.id === modelId);
		if (!model) continue;
		const clashes = ambiguousNames(groupModels(settings.providers));
		return { model, provider, ambiguous: clashes.has(model.name.trim().toLowerCase()) };
	}
	return null;
}

/** 「BigModel · GLM-5.3 · 128K 上下文」 — the whole answer, for a tooltip that has room for it. */
export function modelTooltip(
	identity: { model: ModelConfig; provider: ProviderConfig } | null,
	window: (tokens: number) => string,
): string {
	if (!identity) return "选择模型";
	return `${identity.provider.name} · ${identity.model.name} · ${window(identity.model.contextWindow)} 上下文`;
}
