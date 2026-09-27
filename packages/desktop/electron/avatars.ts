import type { ImageStore } from "./image-cache.ts";

/**
 * Pictures from the network, fetched here rather than by the page.
 *
 * The renderer's Content-Security-Policy allows `self`, `data:` and `blob:` — deliberately, since
 * it is the one thing standing between a rendered comment body and an arbitrary remote request.
 * Adding `avatars.githubusercontent.com` to it to show a 20px circle would widen that policy for
 * every element on every screen, permanently, for a decoration.
 *
 * So the main process fetches them and hands back a data URL. The page never makes the request,
 * the policy stays as narrow as it was, and three useful things fall out: the result is cached
 * across the session, a failure is a value rather than a broken image element, and the same
 * picture asked for by twenty rows at once is one request.
 */

/**
 * Two kinds of picture come through here, and they want different things.
 *
 * A **mark** is a small picture standing for something — a face beside a name, a bundle's icon on a
 * card. It is a decoration: a few KB, often dozens at once, and nobody is waiting on any one of them.
 *
 * A **document** picture is one the user is reading — a README's logo, a screenshot, a chart in a
 * Markdown file they opened. It can be megabytes, there are rarely more than a couple of dozen, and
 * it is the thing on screen right now.
 */
type Kind = "mark" | "document";

/**
 * How big each may be.
 *
 * Half a megabyte is already generous for an icon — past that it is not one, and something answering
 * 200 with a megabyte of anything is exactly what this guards against. It was also the cap for
 * document pictures, which is how Ponytail's page lost its logo: 567KB, an ordinary size for a
 * banner. Five megabytes is the default of camo, the proxy GitHub serves README pictures through, so
 * a picture GitHub draws in a README is one this draws too.
 */
const LIMIT: Record<Kind, number> = { mark: 512 * 1024, document: 5 * 1024 * 1024 };

/**
 * Cached by URL — a hit for the life of the process, a miss for a minute.
 *
 * The asymmetry is the point, and it was learned the hard way. A picture that arrived is not going
 * to change, so keeping it costs one entry and saves every later ask. A *failure* is almost never
 * about the picture: it is a DNS lookup on a cold start, a network interface that was not up yet,
 * a laptop half a second out of sleep. Keeping those forever is how one slow second at launch
 * turned into a whole session of grey initials — measured, not imagined: the same URL that timed
 * out at boot answered in 0.3s a minute later, and nothing would have asked it again.
 *
 * Still worth keeping for a minute, though. An account genuinely without a picture must not be
 * re-fetched by every row of every refresh.
 *
 * Keyed by kind as well as URL: a picture refused as too big for an icon may be fine in a document.
 */
const cache = new Map<string, { value: string | null; at: number }>();

/** How long a failure is taken at its word. Shorter than the list's own refresh, so a retry lands. */
const MISS_MS = 60_000;

/**
 * Bounded twice. By count, because a long triage session sees a lot of bots; and by size, because a
 * document's picture can be a thousand faces' worth on its own. Oldest go first.
 */
const MAX = 200;
const BUDGET = 32 * 1024 * 1024;
let held = 0;

function remember(key: string, value: string | null): void {
	const previous = cache.get(key);
	if (previous) {
		held -= previous.value?.length ?? 0;
		cache.delete(key);
	}
	cache.set(key, { value, at: Date.now() });
	held += value?.length ?? 0;
	for (const [old, entry] of cache) {
		if (cache.size <= MAX && held <= BUDGET) break;
		cache.delete(old);
		held -= entry.value?.length ?? 0;
	}
}

/**
 * What is on the wire right now.
 *
 * The cache is only written once an answer comes back, so without this a list arriving in one
 * frame — thirty rows, most of them the same three people — opened thirty sockets for six
 * pictures. This is the difference between one refresh being one request and being a burst.
 */
const pending = new Map<string, Promise<string | null>>();

/**
 * How many may be in the air at once — per kind, so neither waits behind the other.
 *
 * A refreshed list can name several dozen faces in the same instant, and firing all of them
 * together is how a decoration ends up competing with the request the user is actually waiting on.
 * Ten rather than six for marks: the market asks for its seventy icons at once, and six at a time
 * took twenty seconds to reach the last of them.
 *
 * Documents have a lane of their own because sharing one was measured: on a first launch the market
 * was still working through its icons when a card was opened, and Ponytail's README stood without a
 * single picture for 11.7 seconds, twenty badges queued behind seventy icons for a grid nobody was
 * looking at any more.
 */
const LANES: Record<Kind, <T>(work: () => Promise<T>) => Promise<T>> = { mark: lane(10), document: lane(6) };

