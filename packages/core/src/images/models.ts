/**
 * Which configured models draw pictures or make videos, and which one a request means.
 *
 * Browser-safe on purpose (`@lyra/core/image-models`): the chat picker has to leave these out, the
 * settings page and the composer's model button have to list them, and all three are the renderer.
 * Nothing here imports a value.
 */

import type { ModelConfig, ProviderConfig, VideoApi } from "../types/provider.ts";

/** What a generating model makes. A model that makes neither is one you chat with. */
export type MediaKind = "image" | "video";

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video"];

/** `VideoApi` as a list, for the model editor's menu. `auto` first: it is what an unset model gets. */
export const VIDEO_APIS: readonly VideoApi[] = ["auto", "xai", "ark", "openai", "veo", "dashscope"];

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

/*
 * Model ids that name a video model.
 *
 * Read before the image list, because a house that does both names them alike — `grok-imagine-video`
 * beside `grok-imagine-image`, `wanx2.1-t2v` beside `wanx2.1-t2i` — and a video model offered to the
 * chat picker fails the first request of every turn it is chosen for.
 *
 * The houses by their line names (`veo`, `sora`, `kling`, `seedance`, `hailuo`, `vidu`…), then the
 * spellings relays and open models use: `-video`, and `t2v`/`i2v`/`kf2v` for text-, image- and
 * keyframe-to-video. A digit may follow a line name directly (`seedance2.5`, `veo3`, `viduq1`).
 */
const VIDEO_MODEL_IDS: readonly RegExp[] = [
	/-video(?:[-.]|$)/,
	/(?:^|[/:-])(?:veo|sora|kling|seedance|hailuo|viduq?|pixverse|cogvideox?|mochi)(?:[-._\d]|$)/,
	/(?:^|[/:._-])(?:t2v|i2v|kf2v|r2v|s2v)(?:[-_]|$)/,
	/(?:^|[/:])jimeng_vgfm/,
];

export function isImageModelId(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	return IMAGE_MODEL_IDS.some((pattern) => pattern.test(id));
}

export function isVideoModelId(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	return VIDEO_MODEL_IDS.some((pattern) => pattern.test(id));
}

/** What a name says a model makes: video first, then image; null for a model you chat with. */
export function mediaKindOfId(modelId: string): MediaKind | null {
	if (isVideoModelId(modelId)) return "video";
	if (isImageModelId(modelId)) return "image";
	return null;
}

/**
 * What a model makes: a stored choice first, the name only when nobody has said.
 *
 * Each switch answers for its own kind. A stored `true` wins over whatever the name suggests; a stored
 * `false` only says "not this kind", so a model named like a video model with `videoOutput: false` is a
 * chat model, not an image model — that takes `imageOutput: true`. The editor keeps the two exclusive;
 * if both were ever stored, video wins, the same order the names are read in.
 */
export function mediaKind(model: Pick<ModelConfig, "modelId" | "imageOutput" | "videoOutput">): MediaKind | null {
	if (model.videoOutput === true) return "video";
	if (model.imageOutput === true) return "image";
	const named = mediaKindOfId(model.modelId);
	if (named === "video" && model.videoOutput !== false) return "video";
	if (named === "image" && model.imageOutput !== false) return "image";
	return null;
}

export function isImageModel(model: Pick<ModelConfig, "modelId" | "imageOutput" | "videoOutput">): boolean {
	return mediaKind(model) === "image";
}

export function isVideoModel(model: Pick<ModelConfig, "modelId" | "imageOutput" | "videoOutput">): boolean {
	return mediaKind(model) === "video";
}

/** Draws or films rather than talks: left out of every chat model picker and of the default chat model. */
export function isMediaModel(model: Pick<ModelConfig, "modelId" | "imageOutput" | "videoOutput">): boolean {
	return mediaKind(model) !== null;
}

export interface MediaModelRow {
	provider: ProviderConfig;
	model: ModelConfig;
}

/** The name callers had before videos; the same row. */
export type ImageModelRow = MediaModelRow;

/** Every model of a kind on an enabled provider, in the order they are configured. */
export function mediaModelRows(providers: readonly ProviderConfig[] | undefined, kind: MediaKind): MediaModelRow[] {
	return (providers ?? [])
		.filter((provider) => provider.enabled)
		.flatMap((provider) => provider.models.filter((model) => mediaKind(model) === kind).map((model) => ({ provider, model })));
}

export function imageModelRows(providers: readonly ProviderConfig[] | undefined): MediaModelRow[] {
	return mediaModelRows(providers, "image");
}

const plain = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

/**
 * What to call a row in text the model reads, so that passing it back finds this row and no other.
 *
 * The model id alone while no other row shares it. Two providers offering the same id — two relays
 * both carrying `gpt-image-1` — get the provider beside it, the spelling `resolveMediaModel` accepts
 * back; this used to list `gpt-image-1 (A)` in an error and then not recognise it when the model did
 * exactly as told. Two providers that also share a name fall back to the local id, unique by construction.
 */
