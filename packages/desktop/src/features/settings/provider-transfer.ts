/**
 * A provider list as a file, so it can leave one machine and arrive on another.
 *
 * Two things make this more than `JSON.stringify`. The file carries API keys — it is the one thing
 * this app writes out that is worth stealing — so it says so about itself, and the caller is
 * expected to say so too before writing one.
 *
 * And a file being read came from somewhere this program cannot see. Everything here is checked
 * field by field rather than cast: a `providers` array with half-formed entries in it does not stop
 * at this boundary, it reaches the model picker, the request builder and `settings.json` at once.
 * Anything that fails the check is dropped rather than repaired, and the count of dropped entries
 * goes back to the caller so the window can say the file was not entirely understood.
 */

import type { ApiFormat, ModelConfig, ModelPricing, ModelPricingTier, ProviderConfig } from "@lyra/core";

/** Identifies the file as ours before anything reads what is in it. */
export const BUNDLE_KIND = "lyra.providers";
export const BUNDLE_VERSION = 1;

const API_FORMATS = new Set<string>(["openai-responses", "anthropic-messages", "openai-chat-completions"]);

export interface ProviderBundle {
	kind: string;
	version: number;
	exportedAt: string;
	/**
	 * Declared by the file rather than worked out from it.
	 *
	 * Whoever ends up holding this — a colleague, a sync folder, a support ticket — should be able
	 * to tell what it is worth without reading every provider in it.
	 */
	containsSecrets: boolean;
	providers: ProviderConfig[];
}

export type BundleProblem = "not-json" | "not-a-bundle" | "too-new" | "no-providers";

export type BundleParse =
	| { ok: true; bundle: ProviderBundle; dropped: number }
	| { ok: false; problem: BundleProblem };

export function buildBundle(providers: ProviderConfig[], now = new Date()): ProviderBundle {
	return {
		kind: BUNDLE_KIND,
		version: BUNDLE_VERSION,
		exportedAt: now.toISOString(),
		containsSecrets: providers.some((provider) => provider.apiKey.trim().length > 0),
		providers,
	};
}

/** Tab-indented like the rest of the repo, and because a person may well open this in an editor. */
export function serializeBundle(bundle: ProviderBundle): string {
	return `${JSON.stringify(bundle, null, "\t")}\n`;
}

/** Local time, not the ISO stamp inside: this is the name in a folder, sorted by eye. */
export function bundleFileName(now = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
	return `lyra-providers-${stamp}.json`;
}

export function parseBundle(text: string): BundleParse {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, problem: "not-json" };
	}

	if (!isRecord(raw) || raw.kind !== BUNDLE_KIND || !Array.isArray(raw.providers)) {
		return { ok: false, problem: "not-a-bundle" };
	}
	/*
	 * A newer file is refused rather than read for the parts this build recognises.
	 *
	 * The version is only bumped when the old reading of a field becomes wrong, so importing the
	 * subset would produce a provider that looks configured and is not.
	 */
	if (typeof raw.version === "number" && raw.version > BUNDLE_VERSION) return { ok: false, problem: "too-new" };

	const providers: ProviderConfig[] = [];
	let dropped = 0;
	for (const entry of raw.providers) {
		const provider = readProvider(entry);
		if (provider) providers.push(provider);
		else dropped += 1;
	}
	if (providers.length === 0) return { ok: false, problem: "no-providers" };

	return {
		ok: true,
		dropped,
		bundle: {
			kind: BUNDLE_KIND,
			version: typeof raw.version === "number" ? raw.version : BUNDLE_VERSION,
			exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
			containsSecrets: providers.some((provider) => provider.apiKey.trim().length > 0),
			providers,
		},
	};
}

/** What importing one entry would do, worked out before anything is written. */
export interface ImportEntry {
	provider: ProviderConfig;
	/** Whether a provider with this id is already configured here. */
	kind: "new" | "replace";
	/** The file carries a key for it. */
	hasKey: boolean;
	/**
	 * No key in the file, but the provider it replaces has one that survives the import.
	 *
	 * The case this exists for is a file someone stripped by hand before sending it: replacing a
	 * working provider with a keyless copy of itself would break it, and silently.
	 */
	keepsLocalKey: boolean;
}