function lane(size: number): <T>(work: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async (work) => {
		if (active >= size) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await work();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

/**
 * A data URL for one remote mark — an avatar, a registry entry's icon — or null.
 *
 * Restricted to https, and to a size that is plausibly an icon. Everything small the app draws from
 * the network comes through here, because the reason not to let the page do it is the same in every
 * case.
 */
export function remoteImage(url: string, store?: ImageStore): Promise<string | null> {
	return picture(url, "mark", store);
}

/** A data URL for a picture a document names — a README's, a Markdown file's — or null. */
export function documentImage(url: string): Promise<string | null> {
	return picture(url, "document");
}

async function picture(url: string, kind: Kind, store?: ImageStore): Promise<string | null> {
	if (!url.startsWith("https://")) return null;

	const key = kind === "mark" ? url : `${kind} ${url}`;
	const hit = cache.get(key);
	if (hit && (hit.value !== null || Date.now() - hit.at < MISS_MS)) return hit.value;
	const already = pending.get(key);
	if (already) return already;

	const request = (store ? kept(url, key, store) : download(url, kind))
		.then((result) => {
			remember(key, result);
			return result;
		})
		.finally(() => pending.delete(key));

	pending.set(key, request);
	return request;
}

/**
 * The picture from disk when one was kept, and from the network otherwise — for the callers that
 * pass a store (the market's icons). A kept picture is answered at once; if it is an hour old it is
 * also fetched again behind the answer, and the fresh copy replaces it for the next ask.
 */
async function kept(url: string, key: string, store: ImageStore): Promise<string | null> {
	const stored = await store.read(url);
	if (stored) {
		if (stored.stale) {
			void download(url, "mark").then((fresh) => {
				if (!fresh) return;
				remember(key, fresh);
				return store.write(url, fresh);
			});
		}
		return stored.value;
	}
	const value = await download(url, "mark");
	if (value) void store.write(url, value);
	return value;
}

async function download(url: string, kind: Kind): Promise<string | null> {
	return LANES[kind](async () => {
		try {
			/*
			 * Bounded: a hung connection must not leave a row waiting forever on a picture.
			 *
			 * Nine seconds rather than six because the request most likely to be slow is the first
			 * one after launch — cold DNS, cold TLS, and everything else the app is doing at that
			 * moment — and that is also the one whose failure is most visible.
			 */
			const response = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: "follow" });
			const type = response.headers.get("content-type") ?? "";
			if (!response.ok || !type.startsWith("image/")) return null;
			const bytes = Buffer.from(await response.arrayBuffer());
			// A guard against something that answers 200 with a megabyte of anything.
			if (bytes.byteLength === 0 || bytes.byteLength > LIMIT[kind]) return null;
			return `data:${type};base64,${bytes.toString("base64")}`;
		} catch {
			return null;
		}
	});
}

/**
 * Where a host keeps the picture for an account, when nothing else said.
 *
 * Only GitHub gets a guess, and only because `github.com/<login>.png` is a documented redirect
 * that has worked for a decade. The others have no such address — GitLab and Gitee serve avatars
 * from a CDN under an opaque id, Gitea from a hash — so for them "no URL" means no picture rather
 * than a request that 404s once per name per minute.
 *
 * `?s=80` because these are drawn at 20pt at most and the full-size image is several hundred KB of
 * something nobody will look closely at. GitHub resizes server-side, so this is smaller on the
 * wire as well as in memory.
 */
function guessUrl(login: string, host: string): string | null {
	const name = login.trim();
	if (!name || name.includes("/")) return null;
	return `${host}/${encodeURIComponent(name)}.png?s=80`;
}

/** One account's picture, for the places that know a name and nothing else. */
export async function githubAvatar(login: string): Promise<string | null> {
	const url = guessUrl(login, "https://github.com");
	return url ? remoteImage(url) : null;
}

/**
 * A whole list of faces in one call.
 *
 * The list pane asks for every author it is about to draw at once. Per-row requests meant one IPC
 * round trip per row on every mount — a hundred and eighty of them for a list of sixty — for an
 * answer the main process usually had cached already.
 *
 * Keyed by `accountId:login`, not by login alone. Two hosts can each have a `kittors` and they are
 * not the same person; keying by name meant whichever list arrived first decided what the other
 * one's face looked like. The URL comes from the search result where there is one, because
 * `github.com/<login>.png` is wrong for the accounts that appear most — a bot's picture belongs to
 * the app rather than to whichever user shares its name.
 */
export async function avatarsFor(
	people: { login: string; url?: string | null; accountId?: string }[],
	hostFor: (accountId: string) => { kind: string; baseUrl: string } | null,
): Promise<Record<string, string | null>> {
	const wanted = new Map<string, string>();
	for (const person of people) {
		const login = (person.login ?? "").trim();
		if (!login) continue;
		const key = `${person.accountId ?? ""}:${login}`;
		if (wanted.has(key)) continue;

		const given = (person.url ?? "").trim();
		if (given.startsWith("https://")) {
			wanted.set(key, given);
			continue;
		}
		const account = person.accountId ? hostFor(person.accountId) : null;
		const guess = account?.kind === "github" ? guessUrl(login, account.baseUrl) : null;
		if (guess) wanted.set(key, guess);
	}

	const entries = await Promise.all([...wanted].map(async ([key, url]) => [key, await remoteImage(url)] as const));
	return Object.fromEntries(entries);
}
