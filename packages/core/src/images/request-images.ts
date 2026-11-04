/**
 * The pictures one request actually carries — decided at the last moment, for the model it goes to.
 *
 * Runs on every request (`ai/index.ts`), after the history is final and before an adapter turns it
 * into JSON. Two things happen here:
 *
 *   1. Each picture is fitted to what this model looks at. Pictures were already fitted once when they
 *      entered the conversation (`fit-entry.ts`), so for most models this is a header read and nothing
 *      else; Claude's standard tier looks at 1568 px and gets 1568 px. Conversations saved before
 *      pictures were fitted on the way in get fitted here instead.
 *   2. The history's pictures are budgeted (`request-budget.ts`): old ones become gists, then a line.
 *
 * Nothing here changes the conversation. The messages handed in are not modified; the request gets
 * new ones where something was replaced. The transcript, the store and the window keep every picture.
 *
 * Without a codec (the CLI) nothing can be shrunk, so a picture that a provider would refuse — an
 * unknown format, too many bytes, too many pixels — goes as a line saying so. One refused picture is
 * not one failed request: it stays in the history and fails every request after it.
 */

import { createHash } from "node:crypto";
import type { ImageContent, LlmContext, Message, ModelConfig, UserContent } from "../types.ts";
import { imageCodec, type ImageCodec } from "./codec.ts";
import { imageDimensions, type Dimensions } from "./dimensions.ts";
import { base64Bytes, imageStyle, SAFE_IMAGE_TYPES, withinLimits, type FitLimits } from "./fit.ts";
import { DEFAULT_IMAGE_BUDGET, planImageTiers, type BudgetMessage, type ImageBudget, type ImageTier } from "./request-budget.ts";
import { ENTRY_LIMITS, GIST_LIMITS } from "./shrink.ts";

interface RequestProfile {
	/** What pictures are fitted to when a codec can do it: the most this model looks at. */
	fit: FitLimits;
	accepted: ReadonlySet<string>;
	/** Decoded bytes one picture may have: 5 MiB once base64-encoded (Bedrock, and relays in front of it). */
	maxBytes: number;
	/** Pictures one request may carry. Anthropic's 200k-context models stop at 100; 90 leaves room. */
	maxImages: number;
	/** All pictures together. Bedrock and Gemini's inline data stop at 20 MB for the whole request. */
	maxTotalBytes: number;
}

const HARD_PICTURE_BYTES = ENTRY_LIMITS.maxBytes;
/** Without a codec the provider does the scaling — up to its own limit, and Anthropic's tighter one past 20 pictures. */
const HARD_EDGE = 8000;
const MANY_PICTURES = 20;
const MANY_PICTURES_EDGE = 2000;

/**
 * Claude before 4.7 looks at 1568 px on the long side and at most 1568 visual tokens of 28×28; anything
 * larger is scaled away on arrival. The token cap is an area: 1456×819 is the docs' own answer for 1920×1080.
 */
const CLAUDE_STANDARD: FitLimits = { maxEdge: 1568, maxPixels: 1456 * 819 };

/**
 * Claude's standard-resolution models: everything before 4.7.
 *
 * Read from the model id, the only thing a relay passes through. Both namings are in use —
 * `claude-opus-4-6-thinking`, `claude-3-5-sonnet-20241022` — and a date suffix must not be taken for
 * a version (`claude-sonnet-4-20250514` is 4.0).
 */
export function claudeStandardTier(modelId: string): boolean {
	const id = modelId.toLowerCase();
	if (!/claude|opus|sonnet|haiku/.test(id) || /fable|mythos/.test(id)) return false;
	const named = /(opus|sonnet|haiku)[-_ ]?(\d{1,2})(?!\d)(?:[-_.](\d{1,2})(?!\d))?/.exec(id);
	const numbered = /claude[-_ ](\d)(?!\d)(?:[-_.](\d)(?!\d))?[-_ ](opus|sonnet|haiku)/.exec(id);
	const major = Number(named?.[2] ?? numbered?.[1]);
	const minor = Number(named?.[3] ?? numbered?.[2] ?? 0);
	if (!Number.isFinite(major)) return false;
	return major < 4 || (major === 4 && minor < 7);
}

