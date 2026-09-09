/**
 * The offline model catalogue used by settings and usage accounting.
 *
 * Endpoint rates take priority; relays use an identified upstream reference price.
 * Opaque aliases require an explicit binding, and the wire model id is never rewritten.
 */

import snapshotJson from "./catalog/model-catalog.json" with { type: "json" };
import type { ModelConfig, ModelPricing, ModelPricingTier, ProviderConfig } from "./types/provider.ts";

export interface CatalogModel {
	id: string;
	name: string;
	contextWindow: number;
	maxOutputTokens: number;
	inputPrice?: number;
	outputPrice?: number;
	cacheReadPrice?: number;
	cacheWritePrice?: number;
	tiers?: ModelPricingTier[];
	supportsThinking: boolean;
	supportsImages: boolean;
	supportsTools: boolean;
}

export interface CatalogProvider {
	id: string;
	name: string;
	api?: string;
	doc?: string;
	models: CatalogModel[];
}

interface ModelCatalogSnapshot {
	schema: 1;
	source: {
		name: string;
		url: string;
		repository: string;
		commit: string;
		updatedAt: string;
		license: "MIT";
	};
	providers: CatalogProvider[];
}

function schemaVersion(value: number): 1 {
	if (value !== 1) throw new Error(`Unsupported model catalogue schema: ${value}`);
	return value;
}

function catalogueLicense(value: string): "MIT" {
	if (value !== "MIT") throw new Error(`Unsupported model catalogue license: ${value}`);
	return value;
}

const snapshot: ModelCatalogSnapshot = {
	...snapshotJson,
	schema: schemaVersion(snapshotJson.schema),
	source: {
		...snapshotJson.source,
		license: catalogueLicense(snapshotJson.source.license),
	},
};
const providers = new Map(snapshot.providers.map((provider) => [provider.id, provider]));

export const MODEL_CATALOG_SOURCE = snapshot.source;
export const MODEL_CATALOG_VERSION = `2:${snapshot.source.commit.slice(0, 12)}`;
export const MODEL_CATALOG_PROVIDERS = snapshot.providers;

const EXACT_HOSTS: Record<string, string> = {
	"api.openai.com": "openai",
	"api.anthropic.com": "anthropic",
	"generativelanguage.googleapis.com": "google",
	"api.deepseek.com": "deepseek",
	"api.x.ai": "xai",
	"api.mistral.ai": "mistral",
	"api.groq.com": "groq",
	"openrouter.ai": "openrouter",
	"api.openrouter.ai": "openrouter",
	"api.githubcopilot.com": "github-copilot",
	"api.fireworks.ai": "fireworks-ai",
	"api.together.xyz": "togetherai",
	"api.cerebras.ai": "cerebras",
	"api.perplexity.ai": "perplexity",
	"api.moonshot.ai": "moonshotai",
	"api.moonshot.cn": "moonshotai-cn",
	"dashscope.aliyuncs.com": "alibaba-cn",
	"dashscope-intl.aliyuncs.com": "alibaba",
	"open.bigmodel.cn": "zhipuai",
	"api.z.ai": "zai",
	"api.minimax.chat": "minimax-cn",
	"api.minimax.io": "minimax",
	"api.minimaxi.com": "minimax-cn",
	"api.deepinfra.com": "deepinfra",
	"api.cloudflare.com": "cloudflare-workers-ai",
};

function providerIdFromHost(hostname: string): string | null {
	const exact = EXACT_HOSTS[hostname];
	if (exact) return exact;
	if (hostname.endsWith(".openai.azure.com")) return "azure";
	if (hostname === "aiplatform.googleapis.com" || hostname.endsWith("-aiplatform.googleapis.com")) return "google-vertex";
	if (/^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname)) return "amazon-bedrock";
	return null;
}