export function mediaModelLabel(row: MediaModelRow, rows: readonly MediaModelRow[]): string {
	const twins = rows.filter((other) => plain(other.model.modelId) === plain(row.model.modelId));
	if (twins.length <= 1) return row.model.modelId;
	const sameHouse = twins.filter((other) => plain(other.provider.name) === plain(row.provider.name));
	return sameHouse.length > 1 ? row.model.id : `${row.model.modelId} (${row.provider.name})`;
}

/** Every spelling a person or a model may use for a row, each enough on its own. */
function spellings(row: MediaModelRow): string[] {
	const { model, provider } = row;
	return [model.id, model.modelId, model.name, `${model.modelId} (${provider.name})`, `${model.name} (${provider.name})`, `${provider.name}/${model.modelId}`];
}

/**
 * The rows a name means in full — any spelling of the row, never a part of one.
 *
 * For `@` in a message, where a partial match would be a guess made on the person's behalf: `@grok`
 * is as likely to be an agent or a word as either of two grok models.
 */
export function rowsNamed(rows: readonly MediaModelRow[], name: string): MediaModelRow[] {
	const key = plain(name);
	if (!key) return [];
	return rows.filter((row) => row.model.id === name.trim() || spellings(row).some((spelling) => plain(spelling) === key));
}

/** Where a pick came from, from the most specific to the fallback. */
export type MediaPickSource = "asked" | "session" | "default" | "auto";

/** The two stored picks a request may lean on before the first model of the kind. */
export interface MediaChoice {
	/** This conversation's pick (`SessionMeta.imageModelId` / `videoModelId`); absent follows the default. */
	session?: string | null;
	/** The settings' default for the kind (`Settings.imageModelId` / `videoModelId`). */
	preferred?: string | null;
}

export type MediaPick =
	| {
			row: MediaModelRow;
			source: MediaPickSource;
			/**
			 * Stored picks that were passed over because they no longer resolve — a deleted model, a
			 * disabled provider, a project config pointing at something this machine never had. The
			 * request still goes ahead on the next level down; this is so the button can say so.
			 */
			stale?: Array<"session" | "default">;
	  }
	| { row?: undefined; reason: "none" | "unknown" | "ambiguous"; candidates: MediaModelRow[] };

/**
 * The model a request means.
 *
 * `asked` is whatever the conversation named — "gpt-image-2.5", "Nano Banana", `gpt-image-1 (Relay)` —
 * so it is matched the way a person would mean it: any full spelling of a row, then a unique partial
 * match. An ambiguous or unknown name is not quietly replaced: the person asked for a particular model,
 * and drawing with another one is the wrong answer billed to them.
 *
 * Without `asked`: this conversation's pick, then the default, then the first model of the kind. A
 * stored pick that no longer resolves is stepped over and reported in `stale` — unlike a name just
 * asked for, it is an old instruction about a model that has since gone, and refusing to draw at all
 * would punish the person for having deleted it.
 */
export function resolveMediaModel(
	providers: readonly ProviderConfig[] | undefined,
	kind: MediaKind,
	choice: MediaChoice,
	asked?: string,
): MediaPick {
	const rows = mediaModelRows(providers, kind);
	if (rows.length === 0) return { reason: "none", candidates: [] };
	const wanted = asked?.trim();
	if (wanted) {
		const key = plain(wanted);
		const exact = rows.filter((row) => row.model.id === wanted || spellings(row).some((name) => plain(name) === key));
		if (exact.length === 1) return { row: exact[0], source: "asked" };
		const partial = exact.length > 1 ? exact : rows.filter((row) => plain(row.model.modelId).includes(key) || plain(row.model.name).includes(key));
		if (partial.length === 1) return { row: partial[0], source: "asked" };
		return { reason: partial.length > 1 ? "ambiguous" : "unknown", candidates: partial.length > 1 ? partial : rows };
	}
	const stale: Array<"session" | "default"> = [];
	for (const [source, id] of [["session", choice.session], ["default", choice.preferred]] as const) {
		if (!id) continue;
		const row = rows.find((candidate) => candidate.model.id === id);
		if (row) return { row, source, ...(stale.length ? { stale } : {}) };
		stale.push(source);
	}
	return { row: rows[0], source: "auto", ...(stale.length ? { stale } : {}) };
}

/** `resolveMediaModel` for pictures with only a default, as it was before conversations had their own pick. */
export function resolveImageModel(
	providers: readonly ProviderConfig[] | undefined,
	preferred: string | null | undefined,
	asked?: string,
): { row: MediaModelRow } | { row?: undefined; reason: "none" | "unknown" | "ambiguous"; candidates: MediaModelRow[] } {
	const pick = resolveMediaModel(providers, "image", { preferred }, asked);
	return pick.row ? { row: pick.row } : pick;
}