export function planImport(incoming: ProviderConfig[], existing: ProviderConfig[]): ImportEntry[] {
	const byId = new Map(existing.map((provider) => [provider.id, provider]));
	return incoming.map((provider) => {
		const current = byId.get(provider.id);
		const hasKey = provider.apiKey.trim().length > 0;
		return {
			provider,
			kind: current ? "replace" : "new",
			hasKey,
			keepsLocalKey: !hasKey && Boolean(current?.apiKey.trim()),
		};
	});
}

/**
 * The imported providers folded into the configured ones, and the default model kept honest.
 *
 * Same rule as removing a provider by hand: a default pointing at a model that no longer exists has
 * to move, or the next message is sent with nothing selected.
 */
/**
 * A name no other provider in the list is already using.
 *
 * Two providers called the same thing are two rows nobody can tell apart — and the damage carries:
 * when two models share a name the picker disambiguates them *by their provider*, so a duplicate
 * provider name takes the last thing that could have distinguished them. Both ways in produce one:
 * 「新供应商」 is the same name every time it is pressed, and an import brings entries whose ids are
 * new on this machine but whose names came from another one.
 *
 * Numbered rather than suffixed with the id: the point is to be readable in a list, and
 * `Relay (provider-m8x2k)` is not.
 */
export function uniqueProviderName(taken: Iterable<string>, wanted: string): string {
	const used = new Set<string>();
	for (const name of taken) used.add(name.trim());
	const base = wanted.trim();
	if (!base || !used.has(base)) return wanted;
	for (let n = 2; ; n++) {
		const candidate = `${base} ${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

export function applyImport(
	existing: ProviderConfig[],
	chosen: ProviderConfig[],
	defaultModelId: string | null,
): { providers: ProviderConfig[]; defaultModelId: string | null } {
	const byId = new Map(existing.map((provider) => [provider.id, provider]));
	const appended: ProviderConfig[] = [];

	/*
	 * Names already spoken for, which grows as entries are appended.
	 *
	 * Seeded from what is here rather than from `chosen`, because an entry that replaces one under
	 * the same id is that provider — it keeps its name even if it matches itself.
	 */
	const names = new Set(existing.map((provider) => provider.name.trim()));

	for (const provider of chosen) {
		const current = byId.get(provider.id);
		// An empty key in the file means "not exported", never "clear the one I have".
		const merged: ProviderConfig =
			current && !provider.apiKey.trim() ? { ...provider, apiKey: current.apiKey } : provider;
		if (current) {
			byId.set(provider.id, merged);
			continue;
		}
		const name = uniqueProviderName(names, merged.name);
		names.add(name.trim());
		appended.push(name === merged.name ? merged : { ...merged, name });
	}

	const providers = [...existing.map((provider) => byId.get(provider.id) ?? provider), ...appended];
	const stillThere = providers.some((provider) => provider.models.some((model) => model.id === defaultModelId));
	return {
		providers,
		defaultModelId: stillThere ? defaultModelId : (providers[0]?.models[0]?.id ?? null),
	};
}

function readProvider(raw: unknown): ProviderConfig | null {
	if (!isRecord(raw)) return null;
	const id = text(raw.id);
	const baseUrl = text(raw.baseUrl);
	if (!id || !baseUrl) return null;

	const api = typeof raw.api === "string" && API_FORMATS.has(raw.api) ? (raw.api as ApiFormat) : "openai-responses";
	const models = Array.isArray(raw.models)
		? raw.models.map((model) => readModel(model, id)).filter((model): model is ModelConfig => model !== null)
		: [];

	return {
		id,
		name: text(raw.name) || id,
		baseUrl,
		api,
		apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
		// A provider arriving disabled stays disabled; anything unreadable defaults to on, which is
		// what adding one by hand does.
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
		...(isStringMap(raw.headers) ? { headers: raw.headers } : {}),
		models,
	};
}

/**
 * One model, with the fields that are expensive to derive again carried across.
 *
 * Pricing and the catalogue reference are worth more than the round trip costs: working them out on
 * the far machine means a catalogue lookup that may not have the entry, and a relay alias never
 * does. Each is rebuilt from its own fields rather than passed through, so a hand-edited one that
 * has lost its rates is dropped here instead of reaching the usage figures as `NaN`.
 */
function readModel(raw: unknown, providerId: string): ModelConfig | null {
	if (!isRecord(raw)) return null;
	const modelId = text(raw.modelId);
	if (!modelId) return null;

	const pricing = readPricing(raw.pricing);
	const catalogRef = isRecord(raw.catalogRef) ? { providerId: text(raw.catalogRef.providerId), modelId: text(raw.catalogRef.modelId) } : null;

	return {
		id: text(raw.id) || `${providerId}/${modelId}`,
		providerId,
		modelId,
		name: text(raw.name) || modelId,
		contextWindow: count(raw.contextWindow, 200_000),
		maxOutputTokens: count(raw.maxOutputTokens, 16_384),
		/*
		 * 没写就是「有」，写了 `false` 才是「没有」。
		 *
		 * 原本是 `=== true`：字段缺席等同于不支持。而缺席最常见的来源是一份手写的或者别处生成的
		 * 配置——那种文件里通常只写 id 和地址，于是导进来的每个模型都不会调工具，人还以为是导入
		 * 坏了。明确写 `false` 是一次选择，那个照旧尊重。
		 */
		supportsThinking: raw.supportsThinking !== false,
		supportsImages: raw.supportsImages !== false,
		supportsTools: raw.supportsTools !== false,
		...(pricing ? { pricing } : {}),
		...(catalogRef?.providerId && catalogRef.modelId ? { catalogRef } : {}),
		...(raw.metadataSource === "manual" || raw.metadataSource === "catalog"
			? { metadataSource: raw.metadataSource }
			: {}),
		...(Array.isArray(raw.thinkingOptions) ? { thinkingOptions: raw.thinkingOptions as ModelConfig["thinkingOptions"] } : {}),
		...(isRecord(raw.samplingParams) ? { samplingParams: raw.samplingParams } : {}),
	};
}

/** Rates only, when both of the ones every cost calculation needs are actually there. */
function readPricing(raw: unknown): ModelPricing | undefined {
	if (!isRecord(raw)) return undefined;
	const input = rate(raw.input);
	const output = rate(raw.output);
	if (input === null || output === null) return undefined;

	const cacheRead = rate(raw.cacheRead);
	const cacheWrite = rate(raw.cacheWrite);
	const tiers = Array.isArray(raw.tiers)
		? raw.tiers.map(readTier).filter((tier): tier is ModelPricingTier => tier !== null)
		: [];

	return {
		input,
		output,
		...(cacheRead !== null ? { cacheRead } : {}),
		...(cacheWrite !== null ? { cacheWrite } : {}),
		...(tiers.length > 0 ? { tiers } : {}),
		// Manual rates were typed by a person and outrank the catalogue; anything else is a lookup
		// the far machine can redo for itself.
		...(raw.source === "manual" ? { source: "manual" as const } : {}),
		...(text(raw.catalogProvider) ? { catalogProvider: text(raw.catalogProvider) } : {}),
		...(text(raw.catalogModel) ? { catalogModel: text(raw.catalogModel) } : {}),
		...(text(raw.catalogVersion) ? { catalogVersion: text(raw.catalogVersion) } : {}),
	};
}

function readTier(raw: unknown): ModelPricingTier | null {
	if (!isRecord(raw)) return null;
	const aboveTokens = rate(raw.aboveTokens);
	const input = rate(raw.input);
	const output = rate(raw.output);
	if (aboveTokens === null || input === null || output === null) return null;

	const cacheRead = rate(raw.cacheRead);
	const cacheWrite = rate(raw.cacheWrite);
	return {
		aboveTokens,
		input,
		output,
		...(cacheRead !== null ? { cacheRead } : {}),
		...(cacheWrite !== null ? { cacheWrite } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** A price or a threshold: finite and not negative, or absent. Zero is a real answer — free. */
function rate(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