function profileFor(model: ModelConfig): RequestProfile {
	const id = `${model.modelId} ${model.id}`.toLowerCase();
	// GIF goes to the two that say they take it; Gemini does not, and nothing is known of the rest.
	const gif = /claude|opus|sonnet|haiku|fable|gpt|chatgpt/.test(id) && !/gemini/.test(id);
	return {
		fit: claudeStandardTier(model.modelId) ? CLAUDE_STANDARD : { maxEdge: ENTRY_LIMITS.maxEdge, maxPixels: ENTRY_LIMITS.maxPixels },
		accepted: gif ? new Set([...SAFE_IMAGE_TYPES, "image/gif"]) : SAFE_IMAGE_TYPES,
		maxBytes: HARD_PICTURE_BYTES,
		maxImages: 90,
		maxTotalBytes: 16 * 1024 * 1024,
	};
}

/** `image/jpg` is a common way to write `image/jpeg`, not a different format. */
function mimeOf(part: ImageContent): string {
	const mime = part.mimeType.toLowerCase().trim();
	return mime === "image/jpg" ? "image/jpeg" : mime;
}

// ---------------------------------------------------------------------------
// Per picture, cached: the same picture is asked about on every request.
// ---------------------------------------------------------------------------

const sizes = new WeakMap<ImageContent, Dimensions | null>();
const identities = new WeakMap<ImageContent, string>();

/** A JPEG's size can sit behind a large EXIF or colour-profile block, so a short prefix is not always enough. */
const HEADER_CHARS = 349_524;

function sizeOf(part: ImageContent): Dimensions | null {
	if (sizes.has(part)) return sizes.get(part) ?? null;
	let size = imageDimensions(new Uint8Array(Buffer.from(part.data.slice(0, HEADER_CHARS), "base64")));
	if (!size && part.data.length > HEADER_CHARS) size = imageDimensions(new Uint8Array(Buffer.from(part.data, "base64")));
	sizes.set(part, size);
	return size;
}

function identityOf(part: ImageContent): string {
	const known = identities.get(part);
	if (known) return known;
	// A stored picture is already named by the hash of its bytes.
	const id = part.media || createHash("sha1").update(part.data).digest("hex");
	identities.set(part, id);
	return id;
}

type Fitted = { kind: "image"; part: ImageContent; bytes: number; size: Dimensions | null } | { kind: "note"; text: string };

/** Fitted and gist copies, newest last. Bounded by count and by total size, like Codex's (32 entries / 64 MiB). */
const cache = new Map<string, Fitted>();
const CACHE_ENTRIES = 64;
const CACHE_CHARS = 64 * 1024 * 1024;
let cachedChars = 0;

const charsOf = (value: Fitted | undefined) => (value?.kind === "image" ? value.part.data.length : 0);

function remember(key: string, value: Fitted): Fitted {
	cachedChars -= charsOf(cache.get(key));
	cache.delete(key);
	cache.set(key, value);
	cachedChars += charsOf(value);
	while (cache.size > CACHE_ENTRIES || cachedChars > CACHE_CHARS) {
		const oldest = cache.keys().next().value as string;
		cachedChars -= charsOf(cache.get(oldest));
		cache.delete(oldest);
	}
	return value;
}

function recall(key: string): Fitted | undefined {
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
	}
	return hit;
}

/** For tests: forget every fitted copy. */
export function clearRequestImageCache(): void {
	cache.clear();
	cachedChars = 0;
}

function unsendable(part: ImageContent, size: Dimensions | null, why: string): Fitted {
	const shape = [mimeOf(part).replace("image/", "").toUpperCase(), size ? `${size.width}x${size.height}` : "", `${Math.round(base64Bytes(part.data) / 1024)} KB`].filter(Boolean).join(", ");
	return { kind: "note", text: `[image omitted: ${why} (${shape})]` };
}

/**
 * What a picture costs before any pixel is touched — enough to budget it.
 *
 * `bytes` is what the budget counts, and it is a function of the picture alone: its own size when it
 * goes as it is, otherwise the soft target it will be fitted to. Not the fitted size, even when that
 * is cached — then the budget would read differently on the request after the cache filled, and an
 * old picture could step back up, changing the prefix the prompt cache holds.
 */
type Look = { kind: "ready"; fitted: Extract<Fitted, { kind: "image" }>; bytes: number } | { kind: "work"; bytes: number; size: Dimensions | null } | { kind: "note"; note: Fitted };

