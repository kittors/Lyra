/**
 * Every picture drawn in every conversation, for the gallery: what `drawingsIn` finds, store-wide.
 *
 * A conversation is read again only when it has been written to since (`seq`), so opening the gallery
 * a second time costs the store's prefilter and nothing else.
 */

import type { SessionStorage } from "../session/storage.ts";
import type { SessionMeta } from "../session/types.ts";
import { drawingsIn, type Drawings, type DrawnPicture, type GivenPicture } from "./lineage.ts";
import { IMAGE_TOOL_NAME } from "./types.ts";

export interface GalleryPicture extends DrawnPicture {
	sessionId: string;
}

export interface GalleryInput extends GivenPicture {
	sessionId: string;
}

export interface GallerySession {
	id: string;
	title: string;
	projectName?: string;
	archived: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface Gallery {
	/** Oldest first. A picture a fork copied is listed once, in the conversation it was drawn in. */
	pictures: GalleryPicture[];
	/** Pictures that went into a drawing without being drawn: attachments, screenshots. */
	inputs: GalleryInput[];
	/** The conversations the two lists point into. */
	sessions: GallerySession[];
}

type Store = Pick<SessionStorage, "load" | "listSessions" | "sessionsWithResultOf">;

export class GalleryReader {
	private readonly store: Store;
	/** Each conversation's drawings, and how far it had been written when they were read. */
	private readonly read = new Map<string, { seq: number; drawings: Drawings }>();

	constructor(store: Store) {
		this.store = store;
	}

	async list(): Promise<Gallery> {
		const found = (await this.store.sessionsWithResultOf?.(IMAGE_TOOL_NAME)) ?? [];
		const metas = new Map((found.length ? await this.store.listSessions() : []).map((meta) => [meta.id, meta]));
		const live = new Set<string>();
		for (const { id, seq } of found) {
			const meta = metas.get(id);
			if (!meta) continue;
			live.add(id);
			if (this.read.get(id)?.seq === seq) continue;
			const loaded = await this.store.load(meta.projectId, id, { display: true });
			this.read.set(id, { seq, drawings: loaded ? drawingsIn(loaded.entries) : { drawn: [], given: [] } });
		}
		// Deleting the entry being visited is safe while iterating a Map.
		for (const id of this.read.keys()) if (!live.has(id)) this.read.delete(id);
		return gather(this.read, metas);
	}
}

function gather(read: ReadonlyMap<string, { drawings: Drawings }>, metas: ReadonlyMap<string, SessionMeta>): Gallery {
	// A fork copies its history, pictures included, and is always created after what it was forked
	// from: taking the oldest conversation first credits each picture to the one it was drawn in.
	const order = [...read.keys()]
		.filter((id) => metas.has(id))
		.sort((a, b) => (metas.get(a)?.createdAt ?? 0) - (metas.get(b)?.createdAt ?? 0) || a.localeCompare(b));
	const pictures = new Map<string, GalleryPicture>();
	for (const id of order) {
		for (const picture of read.get(id)?.drawings.drawn ?? []) if (!pictures.has(picture.media)) pictures.set(picture.media, { ...picture, sessionId: id });
	}
	// An attachment that is byte for byte a drawing is that drawing, attached again to be edited.
	const inputs = new Map<string, GalleryInput>();
	for (const id of order) {
		for (const input of read.get(id)?.drawings.given ?? []) {
			if (!pictures.has(input.media) && !inputs.has(input.media)) inputs.set(input.media, { ...input, sessionId: id });
		}
	}
	const used = new Set([...pictures.values(), ...inputs.values()].map((picture) => picture.sessionId));
	return {
		pictures: [...pictures.values()].sort((a, b) => a.at - b.at || a.index - b.index),
		inputs: [...inputs.values()],
		sessions: order.filter((id) => used.has(id)).map((id) => sessionOf(metas.get(id) as SessionMeta)),
	};
}

function sessionOf(meta: SessionMeta): GallerySession {
	return {
		id: meta.id,
		title: meta.title,
		projectName: meta.projectName,
		archived: meta.archived === true,
		createdAt: meta.createdAt,
		updatedAt: meta.updatedAt,
	};
}
