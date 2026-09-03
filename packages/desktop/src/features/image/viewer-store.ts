/**
 * The one image viewer, and how anything asks for it.
 *
 * A store rather than a context provider with a hook per call site: images are opened from places
 * that have no relationship to each other — the composer's attachments, a sent message, a tool
 * result — and threading a provider through all of them to reach one overlay is ceremony for a
 * thing that is, in the end, a single piece of window furniture.
 *
 * The origin rectangle is the whole reason this is not just "show a big image". Opening records
 * where the thumbnail is on screen so the overlay can start life exactly there and grow to the
 * middle; closing plays it backwards. Without it the picture appears from nowhere, and the
 * relationship between the small thing you clicked and the big thing you got is left for you to
 * infer.
 */

import { useSyncExternalStore } from "react";

export interface ViewerImage {
	/** `data:` URL or an absolute one — whatever an `<img src>` will take. */
	src: string;
	alt?: string;
	/**
	 * Called when an annotated copy is saved, if this image can accept one.
	 *
	 * Absent means the image is a record of something already sent and cannot be edited in place;
	 * the viewer then offers to attach the annotated copy to the composer instead.
	 */
	onReplace?: (dataUrl: string) => void;
}

export interface ViewerState {
	images: ViewerImage[];
	index: number;
	/** Where the thumbnail was, for the open and close animations. */
	origin: DOMRect | null;
	/**
	 * The thumbnail itself, so it can be hidden while its picture is out of it.
	 *
	 * The flight is meant to read as *this thumbnail* becoming the full-size picture. Leaving the
	 * original in place while a copy of it flies away shows two of the same thing at once, which is
	 * the illusion broken in the most literal way possible. Held only for as long as the viewer is
	 * open, and restored by the viewer on its way out.
	 */
	source: HTMLElement | null;
	/** Whether the viewer should start directly in annotation mode. */
	startEditing?: boolean;
}

let state: ViewerState | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

export function openViewer(
	images: ViewerImage[],
	index: number,
	origin: DOMRect | null,
	source: HTMLElement | null = null,
	startEditing = false,
) {
	if (images.length === 0) return;
	state = { images, index: Math.max(0, Math.min(index, images.length - 1)), origin, source, startEditing };
	emit();
}

export function closeViewer() {
	state = null;
	emit();
}

export function stepViewer(delta: number) {
	if (!state) return;
	const count = state.images.length;
	// Wraps, because a gallery of three that stops at both ends is a gallery you have to think about.
	// No origin and no source: stepping is a move between pictures, not an arrival from a thumbnail,
	// and the one it started from stays hidden until the viewer closes.
	state = { ...state, index: (state.index + delta + count) % count, origin: null };
	emit();
}

export function useViewer(): ViewerState | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
		() => null,
	);
}

/**
 * What a clickable image hands over.
 *
 * Takes the rectangle from the element that was clicked rather than from a ref the caller has to
 * keep, so making an image openable is one prop and no bookkeeping.
 */
export function openFromEvent(event: React.MouseEvent<HTMLElement>, images: ViewerImage[], index: number) {
	openViewer(images, index, event.currentTarget.getBoundingClientRect(), event.currentTarget);
}
