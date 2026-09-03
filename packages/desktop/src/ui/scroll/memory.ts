/**
 * Where a reader was, kept apart from what they were reading.
 *
 * This used to live inside `sessionCache` alongside the transcript, and that is precisely what
 * made it useless: a conversation that says something new while you are elsewhere has its cached
 * transcript dropped — correctly, the events do not carry enough to rebuild it — and the reading
 * position went out with it. The conversation still running in the background is the one you most
 * want to come back to the same place in.
 *
 * So: a separate store, keyed by surface, holding only what is cheap to be wrong about. Every
 * field here degrades to a sensible default if it is missing, which is why this can be a plain
 * module-level map rather than part of the app store — nothing else needs to read it, nothing
 * needs to re-render when it changes, and losing all of it costs one scroll to the bottom.
 */

import type { Marker } from "./follow.ts";

export interface FollowSnapshot {
	/** The intention, which outranks the position: following means "take me to the end", wherever that is now. */
	following: boolean;
	/** Only meaningful when not following. */
	scrollTop: number;
	/** How much of the transcript had been seen, so the unread count survives the round trip. */
	seen: Marker | null;
}

/**
 * How many surfaces to remember.
 *
 * Enough to cover moving around a project for an afternoon. Each entry is four numbers; the limit
 * is about not growing without bound over a long session rather than about memory.
 */
const LIMIT = 64;

const stores = new Map<string, Map<string, FollowSnapshot>>();

/**
 * The map for one *kind* of surface.
 *
 * Namespaced because a session id identifies both a conversation and the side chat attached to it,
 * and they are scrolled independently. Delegates key on `${sessionId}:${agentId}` within their own
 * namespace for the same reason.
 */
function storeFor(namespace: string): Map<string, FollowSnapshot> {
	let store = stores.get(namespace);
	if (!store) {
		store = new Map();
		stores.set(namespace, store);
	}
	return store;
}

export function readFollow(namespace: string, id: string): FollowSnapshot | undefined {
	return storeFor(namespace).get(id);
}

export function writeFollow(namespace: string, id: string, snapshot: FollowSnapshot): void {
	const store = storeFor(namespace);
	// Re-inserting is what makes iteration order recency order, which is what the eviction below
	// relies on.
	store.delete(id);
	store.set(id, snapshot);
	if (store.size > LIMIT) {
		const oldest = store.keys().next();
		if (!oldest.done) store.delete(oldest.value);
	}
}

/** Used when a conversation is deleted or archived: it is not coming back, and neither is its place. */
export function forgetFollow(namespace: string, id: string): void {
	storeFor(namespace).delete(id);
}
