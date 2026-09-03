/**
 * Which house made this model.
 *
 * Lyra points at whatever endpoint you give it, so there is no vendor field to read — the only
 * things known about a model are the id you typed and the name you gave it. Both are matched,
 * because neither is reliable alone: a relay exposes `deepseek-v4-flash` with the display name
 * 「DeepSeek V4 Flash」, a gateway prefixes ids with `anthropic/`, and somebody's private proxy
 * calls the same model `fast`. Two chances to recognise it is better than one, and a wrong match
 * only ever costs a wrong logo, never a wrong request.
 *
 * Word boundaries matter more than they look. `o3` as a substring appears inside `qwen-o3`-style
 * ids that have nothing to do with OpenAI, and worse, inside version strings — so the short
 * OpenAI aliases are matched as whole words while the long unambiguous names are matched
 * anywhere. Chinese names are matched without boundaries: `\b` is defined on ASCII word
 * characters and never fires between two Han characters.
 *
 * Order is priority. `deepseek-v3` must not become OpenAI on the strength of a `v3`, so the
 * unambiguous vendors are asked first.
 */

export type Brand = "openai" | "claude" | "deepseek" | "gemini" | "qwen" | "grok" | "mistral" | "hunyuan" | "kimi" | "minimax" | "stepfun" | "baichuan" | "doubao" | "yi";

const RULES: { brand: Brand; test: RegExp }[] = [
	{ brand: "deepseek", test: /deepseek/ },
	{ brand: "claude", test: /claude|anthropic|\bopus\b|\bsonnet\b|\bhaiku\b/ },
	{ brand: "kimi", test: /kimi|moonshot/ },
	{ brand: "doubao", test: /doubao|豆包|skylark|ep-/ },
	{ brand: "minimax", test: /minimax|abab/ },
	{ brand: "stepfun", test: /stepfun|step-|阶跃/ },
	{ brand: "baichuan", test: /baichuan|百川/ },
	{ brand: "yi", test: /\byi-|\blingyi\b|零一万物/ },
	{ brand: "qwen", test: /qwen|qwq|qvq|tongyi|通义|千问/ },
	{ brand: "gemini", test: /gemini|gemma|\bpalm\b/ },
	{ brand: "grok", test: /\bgrok\b|\bxai\b/ },
	{ brand: "mistral", test: /mistral|mixtral|codestral|devstral|magistral|ministral|pixtral/ },
	{ brand: "hunyuan", test: /hunyuan|混元/ },
	// Last, and the only one needing whole-word care: `o3`/`o4` are two characters that turn up
	// inside plenty of ids that are not OpenAI's.
	{ brand: "openai", test: /openai|chatgpt|\bgpt|codex|davinci|\bo[1345](?:-[a-z]+)*\b/ },
];

/**
 * The brand behind a model, or null when nothing matches.
 *
 * Null is a normal answer, not a failure: self-hosted and fine-tuned models are named whatever
 * their owner felt like, and the caller draws a neutral mark for them.
 */
export function brandOf(modelId: string | null | undefined, displayName?: string | null): Brand | null {
	const haystack = `${modelId ?? ""} ${displayName ?? ""}`.toLowerCase();
	if (!haystack.trim()) return null;
	return RULES.find((rule) => rule.test.test(haystack))?.brand ?? null;
}
