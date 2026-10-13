/**
 * What the gallery has read, and which picture is open in it.
 *
 * Module state rather than the page's: the page is retained while hidden and torn down when the window
 * is short of room for it (`RetainedViews`), and coming back to an empty page that reads everything
 * again would flash a skeleton over pictures that had been on screen a moment ago.
 */

import type { Gallery } from "@lyra/core";
import { create } from "zustand";
import { bridge } from "../../services/index.ts";

interface GalleryState {
	gallery: Gallery | null;
	/** `loading` only until there is something to show; a later read refreshes what is there in place. */
	status: "idle" | "loading" | "ready" | "error";
	error: string;
	/** The picture open in the detail, by `session-media` name. */
	open: string | null;
	query: string;
}

export const useGallery = create<GalleryState>(() => ({ gallery: null, status: "idle", error: "", open: null, query: "" }));

let reading: Promise<void> | null = null;
let again = false;

/**
 * Read the list again. A call while a read is out makes that read go round once more instead of
 * starting a second one: a drawing that lands halfway through a read is then still picked up.
 */
export function refreshGallery(): Promise<void> {
	if (reading) {
		again = true;
		return reading;
	}
	reading = (async () => {
		do {
			again = false;
			useGallery.setState((state) => (state.gallery ? state : { status: "loading" }));
			try {
				const gallery = await bridge.gallery.list();
				useGallery.setState({ gallery, status: "ready", error: "" });
				arrived(gallery);
			} catch (error) {
				useGallery.setState((state) => ({ status: state.gallery ? "ready" : "error", error: error instanceof Error ? error.message : String(error) }));
			}
		} while (again);
	})().finally(() => {
		reading = null;
	});
	return reading;
}

export function openPicture(media: string | null): void {
	useGallery.setState({ open: media });
}

export function setGalleryQuery(query: string): void {
	useGallery.setState({ query });
}

/** An edit sent from the gallery, waited for so the gallery can open on its result. */
let awaiting: { from: string; since: number } | null = null;

/** How long an edit is waited for; a reply that asks a question instead of drawing should not hijack the gallery later. */
const AWAIT_MS = 10 * 60_000;

export function awaitEdit(from: string): void {
	awaiting = { from, since: Date.now() };
}

/**
 * The picture an awaited edit produced, opened in place of the one it was made from — but only while
 * that one is still what is open: someone who has moved on to another picture is not pulled back.
 */
function arrived(gallery: Gallery): void {
	if (!awaiting) return;
	if (Date.now() - awaiting.since > AWAIT_MS) {
		awaiting = null;
		return;
	}
	const { from, since } = awaiting;
	// Made from the picture itself, or from a marked-up copy of it: the copy is what the edit was given.
	const copies = new Set(gallery.inputs.filter((input) => input.from === from).map((input) => input.media));
	const made = gallery.pictures
		.filter((picture) => picture.at >= since && picture.sources.some((source) => source === from || copies.has(source)))
		.sort((a, b) => a.at - b.at)[0];
	if (!made) return;
	awaiting = null;
	if (useGallery.getState().open === from) useGallery.setState({ open: made.media });
}
