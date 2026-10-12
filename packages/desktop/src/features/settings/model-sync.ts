/**
 * What the pull dialog decides, as data: which of a provider's models stay, which arrive, which go.
 *
 * The dialog used to be an importer — it listed what the endpoint returned, greyed out everything
 * already configured, and could only add. So the one moment you are looking at a provider's whole
 * model list next to what the endpoint actually offers was the one moment you could not remove a
 * model, and could not add one the endpoint does not list (a relay that serves an image model but
 * advertises only its chat models). With every listed model already added it was a dead end: zero
 * selected, the button disabled, nothing to do but cancel.
 *
 * Now the checkboxes are the provider's list as it will be after "apply": a configured model starts
 * checked and unchecking it removes it, a listed model that is not configured yet starts checked
 * and is added, and a name typed in by hand is added as it is written. Nothing is saved until the
 * button, so an unchecked row is a proposal rather than a deletion.
 *
 * Pure on purpose — the rules about the default model are the kind that is easy to get wrong at a
 * call site, and here they can be tested without a renderer.
 */

import type { ModelConfig, ProviderConfig, Settings } from "@lyra/core";
import { isImageModel } from "@lyra/core/image-models";
import { brandOf, houseWords } from "../../lib/model-brand.ts";
import { importedModel } from "./model-defaults.ts";

export interface SyncRow {
	/** The id sent to the provider — what the endpoint lists and what a person types. */
	modelId: string;
	/** The configured model this row stands for, if it is configured. */
	existing?: ModelConfig;
	/** Whether the endpoint listed it this time. */
	listed: boolean;
	/** Typed into the dialog rather than listed or configured. */
	custom: boolean;
}

export interface SyncRows {
	/** Configured models, in the provider's own order. */
	configured: SyncRow[];
	/** Everything that could be added: names typed in first (newest first), then what was listed. */
	available: SyncRow[];
}

/** Trimmed, non-empty, first occurrence kept — an endpoint that lists a model twice should not get two rows. */
export function cleanModelIds(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of ids) {
		const id = raw.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

export function syncRows(listed: readonly string[], configured: readonly ModelConfig[], custom: readonly string[]): SyncRows {
	const listedIds = cleanModelIds(listed);
	const listedSet = new Set(listedIds);
	const configuredIds = new Set(configured.map((model) => model.modelId));
	const customIds = cleanModelIds(custom).filter((id) => !configuredIds.has(id) && !listedSet.has(id));
	return {
		configured: configured.map((model) => ({ modelId: model.modelId, existing: model, listed: listedSet.has(model.modelId), custom: false })),
		available: [
			...[...customIds].reverse().map((modelId) => ({ modelId, listed: false, custom: true })),
			...listedIds.filter((id) => !configuredIds.has(id)).map((modelId) => ({ modelId, listed: true, custom: false })),
		],
	};
}

export interface ModelChange {
	/** Model ids to add, in the order they should be appended. */
	add: string[];
	/** Model ids to remove from the provider. */
	remove: string[];
}

/**
 * What applying the dialog would do.
 *
 * Every row starts checked: a configured model stays, a listed one arrives (what the importer always
 * did — pulling a list is usually done to add from it, so the common case is still one click), a
 * typed one arrives because typing it was the request. So the state is only what was unchecked, and
 * a row that turns up later — the list changed under an open dialog — gets that same default rather
 * than reading as "remove".
 */
export function changeOf(rows: SyncRows, unchecked: ReadonlySet<string>): ModelChange {
	return {
		add: rows.available.filter((row) => !unchecked.has(row.modelId)).map((row) => row.modelId),
		remove: rows.configured.filter((row) => unchecked.has(row.modelId)).map((row) => row.modelId),
	};
}

/**
 * Whether a row answers a search: its id, the name it was given, or the house that made it.
 *
 * The field has always said 「搜索模型名称或厂商」 and only ever matched the id — "google" found
 * nothing in a list of Gemini models.
 */
export function rowMatches(row: SyncRow, query: string): boolean {
	const wanted = query.trim().toLowerCase();
	if (!wanted) return true;
	const brand = brandOf(row.modelId, row.existing?.name);
	return [row.modelId, row.existing?.name ?? "", ...(brand ? houseWords(brand) : [])].some((word) => word.toLowerCase().includes(wanted));
}

/**
 * Whether a typed name is new to this dialog.
 *
 * Case-insensitive, unlike the ids themselves: "GPT-4o" typed beside a listed "gpt-4o" is almost
 * certainly the listed one, and a second row that differs only in case is a trap, not a choice.
 */
export function isNewModelName(name: string, rows: SyncRows): boolean {
	const wanted = name.trim().toLowerCase();
	if (!wanted) return false;
	return ![...rows.configured, ...rows.available].some((row) => row.modelId.toLowerCase() === wanted);
}

/**
 * The first model a conversation could be sent to.
 *
 * Both "the first model becomes the default" rules used to take whichever model came first, and an
 * image model is a model too: pull a list that starts with `gemini-3.1-flash-image` into an empty
 * install and every new conversation was addressed to something that cannot reply.
 */
export function firstChatModelId(models: readonly ModelConfig[]): string | null {
	return models.find((model) => !isImageModel(model))?.id ?? null;
}

/**
 * The settings after a change has been applied to one provider.
 *
 * A removed model takes its pointers with it, the way removing one from the list does: the default
 * model (then filled from what was added, if anything can reply) and the default image model, which
 * falls back to the first image model when unset.
 */
export function applyModelChange(settings: Settings, providerId: string, change: ModelChange): Settings {
	const provider = settings.providers.find((one) => one.id === providerId);
	if (!provider) return settings;
	const remove = new Set(change.remove);
	const kept = provider.models.filter((model) => !remove.has(model.modelId));
	const keptIds = new Set(kept.map((model) => model.modelId));
	const added = cleanModelIds(change.add)
		.filter((id) => !keptIds.has(id) && !remove.has(id))
		.map((id) => importedModel(provider, id));
	if (added.length === 0 && kept.length === provider.models.length) return settings;

	const removedIds = new Set(provider.models.filter((model) => remove.has(model.modelId)).map((model) => model.id));
	const defaultModelId = settings.defaultModelId && !removedIds.has(settings.defaultModelId) ? settings.defaultModelId : null;
	const next: ProviderConfig = { ...provider, models: [...kept, ...added] };
	return {
		...settings,
		providers: settings.providers.map((one) => (one.id === providerId ? next : one)),
		defaultModelId: defaultModelId ?? firstChatModelId(added),
		imageModelId: settings.imageModelId && removedIds.has(settings.imageModelId) ? null : settings.imageModelId,
	};
}
