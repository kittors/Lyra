import type { ModelConfig, ThinkingLevel, ThinkingOption } from "../types/provider.ts";

/**
 * Every standard level, shallowest first. A level a model does not offer is looked for along this
 * line — see `resolveThinkingOption`.
 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** The words a built-in level is drawn with. The renderer swaps in the interface language's. */
const TEXT: Record<string, Pick<ThinkingOption, "label" | "detail">> = {
	off: { label: "关闭", detail: "不推理，直接作答。最快。" },
	minimal: { label: "极简", detail: "只做最低限度的思考。" },
	low: { label: "低", detail: "简单任务够用。" },
	medium: { label: "中", detail: "日常编码的默认档。" },
	high: { label: "高", detail: "复杂重构、疑难排查。" },
	xhigh: { label: "超高", detail: "更深层次的逻辑推演。" },
	max: { label: "最高", detail: "把预算拉满，最慢也最稳。" },
	ultra: { label: "极致", detail: "极致推理模式，算力全开。" },
};

/**
 * A model's options from the efforts its API accepts. `vendorDefault` is what the API does when no
 * effort is sent. A ladder without `off` is a model whose reasoning cannot be turned off.
 */
function ladder(levels: readonly ThinkingLevel[], vendorDefault: ThinkingLevel = "medium"): ThinkingOption[] {
	return levels.map((id) => (id === vendorDefault ? { id, ...TEXT[id], isDefault: true } : { id, ...TEXT[id] }));
}

/** What nearly every reasoning endpoint accepts. Google's models and unrecognised ids get this. */
export const DEFAULT_THINKING_OPTIONS: ThinkingOption[] = ladder(["off", "low", "medium", "high"]);

/** `gpt-<rest>` after a non-alphanumeric boundary, so `openai/`, `azure/` and `openai.` prefixes still match. */
const gpt = (rest: string) => new RegExp(`(?:^|[^a-z0-9])gpt-?${rest}`);

const NONE_TO_MAX = ladder(["off", "low", "medium", "high", "xhigh", "max"]);
const LOW_TO_MAX = ladder(["low", "medium", "high", "xhigh", "max"]);
const NONE_TO_XHIGH = ladder(["off", "low", "medium", "high", "xhigh"]);
const LOW_TO_XHIGH = ladder(["low", "medium", "high", "xhigh"]);
const PRO = ladder(["medium", "high", "xhigh"]);
const LOW_TO_HIGH = ladder(["low", "medium", "high"]);
const DEEPSEEK_V4 = ladder(["off", "low", "high", "max"], "high");

/**
 * OpenAI's models by family, with the efforts each one's API accepts — `off` standing for `none`.
 *
 * Source: the `reasoning.effort` line on each model's page at developers.openai.com (read
 * 2026-10-16), cross-checked against models.dev's `reasoning_options` and the catalogue Codex ships;
 * the Codex models without a documented line come from Codex's own presets. Codex's lists leave out
 * `none`, which it never sends, and add `ultra`, which is not an API value: Codex turns it into `max`
 * before the request and adds sub-agent orchestration of its own (`resolve_reasoning_effort` in
 * codex-rs). Sent as it is, it is a 400 — so is `none` to GPT-6 Astra and GPT-6.1 Sol.
 *
 * Most specific first: a `-pro` or `-codex` id contains its base family's name.
 */
const OPENAI_FAMILIES: readonly (readonly [RegExp, ThinkingOption[]])[] = [
	[gpt("6\\.1-sol"), LOW_TO_MAX],
	[gpt("6-astra"), LOW_TO_MAX],
	[gpt("6-(?:sol|luna)"), NONE_TO_MAX],
	/*
	 * A GPT-6 member not named above gets what every documented member accepts.
	 *
	 * Not the conservative fallback: that set offers `off`, which two of the four documented members
	 * reject with a 400, and hides `xhigh` and `max`, which all four accept. Leaving the family to
	 * fall through is how GPT-6.1 Sol was drawn with four levels on the day it shipped.
	 */
	[gpt("6(?![0-9])"), LOW_TO_MAX],
	[gpt("5\\.6(?![0-9])"), NONE_TO_MAX],
	[gpt("5\\.5-pro"), ladder(["medium", "high", "xhigh"], "high")],
	[gpt("5\\.5(?![0-9])"), NONE_TO_XHIGH],
	[gpt("5\\.4-pro"), PRO],
	[gpt("5\\.4(?![0-9])"), NONE_TO_XHIGH],
	[gpt("5\\.3-codex"), LOW_TO_XHIGH],
	[gpt("5\\.2-pro"), PRO],
	[gpt("5\\.2-codex"), LOW_TO_XHIGH],
	[gpt("5\\.2-chat"), ladder(["medium"])],
	[gpt("5\\.2(?![0-9])"), NONE_TO_XHIGH],
	[gpt("5\\.1-codex-max"), LOW_TO_XHIGH],
	[gpt("5\\.1-codex-mini"), ladder(["medium", "high"])],
	[gpt("5\\.1-codex"), LOW_TO_HIGH],
	[gpt("5\\.1(?![0-9])"), ladder(["off", "low", "medium", "high"])],
	[gpt("5-pro"), ladder(["high"], "high")],
	[gpt("5-codex-mini"), ladder(["medium", "high"])],
	[gpt("5-codex"), LOW_TO_HIGH],
	// `gpt-5.7` is not GPT-5, and neither is `gpt-5-chat-latest`, ChatGPT's own snapshot.
	[gpt("5(?![0-9.]|-chat)"), ladder(["minimal", "low", "medium", "high"])],
	[gpt("oss"), LOW_TO_HIGH],
	// `o1-mini` and `o1-preview` predate the parameter.
	[/(?:^|[^a-z0-9])(?:o1(?!-mini|-preview)|o3|o4-mini)(?![a-z0-9.])/, LOW_TO_HIGH],
];

