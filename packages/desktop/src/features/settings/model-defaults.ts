/**
 * What a model gets for limits when nobody has said otherwise.
 *
 * One constant, because there used to be three numbers in three files that disagreed. The pull
 * dialog printed a hardcoded `200K` beside every row — the same literal for all thirty-three, wired
 * to nothing — while the import behind it took whatever the offline catalogue said, so a Gemini row
 * advertised as 200K arrived in the list as 1M. Neither number was wrong on its own; there was just
 * no single place that decided.
 *
 * The catalogue's own figures are the upstream's, and an endpoint reached through a relay is not the
 * upstream: it may cap the window, bill differently, or front an entirely different model behind the
 * same name. So a discovered model is imported at a conservative, stated default and the person can
 * raise it in the model editor — which is the one place that should be able to change it.
 */

import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { modelConfigFromCatalog } from "@lyra/core/model-catalog";

/** Context window written into every imported or hand-added model. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Maximum output tokens written into every imported or hand-added model. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

/**
 * One discovered model id, as a row in the provider's list.
 *
 * The catalogue is still consulted, but only for what it can know from a model's name: whether it
 * thinks, sees images, calls tools, and what it costs. The *limits* are ours.
 *
 * `metadataSource: "manual"` is load-bearing rather than cosmetic. `withCatalogDefaults` runs on
 * every settings read *and* every write, and on a row marked `"catalog"` it overwrites the window
 * and the output cap with the catalogue's. Importing at 200K under that flag produced a row that
 * said 200K until the next save and 1M ever after — the value could not survive being stored.
 * `"manual"` is what the flag actually means here: these numbers were decided locally.
 */
export function importedModel(provider: Pick<ProviderConfig, "id" | "baseUrl">, modelId: string): ModelConfig {
	const known = modelConfigFromCatalog(provider as ProviderConfig, modelId);
	return {
		...(known ?? {
			id: `${provider.id}/${modelId}`,
			providerId: provider.id,
			modelId,
			name: modelId,
			supportsThinking: false,
			supportsImages: false,
			supportsTools: false,
		}),
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
		metadataSource: "manual",
	};
}

/**
 * The same figure the import will write, formatted the way the model list formats it.
 *
 * Exported so the pull dialog can show what is actually about to happen rather than a literal of its
 * own. If these ever need to differ per model, this is the seam to widen — not another string.
 */
export function defaultWindowLabel(): string {
	return `${Math.round(DEFAULT_CONTEXT_WINDOW / 1000)}K`;
}