function configuredHostname(baseUrl: string): string | null {
	try {
		return new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

/** Resolve a configured endpoint to one catalogue provider, without guessing from its model ids. */
export function catalogProviderFor(provider: Pick<ProviderConfig, "id" | "baseUrl">): CatalogProvider | null {
	const hostname = configuredHostname(provider.baseUrl);
	if (hostname) {
		const endpoint = new URL(provider.baseUrl);
		const candidates = snapshot.providers.filter((entry) => {
			if (!entry.api || configuredHostname(entry.api) !== hostname) return false;
			const path = new URL(entry.api).pathname.replace(/\/$/, "");
			return endpoint.pathname === path || endpoint.pathname.startsWith(`${path}/`);
		}).sort((a, b) => (b.api?.length ?? 0) - (a.api?.length ?? 0));
		if (candidates[0]) return candidates[0];
		const id = providerIdFromHost(hostname);
		return id ? providers.get(id) ?? null : null;
	}
	return providers.get(provider.id.toLowerCase()) ?? null;
}

export interface CatalogMatch {
	provider: CatalogProvider;
	model: CatalogModel;
	match: "exact" | "alias" | "reference" | "binding";
}

function familyProvider(id: string): string | undefined {
	if (/^(gpt-|o[134](?:-|$))/.test(id)) return "openai";
	if (id.startsWith("claude-")) return "anthropic";
	if (id.startsWith("gemini-")) return "google";
	if (/^(kimi-|moonshot-)/.test(id)) return "moonshotai";
	if (/^(qwen|qwq|qvq)/.test(id)) return "alibaba";
	if (id.startsWith("glm-")) return "zai";
	if (id.startsWith("deepseek-")) return "deepseek";
	if (id.startsWith("grok-")) return "xai";
	if (id.startsWith("minimax-")) return "minimax";
	if (/^(mistral|magistral|codestral|devstral|ministral)/.test(id)) return "mistral";
	return undefined;
}

const modelIndexes = new Map(snapshot.providers.map((provider) => [provider.id,
	new Map(provider.models.flatMap((model) => [[model.id.toLowerCase(), model], [model.id.toLowerCase().split("/").at(-1) ?? model.id, model]])),
]));

/** Only recognised decorations may be removed; unknown versions and paid/free variants stay distinct. */
function modelCandidates(id: string): string[] {
	let current = id.trim().toLowerCase().replace(/claude-(opus|sonnet|haiku)-(\d+)\.(\d+)/, "claude-$1-$2-$3");
	const candidates = [current];
	const bare = current.split("/").at(-1);
	if (bare && bare !== current) candidates.push(bare);
	current = bare ?? current;
	const suffix = /[-_:](?:extra-low|minimal|low|medium|high|xhigh|max|ultra|thinking|reasoning|preview|latest|agent|tiered|\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;
	while (suffix.test(current)) {
		current = current.replace(suffix, "");
		candidates.push(current);
	}
	return candidates;
}

export function catalogModelFor(
	provider: Pick<ProviderConfig, "id" | "baseUrl">,
	modelId: string,
	binding?: ModelConfig["catalogRef"],
): CatalogMatch | null {
	if (binding) {
		const source = providers.get(binding.providerId);
		const model = source?.models.find((entry) => entry.id === binding.modelId);
		return source && model ? { provider: source, model, match: "binding" } : null;
	}
	const endpoint = catalogProviderFor(provider);
	const candidates = modelCandidates(modelId);
	const bare = modelId.trim().toLowerCase().split("/").at(-1) ?? modelId;
	const family = familyProvider(bare);
	// OpenRouter supplies reference prices for open-weight families without an upstream API tariff.
	const sources = [...new Set([endpoint?.id, family, "openrouter"])].filter((id) => id !== undefined);
	for (const candidate of candidates) {
		for (const sourceId of sources) {
			const source = providers.get(sourceId);
			const model = modelIndexes.get(sourceId)?.get(candidate);
			if (source && model) return { provider: source, model, match: source === endpoint ? (candidate === modelId ? "exact" : "alias") : "reference" };
		}
	}
	// Some versioned APIs only publish a preview id. Never choose a version for an opaque alias.
	if (/\d/.test(bare)) {
		const source = family ? providers.get(family) : undefined;
		for (const candidate of candidates) {
			const model = source && modelIndexes.get(source.id)?.get(`${candidate}-preview`);
			if (source && model) return { provider: source, model, match: "reference" };
		}
	}
	return null;
}

export function catalogPricing(providerId: string, model: CatalogModel): ModelPricing | undefined {
	if (model.inputPrice === undefined || model.outputPrice === undefined) return undefined;
	return {
		input: model.inputPrice,
		output: model.outputPrice,
		cacheRead: model.cacheReadPrice,
		cacheWrite: model.cacheWritePrice,
		tiers: model.tiers,
		source: "catalog",
		catalogProvider: providerId,
		catalogModel: model.id,
		catalogVersion: MODEL_CATALOG_VERSION,
	};
}

/**
 * Whether the catalogue's own name for a model is safe to show.
 *
 * `modelCandidates` finds an entry by stripping suffixes — `-thinking`, `-preview`, `-high` and the
 * rest — so `gemini-2.5-flash-thinking` matches the entry for `gemini-2.5-flash`. Borrowing that
 * entry's limits and prices is a fair approximation. Borrowing its *name* is not: the suffix that
 * was stripped is the only thing telling those two models apart, and four ids that reduce to one
 * entry all end up displaying the same word. The picker then has nothing left to disambiguate with
 * — it separates same-named models by their provider, and these share one.
 *
 * The file header promises the wire model id is never rewritten. This keeps the promise on the half
 * of it a person actually reads.
 *
 * `exact` is the same id in the same provider's catalogue, and `binding` is a link the user chose
 * on purpose; both mean the entry really is this model, so its name describes it.
 */
function namedByCatalog(match: CatalogMatch["match"]): boolean {
	return match === "exact" || match === "binding";
}

/** A complete model row for endpoint discovery imports. */
export function modelConfigFromCatalog(provider: ProviderConfig, modelId: string): ModelConfig | null {
	const found = catalogModelFor(provider, modelId);
	if (!found) return null;
	return {
		id: `${provider.id}/${modelId}`,
		providerId: provider.id,
		modelId,
		name: namedByCatalog(found.match) ? found.model.name : modelId,
		contextWindow: found.model.contextWindow,
		maxOutputTokens: found.model.maxOutputTokens,
		supportsThinking: found.model.supportsThinking,
		supportsImages: found.model.supportsImages,
		supportsTools: found.model.supportsTools,
		pricing: catalogPricing(found.provider.id, found.model),
		metadataSource: "catalog",
	};
}

/** Migrate only the old import signature; explicit limits, capabilities and manual prices survive. */
export function withCatalogDefaults(provider: Pick<ProviderConfig, "id" | "baseUrl">, model: ModelConfig): ModelConfig {
	const found = catalogModelFor(provider, model.modelId, model.catalogRef);
	if (!found) return model;
	const legacyImport = !model.metadataSource && model.contextWindow === 200_000 && model.maxOutputTokens === 16_384 &&
		model.supportsThinking && model.supportsImages && model.supportsTools;
	const follow = model.metadataSource === "catalog" || legacyImport;
	const pricing = model.pricing && model.pricing.source !== "catalog" ? model.pricing : catalogPricing(found.provider.id, found.model);
	return {
		...model,
		...(follow ? {
			contextWindow: found.model.contextWindow, maxOutputTokens: found.model.maxOutputTokens,
			supportsThinking: found.model.supportsThinking, supportsImages: found.model.supportsImages,
			supportsTools: found.model.supportsTools, metadataSource: "catalog",
		} : {}),
		/*
		 * Names filled in by an older import are corrected; names a person typed are not.
		 *
		 * `metadataSource` says whether *limits* follow the catalogue and is left alone when the
		 * display name is edited, so it cannot answer this on its own. What can: a name that is
		 * still character-for-character the catalogue's is one nobody has touched.
		 */
		...(follow && !namedByCatalog(found.match) && model.name === found.model.name
			? { name: model.modelId }
			: {}),
		pricing,
	};
}