/**
 * Resolve effective thinking options for a given model.
 * If the model has explicit options configured, use them.
 * Otherwise, infer them from the model id.
 */
export function resolveModelThinkingOptions(model?: ModelConfig | null): ThinkingOption[] {
	if (!model || model.supportsThinking === false) {
		return [];
	}

	if (model.thinkingOptions !== undefined) {
		return model.thinkingOptions;
	}

	const id = (model.modelId || model.id || "").toLowerCase();

	/*
	 * Google before anything that matches on a word inside an id: a rule matching a bare `ultra`
	 * once reached past this one and offered `gemini-ultra` `minimal`, which Google's API rejects
	 * with an HTTP 400.
	 */
	if (id.includes("gemini") || id.includes("gemma")) {
		return DEFAULT_THINKING_OPTIONS;
	}

	// DeepSeek's /models declares low/high/max, default high (2026-10-21); none also disables
	// reasoning in live Chat Completions checks. Keep legacy V3/R1 and lookalike names on the fallback.
	if (/(?:^|[^a-z0-9])deepseek-(?:v4-(?:flash|pro)|v4\.1-flash|flash)(?=$|[^a-z0-9])/.test(id)) {
		return DEEPSEEK_V4;
	}

	// Compatibility fallback for unrecognised relay aliases, not a provider capability claim.
	return OPENAI_FAMILIES.find(([pattern]) => pattern.test(id))?.[1] ?? DEFAULT_THINKING_OPTIONS;
}

/**
 * The option a chosen level comes to on this model — what the menu shows and what is sent.
 *
 * A level the model lacks moves to the nearest one it has, deeper first, then shallower (pi's
 * `clampThinkingLevel` rule). The level is a person's choice that outlives a model switch: `max`
 * picked on GPT-6.1 Sol becomes `xhigh` on GPT-5.5 rather than its default `medium`, and is `max`
 * again on the way back.
 *
 * `off` on a model that cannot stop reasoning comes to its shallowest level, which is OpenAI's own
 * advice for GPT-6 Astra and GPT-6.1 Sol. Sending `none` there is a 400; leaving `reasoning` out runs
 * the vendor default, `medium` — the opposite of what the "no thinking" switch asked for. Moving up
 * never lands on `off`: asking for some reasoning is not met by none. Only ids outside the standard
 * line fall back to the model's default.
 *
 * `undefined` is reasoning off: the model has no levels, or `off` was asked of a configured ladder
 * that does not list it. Such a ladder lists what can be picked while the model reasons — nothing
 * says it cannot stop, and turning reasoning off is the separate switch it always was. Only a
 * built-in ladder without `off` is a fact about the API.
 */
export function resolveThinkingOption(level: ThinkingLevel | undefined, model?: ModelConfig | null): ThinkingOption | undefined {
	const options = resolveModelThinkingOptions(model);
	const wanted = level ?? "off";
	const exact = options.find((option) => option.id === wanted);
	if (exact) return exact;
	if (wanted === "off" && model?.thinkingOptions !== undefined) return undefined;
	const rank = THINKING_LEVELS.indexOf(wanted);
	if (rank !== -1) {
		const shallower = THINKING_LEVELS.slice(0, rank).reverse().filter((candidate) => candidate !== "off");
		for (const candidate of [...THINKING_LEVELS.slice(rank + 1), ...shallower]) {
			const found = options.find((option) => option.id === candidate);
			if (found) return found;
		}
	}
	return options.find((option) => option.isDefault) ?? options[0];
}

/** The effort sent for a chosen level; `undefined` means reasoning off. Always the level the menu shows. */
export function resolveReasoningEffort(level: ThinkingLevel | undefined, model?: ModelConfig | null): string | undefined {
	const selected = resolveThinkingOption(level, model);
	return selected && selected.id !== "off" ? selected.id : undefined;
}
