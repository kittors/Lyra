import type { ModelConfig, Settings } from "@lyra/core";

/**
 * The model a conversation is running on, found by the id that identifies it here.
 *
 * Two ids and it matters which. `ModelConfig.id` is local — `${providerId}/${modelId}` — and is
 * what a session stores and what the settings call the default, because the same `gpt-5.2` can be
 * configured twice against two endpoints with different keys and different context windows.
 * `modelId` is what goes over the wire. Everything in the app that says "which model" means the
 * first one; only the request builder and the brand lookup want the second.
 *
 * Written out three times before this — in the composer, in the side chat's composer, and in the
 * context meter — which is three chances for one of them to start searching by the wrong id.
 */
export function findModel(settings: Settings | null, modelId: string | null | undefined): ModelConfig | null {
	if (!settings || !modelId) return null;
	for (const provider of settings.providers) {
		const model = provider.models.find((m) => m.id === modelId);
		if (model) return model;
	}
	return null;
}