function look(part: ImageContent, profile: RequestProfile, codec: ImageCodec | null, many: boolean): Look {
	const mime = mimeOf(part);
	const bytes = base64Bytes(part.data);
	const size = sizeOf(part);
	const accepted = profile.accepted.has(mime);
	if (!codec) {
		// The provider scales what it takes; what it would refuse is said instead of sent.
		const edge = many ? MANY_PICTURES_EDGE : HARD_EDGE;
		if (!accepted) return { kind: "note", note: unsendable(part, size, `${mime} is not a format this model accepts, and this host cannot convert it`) };
		if (bytes > profile.maxBytes || !size || Math.max(size.width, size.height) > edge) {
			return { kind: "note", note: unsendable(part, size, "too large to send, and this host cannot shrink pictures") };
		}
		return { kind: "ready", fitted: { kind: "image", part, bytes, size }, bytes };
	}
	if (accepted && size && withinLimits(size, profile.fit) && bytes <= ENTRY_LIMITS.softBytes) return { kind: "ready", fitted: { kind: "image", part, bytes, size }, bytes };
	return { kind: "work", bytes: Math.min(bytes, ENTRY_LIMITS.softBytes), size };
}

/** The pixel work, for a picture that is going at full size. Cached: the same picture is in every request after this one. */
async function fitPicture(part: ImageContent, profile: RequestProfile, codec: ImageCodec): Promise<Fitted> {
	const mime = mimeOf(part);
	const key = `${identityOf(part)}:fit:${profile.fit.maxEdge}:${profile.fit.maxPixels}`;
	const hit = recall(key);
	if (hit) return hit;
	const accepted = profile.accepted.has(mime);
	const shrunk = await codec
		.shrink(
			{ data: new Uint8Array(Buffer.from(part.data, "base64")), mimeType: mime },
			{ ...profile.fit, softBytes: ENTRY_LIMITS.softBytes, maxBytes: profile.maxBytes, style: imageStyle(mime) },
		)
		.catch(() => null);
	if (!shrunk) return remember(key, unsendable(part, sizeOf(part), accepted ? "it could not be made small enough to send" : `${mime} could not be converted to a format this model accepts`));
	if (!shrunk.changed) return remember(key, { kind: "image", part, bytes: base64Bytes(part.data), size: sizeOf(part) });
	const data = Buffer.from(shrunk.data).toString("base64");
	return remember(key, { kind: "image", part: { type: "image", data, mimeType: shrunk.mimeType }, bytes: shrunk.data.length, size: { width: shrunk.width, height: shrunk.height } });
}

async function gistOf(part: ImageContent, codec: ImageCodec): Promise<Extract<Fitted, { kind: "image" }> | null> {
	const key = `${identityOf(part)}:gist`;
	const hit = recall(key);
	if (hit) return hit.kind === "image" ? hit : null;
	const shrunk = await codec
		.shrink({ data: new Uint8Array(Buffer.from(part.data, "base64")), mimeType: mimeOf(part) }, { ...GIST_LIMITS, style: "gist" })
		.catch(() => null);
	if (!shrunk) return null;
	const data = Buffer.from(shrunk.data).toString("base64");
	const gist = { kind: "image" as const, part: { type: "image" as const, data, mimeType: shrunk.mimeType }, bytes: shrunk.data.length, size: { width: shrunk.width, height: shrunk.height } };
	remember(key, gist);
	return gist;
}

// ---------------------------------------------------------------------------
// What the model is told in place of a picture
// ---------------------------------------------------------------------------

const sized = (size: Dimensions | null) => (size ? ` (${size.width}x${size.height})` : "");

/** opencode's advice, kept: say it is gone, say not to guess, say how to get it back. */
export function omittedNote(size: Dimensions | null): string {
	return `[An earlier image${sized(size)} was left out of this request to keep it small. You cannot see it now, so do not describe it from memory. If you need it, capture it again with your tools or ask the user to attach it again.]`;
}

export function gistNote(size: Dimensions | null): string {
	return `[A reduced copy of an earlier image${sized(size)}, sent small to keep the request small. Fine detail and small text in it may not be readable; if you need them, capture it again or ask the user to attach it again.]`;
}

// ---------------------------------------------------------------------------

interface Slot {
	message: number;
	part: number;
	image: ImageContent;
}

function slotsOf(messages: readonly Message[]): Slot[] {
	const slots: Slot[] = [];
	for (const [m, message] of messages.entries()) {
		if (message.role !== "user" && message.role !== "toolResult") continue;
		for (const [p, part] of (message.content as UserContent[]).entries()) {
			if (part.type === "image" && part.data) slots.push({ message: m, part: p, image: part });
		}
	}
	return slots;
}

function budgetMessages(messages: readonly Message[]): BudgetMessage[] {
	return messages.map((message) =>
		message.role === "assistant" ? { role: "assistant", endsTurn: !message.content.some((part) => part.type === "toolCall") } : { role: message.role },
	);
}

export function hasRequestImages(messages: readonly Message[]): boolean {
	return messages.some((message) => (message.role === "user" || message.role === "toolResult") && message.content.some((part) => part.type === "image" && part.data));
}

