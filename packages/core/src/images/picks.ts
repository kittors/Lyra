/**
 * Which image and video model a conversation's next drawing uses — read when it is drawn.
 *
 * Three things a person can do to choose, and all of them land in the same place, the conversation's
 * pick (`SessionMeta.imageModelId` / `videoModelId`): pick from the composer's button, `@` a model in
 * the message, or ask for a drawing by name. Above it sits a name asked for in the call itself; below
 * it the default in settings and then the first model of the kind (`resolveMediaModel`).
 *
 * Everything is read at the moment of drawing, not when the turn began. A person who switches models
 * while the agent is halfway through a set of drawings means the rest of the set — the rule ADR-0025
 * set for chat models, and the one a drawing captured at turn start used to break.
 */

import type { Settings } from "../config/settings.ts";
import { type MediaKind, type MediaModelRow, type MediaPick, mediaModelLabel, mediaModelRows, resolveMediaModel, rowsNamed } from "./models.ts";

/** A conversation's own picks, as they stand now. */
export interface ConversationPicks {
	get(kind: MediaKind): string | null | undefined;
	/**
	 * Write the pick. Absent where a drawing must not move it: a sub-agent draws with its parent's
	 * pick and names models for its own calls, but the conversation is the parent's to change.
	 */
	set?(kind: MediaKind, modelId: string | null): void;
}

/** What a drawing reads its model from: the settings as they are now, and the conversation's picks. */
export interface MediaSource {
	settings(): Pick<Settings, "providers" | "imageModelId" | "videoModelId">;
	picks?: ConversationPicks;
}

/** The model a request means, read now. */
export function pickMedia(source: MediaSource, kind: MediaKind, asked?: string): MediaPick {
	const settings = source.settings();
	const preferred = kind === "video" ? settings.videoModelId : settings.imageModelId;
	return resolveMediaModel(settings.providers, kind, { session: source.picks?.get(kind), preferred }, asked);
}

/** Every model of a kind, by the name the model can pass back; `pictures` keeps those that take pictures in. */
export function mediaNames(source: MediaSource, kind: MediaKind, filter: { pictures?: boolean } = {}): string[] {
	const rows = mediaModelRows(source.settings().providers, kind);
	return rows.filter((row) => !filter.pictures || row.model.supportsImages !== false).map((row) => mediaModelLabel(row, rows));
}

/** The sentence for the model when a name found nothing, too much, or there is nothing left to draw with. */
export function pickProblem(kind: MediaKind, asked: string | undefined, pick: Extract<MediaPick, { reason: string }>): string {
	const noun = kind === "video" ? "video model" : "image model";
	if (pick.reason === "none") return `No ${noun} is configured any more. Tell the user to add one in Settings → Models.`;
	const all = pick.candidates;
	const names = all.map((row) => mediaModelLabel(row, all)).join(", ");
	return pick.reason === "ambiguous"
		? `"${asked}" matches more than one ${noun}: ${names}. Pass one of these exactly as written.`
		: `No ${noun} called "${asked}" is configured. Available: ${names}. Use one of these, or tell the user to add the model in Settings → Models.`;
}

/**
 * A drawing the model asked for by name went through, so the conversation now uses that model.
 *
 * 「用 grok 画」 followed by 「再暖一点」 means grok again: the person chose a model, and the edit after
 * it is the same piece of work. It used to fall back to the default, because a name only ever reached
 * the one call it was written in. But one reply that names two models of a kind is a comparison, not a
 * choice — 「两个模型各画一张」 — so once a turn has named more than one, the pick goes back to what it
 * was before the first. Per turn, which is what one of these lives for (`turn-config.ts`).
 */
export class NamedPicks {
	private readonly picks: ConversationPicks | undefined;
	private readonly named = new Map<MediaKind, Set<string>>();
	private readonly before = new Map<MediaKind, string | null>();

	constructor(picks: ConversationPicks | undefined) {
		this.picks = picks;
	}

	adopt(kind: MediaKind, modelId: string): void {
		const picks = this.picks;
		if (!picks?.set) return;
		if (!this.before.has(kind)) this.before.set(kind, picks.get(kind) ?? null);
		const names = this.named.get(kind) ?? new Set<string>();
		names.add(modelId);
		this.named.set(kind, names);
		picks.set(kind, names.size === 1 ? modelId : (this.before.get(kind) ?? null));
	}
}

/*
 * `@` the way the composer writes it: `@"spaced name"`, `@'spaced name'`, or a bare run of the
 * characters model ids are made of. Bare runs stop at anything else, so `@grok-imagine-image，画一只猫`
 * is the model and then the sentence; a trailing `.` or `:` belongs to the sentence too.
 */
const MENTION = /(?:^|\s)@(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z0-9][A-Za-z0-9._:/+-]*))/g;

/**
 * The models a message names with `@`, by kind — each only when it is the one model of its kind
 * named, the same rule a reply that names two follows.
 *
 * `reserved` are the names `@` already means something else for (agents, `@compact`, model roles):
 * those keep their meaning even if a model happens to share it.
 */
export function mentionedMedia(text: string, rows: { image: readonly MediaModelRow[]; video: readonly MediaModelRow[] }, reserved: ReadonlySet<string>): Partial<Record<MediaKind, MediaModelRow>> {
	const found: Record<MediaKind, Map<string, MediaModelRow>> = { image: new Map(), video: new Map() };
	for (const match of text.matchAll(MENTION)) {
		const name = (match[1] ?? match[2] ?? match[3]?.replace(/[.:]+$/, "") ?? "").trim();
		if (!name || reserved.has(name.toLowerCase())) continue;
		for (const kind of ["image", "video"] as const) {
			const named = rowsNamed(rows[kind], name);
			if (named.length === 1) found[kind].set(named[0].model.id, named[0]);
		}
	}
	const picked: Partial<Record<MediaKind, MediaModelRow>> = {};
	for (const kind of ["image", "video"] as const) {
		if (found[kind].size === 1) picked[kind] = [...found[kind].values()][0];
	}
	return picked;
}
