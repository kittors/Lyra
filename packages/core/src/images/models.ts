/**
 * Which configured models draw pictures, and which one a request means.
 *
 * Browser-safe on purpose (`@lyra/core/image-models`): the chat picker has to leave these out and the
 * settings page has to list them, and both are the renderer. Nothing here imports a value.
 */

import type { ModelConfig, ProviderConfig } from "../types/provider.ts";

/*
 * Model ids that name an image model.
 *
 * By name because nothing else says so: the offline catalogue drops every model whose output is not
 * text (`scripts/update-model-catalog.mjs`), and the relays this app is pointed at list only their chat
 * models on `/v1/models`. A name is a weak signal, which is why it is only the default — the model
 * editor has the switch, and a stored `imageOutput` always wins over this.
 *
 * `-image` catches the family that writes and draws (`gemini-2.5-flash-image`, `gemini-3-pro-image-
 * preview`, `gpt-5-image`, `grok-2-image`, `qwen-image`); the rest are image-only houses and lines.
 */
const IMAGE_MODEL_IDS: readonly RegExp[] = [
	/(?:^|[/:])(?:gpt-image|chatgpt-image|dall-e)(?:-|$)/,
	/(?:^|[/:-])imagen(?:-|$)/,
	/-image(?:-|$)/,
	/(?:^|[/:-])(?:nano-banana|flux|seedream|seededit|recraft|ideogram|midjourney|kolors|cogview|wanx|jimeng|stable-diffusion|sdxl|sd3)(?:[-.]|$)/,
];

export function isImageModelId(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	return IMAGE_MODEL_IDS.some((pattern) => pattern.test(id));
}

/** A stored choice first; the name only when nobody has said. */
export function isImageModel(model: Pick<ModelConfig, "modelId" | "imageOutput">): boolean {
	return model.imageOutput ?? isImageModelId(model.modelId);
}

export interface ImageModelRow {
	provider: ProviderConfig;
	model: ModelConfig;
}

/** Every image model on an enabled provider, in the order they are configured. */
export function imageModelRows(providers: readonly ProviderConfig[] | undefined): ImageModelRow[] {
	return (providers ?? [])
		.filter((provider) => provider.enabled)
		.flatMap((provider) => provider.models.filter(isImageModel).map((model) => ({ provider, model })));
}

const plain = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

/**
 * The image model a call means.
 *
 * `asked` is whatever the conversation named — "gpt-image-2.5", "Nano Banana" — so it is matched the
 * way a person would mean it: the local id, then the provider's id or the display name exactly, then
 * a unique partial match. An ambiguous or unknown name is not quietly replaced by the default: the
 * person asked for a particular model, and drawing with another one is the wrong answer billed to them.
 *
 * Without `asked`, the configured default (`Settings.imageModelId`) if it still resolves, else the
 * first image model there is.
 */
export function resolveImageModel(
	providers: readonly ProviderConfig[] | undefined,
	preferred: string | null | undefined,
	asked?: string,
): { row: ImageModelRow } | { row?: undefined; reason: "none" | "unknown" | "ambiguous"; candidates: ImageModelRow[] } {
	const rows = imageModelRows(providers);
	if (rows.length === 0) return { reason: "none", candidates: [] };
	const wanted = asked?.trim();
	if (wanted) {
		const key = plain(wanted);
		const exact = rows.filter((row) => row.model.id === wanted || plain(row.model.modelId) === key || plain(row.model.name) === key);
		if (exact.length === 1) return { row: exact[0] };
		const partial = exact.length > 1 ? exact : rows.filter((row) => plain(row.model.modelId).includes(key) || plain(row.model.name).includes(key));
		if (partial.length === 1) return { row: partial[0] };
		return { reason: partial.length > 1 ? "ambiguous" : "unknown", candidates: partial.length > 1 ? partial : rows };
	}
	return { row: rows.find((row) => row.model.id === preferred) ?? rows[0] };
}
