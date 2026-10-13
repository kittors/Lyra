/**
 * The gallery's data, arranged for the page: pictures by name, each one's family, and the search.
 *
 * `gallery.list` hands over what was drawn (`pictures`), what went into a drawing without being
 * drawn (`inputs` — an attachment, a screenshot) and the conversations both point into. The grid
 * shows only the drawings; a history starts wherever its oldest picture came from, input or not.
 */

import type { Gallery, GalleryInput, GalleryPicture, GallerySession } from "@lyra/core";
import { stripPlaceholders } from "../../lib/attachment-placeholders.ts";
import type { FamilyNode } from "../../lib/lineage-tree.ts";

export type Entry = ({ kind: "drawn" } & GalleryPicture) | ({ kind: "given" } & GalleryInput);

export interface GalleryIndex {
	/** Drawings, newest first: the grid's order, and the order ← and → step through. */
	drawn: Extract<Entry, { kind: "drawn" }>[];
	byMedia: ReadonlyMap<string, Entry>;
	sessions: ReadonlyMap<string, GallerySession>;
	/** Every picture as a node of the family graph, for `familyOf`. */
	nodes: ReadonlyMap<string, FamilyNode>;
}

export function indexGallery(gallery: Gallery): GalleryIndex {
	const byMedia = new Map<string, Entry>();
	for (const input of gallery.inputs) byMedia.set(input.media, { kind: "given", ...input });
	for (const picture of gallery.pictures) byMedia.set(picture.media, { kind: "drawn", ...picture });
	const nodes = new Map<string, FamilyNode>();
	for (const entry of byMedia.values()) {
		nodes.set(entry.media, {
			id: entry.media,
			at: entry.at,
			index: entry.kind === "drawn" ? entry.index : -1,
			// A marked-up copy hangs off the picture it was marked up on, so the history runs through the marks.
			parents: (entry.kind === "drawn" ? entry.sources : entry.from ? [entry.from] : []).filter((source) => byMedia.has(source)),
		});
	}
	const drawn = [...byMedia.values()]
		.filter((entry): entry is Extract<Entry, { kind: "drawn" }> => entry.kind === "drawn")
		.sort((a, b) => b.at - a.at || b.index - a.index);
	return { drawn, byMedia, sessions: new Map(gallery.sessions.map((session) => [session.id, session])), nodes };
}

/** What the person typed, without the 【图片 1】 marks their attachments left in it. */
export function askText(entry: Entry): string {
	const ask = entry.ask;
	if (!ask) return "";
	return stripPlaceholders(ask.text, ask.attachments).trim();
}

/** Matched against what was asked, the brief the model wrote, and the conversation's title. */
export function matches(entry: Entry, session: GallerySession | undefined, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	const haystack = [askText(entry), entry.kind === "drawn" ? entry.prompt : "", session?.title ?? ""].join("\n").toLocaleLowerCase();
	return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** The picture, or the drawing made from it when it is an input: what "show it in the conversation" scrolls to. */
export function drawingFor(entry: Entry, index: GalleryIndex): Extract<Entry, { kind: "drawn" }> | null {
	if (entry.kind === "drawn") return entry;
	return index.drawn.filter((picture) => picture.sources.includes(entry.media)).sort((a, b) => a.at - b.at)[0] ?? null;
}
