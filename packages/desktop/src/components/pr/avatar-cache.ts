/**
 * Every face the pane has fetched, in one store it all shares.
 *
 * A picture per row is a small thing that gets expensive in a specific way: the component asked
 * for its own on mount, so scrolling a list of sixty was sixty IPC round trips, the same three
 * authors fetched over and over, and a visible flash of the fallback initial on every remount even
 * though the answer had been sitting in the main process the whole time.
 *
 * Three moves fix all of it, and none of them are about the picture:
 *
 *   - **one store, module-scoped**, so the answer outlives the component that asked;
 *   - **one request per frame**, since a list arrives all at once and thirty names in one call is
 *     one round trip instead of thirty;
 *   - **kept in `localStorage`**, so the second launch draws the faces in the first frame rather
 *     than a beat later. They are a few KB each and they do not change.
 */

import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../services/index.ts";

const KEY = "lyra.avatars.v2";

/** Roughly 4KB each at this size. Eighty covers every author a triage session sees. */
const LIMIT = 80;

/**
 * Long enough for one list to arrive, short enough to be invisible.
 *
 * The rows of a refreshed list mount in the same frame, so anything above zero collects all of
 * them; anything a person could notice would show the fallback initial first and then swap it.
 */
const BATCH_MS = 16;

/**
 * How long before a face that did not arrive is asked about again.
 *
 * Only successes are kept here; a miss leaves nothing behind but the timestamp below, so the next
 * refresh of the list picks it up. Longer than one poll and shorter than a session: a picture that
 * timed out on a cold start comes back on its own, and an account that genuinely has none is not
 * re-fetched by every row of every refresh.
 */
const RETRY_MS = 60_000;

const faces = new Map<string, string>(restore());
/** When each login was last asked about, hit or miss — the whole of the retry policy. */
const asked = new Map<string, number>();
const listeners = new Set<() => void>();

/** Queued by cache key, carrying what the row said about where the picture lives. */
let queued: Map<string, { login: string; url: string | null; accountId: string }> | null = null;
let timer = 0;

/**
 * What a face is filed under.
 *
 * The account is part of it because a login is only unique within one host: a work GitLab and
 * github.com can each have a `kittors`, and they are not the same person. Keyed by name alone,
 * whichever list arrived first decided what the other one\'s face looked like.
 */
const keyFor = (accountId: string, login: string) => `${accountId}\u0000${login}`;

function restore(): [string, string][] {
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is [string, string] =>
				Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string",
		);
	} catch {
		return [];
	}
}

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify([...faces].slice(-LIMIT)));
	} catch {
		// A full or disabled store: the faces still work, they just arrive a beat later next time.
	}
}

function want(accountId: string, login: string, url?: string | null): void {
	if (!login || !accountId) return;
	const key = keyFor(accountId, login);
	if (faces.has(key)) return;
	if (Date.now() - (asked.get(key) ?? 0) < RETRY_MS) return;
	queued ??= new Map();
	if (queued.has(key)) return;
	asked.set(key, Date.now());
	queued.set(key, { login, url: url ?? null, accountId });
	if (!timer) timer = window.setTimeout(() => void flush(), BATCH_MS);
}

async function flush(): Promise<void> {
	timer = 0;
	const batch = queued;
	queued = null;
	if (!batch?.size) return;

	const answer = await bridge.git.avatars([...batch.values()]).catch(() => null);
	if (!answer) return;

	// Only what arrived is recorded. A miss leaves the login absent, which — behind the retry
	// window above — is what lets a later refresh pick it up instead of the first bad second at
	// launch deciding the whole session.
	let changed = false;
	for (const [key, { login, accountId }] of batch) {
		// The main process answers under `accountId:login`, which is the same question this cache
		// keys on and a different spelling of it — one of them has to do the translating.
		const value = answer[`${accountId}:${login}`];
		if (typeof value === "string" && faces.get(key) !== value) {
			faces.set(key, value);
			changed = true;
		}
	}
	if (!changed) return;
	persist();
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Ask for every face a list is about to draw, before any of it is drawn.
 *
 * Called when the list itself arrives rather than when a row mounts, so the pictures for rows
 * below the fold are already in hand by the time scrolling reaches them.
 */
export function prefetchAvatars(people: { accountId: string; author: string; avatarUrl?: string | null }[]): void {
	for (const person of people) want(person.accountId, person.author, person.avatarUrl);
}

/** This account's picture, or null while there is not one — which is also the resting state. */
export function useAvatar(accountId: string, login: string, url?: string | null): string | null {
	const src = useSyncExternalStore(
		subscribe,
		() => faces.get(keyFor(accountId, login)) ?? null,
	);

	useEffect(() => {
		want(accountId, login, url);
	}, [accountId, login, url]);

	return src;
}