/**
 * The context this request should send. Returns `context` itself when no picture needed changing.
 */
export async function prepareRequestImages(
	context: LlmContext,
	model: ModelConfig,
	options: { codec?: ImageCodec | null; budget?: ImageBudget } = {},
): Promise<LlmContext> {
	// A model that cannot see gets a placeholder from its adapter; shrinking for it would be work for nothing.
	if (model.supportsImages === false) return context;
	const slots = slotsOf(context.messages);
	if (slots.length === 0) return context;
	const codec = options.codec === undefined ? imageCodec() : options.codec;
	const profile = profileFor(model);
	const many = slots.length > MANY_PICTURES;

	// Budgeted before any pixel work: an old conversation's hundred originals are not decoded to be dropped.
	const looks = slots.map((slot) => look(slot.image, profile, codec, many));
	const sendable = looks.flatMap((seen, i) => (seen.kind === "note" ? [] : [i]));
	const tiers: ImageTier[] = looks.map((seen) => (seen.kind === "note" ? "note" : "full"));
	const planned = planImageTiers(
		budgetMessages(context.messages),
		sendable.map((i) => ({ bytes: (looks[i] as Exclude<Look, { kind: "note" }>).bytes, message: slots[i].message })),
		options.budget ?? DEFAULT_IMAGE_BUDGET,
		codec !== null,
	);
	for (const [k, i] of sendable.entries()) tiers[i] = planned[k];

	const sent: (Fitted | null)[] = slots.map(() => null);
	for (const [i, tier] of tiers.entries()) {
		const seen = looks[i];
		if (seen.kind === "note") sent[i] = seen.note;
		else if (tier === "full") sent[i] = seen.kind === "ready" ? seen.fitted : await fitPicture(slots[i].image, profile, codec as ImageCodec);
		else if (tier === "gist" && codec) sent[i] = await gistOf(slots[i].image, codec);
		if (tier === "gist" && !sent[i]) tiers[i] = "note";
		if (sent[i]?.kind === "note") tiers[i] = "note";
	}

	/*
	 * Past the provider's hard limits even after the budget — a person who attached a hundred pictures
	 * in one go — the oldest go regardless. A request certain to be refused helps no one.
	 */
	const weight = (i: number) => (tiers[i] !== "note" && sent[i]?.kind === "image" ? (sent[i] as Extract<Fitted, { kind: "image" }>).bytes : 0);
	let count = tiers.filter((tier) => tier !== "note").length;
	let total = tiers.reduce((sum, _tier, i) => sum + weight(i), 0);
	for (let i = 0; i < tiers.length && (count > profile.maxImages || total > profile.maxTotalBytes); i++) {
		if (tiers[i] === "note") continue;
		total -= weight(i);
		count -= 1;
		tiers[i] = "note";
	}
	// Without a codec nothing was scaled, so Anthropic's many-pictures rule is checked on what is left.
	if (!codec && !many && count > MANY_PICTURES) {
		for (const [i, tier] of tiers.entries()) {
			const seen = looks[i];
			if (tier === "full" && seen.kind === "ready" && seen.fitted.size && Math.max(seen.fitted.size.width, seen.fitted.size.height) > MANY_PICTURES_EDGE) {
				sent[i] = unsendable(slots[i].image, seen.fitted.size, "too large to send alongside this many images, and this host cannot shrink pictures");
			}
		}
	}

	const replaced = new Map<string, UserContent[]>();
	for (const [i, slot] of slots.entries()) {
		const tier = tiers[i];
		const out = sent[i];
		const original = sizeOf(slot.image);
		let parts: UserContent[];
		if (out?.kind === "note") parts = [{ type: "text", text: out.text }];
		else if (tier === "note" || !out) parts = [{ type: "text", text: omittedNote(original) }];
		else if (tier === "gist") parts = [{ type: "text", text: gistNote(original) }, out.part];
		else parts = [out.part];
		if (parts.length === 1 && parts[0] === slot.image) continue;
		replaced.set(`${slot.message}:${slot.part}`, parts);
	}
	if (replaced.size === 0) return context;

	const messages = context.messages.map((message, m) => {
		if (message.role !== "user" && message.role !== "toolResult") return message;
		if (!message.content.some((_part, p) => replaced.has(`${m}:${p}`))) return message;
		const content = (message.content as UserContent[]).flatMap((part, p) => replaced.get(`${m}:${p}`) ?? [part]);
		return { ...message, content } as Message;
	});
	return { ...context, messages };
}
