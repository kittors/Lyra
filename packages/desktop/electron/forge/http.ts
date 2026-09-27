/**
 * One way of talking to four hosts.
 *
 * Everything above this file is about pull requests; everything in it is about the fact that four
 * different companies chose four different headers for the same idea. Keeping that here means a
 * driver reads as the API it wraps rather than as a pile of fetch options, and it means the three
 * things every request needs — a deadline, an identity, and a failure that says something — are
 * decided once instead of twenty-four times.
 *
 * Requests go through Electron's network stack rather than Node's global `fetch`, which is the
 * difference between working and not working for anyone behind a system proxy: Chromium reads the
 * OS proxy settings, Node ignores them entirely. Outside Electron — in tests — it falls back.
 */

import { nativeText } from "../i18n.ts";
import { apiRoot } from "./accounts.ts";
import { describeStatus, ForgeError, networkMessage } from "./errors.ts";
import type { ForgeConnection } from "./types.ts";

/**
 * A ceiling on any one call.
 *
 * Without it a connection that opens and then says nothing leaves a promise pending forever, and
 * with the list refreshing on a timer that is not a hang somebody eventually gives up on — it is a
 * socket a minute, none of them ever answering.
 */
const TIMEOUT_MS = 30_000;

/** Diffs are the one thing here that is legitimately large, and slow on a big pull request. */
export const DIFF_TIMEOUT_MS = 60_000;

/**
 * Electron's fetch when there is an Electron, the global one otherwise.
 *
 * Resolved once and cached. The import is dynamic because this module is also loaded by the unit
 * tests, where `electron` is not a resolvable module at all — a static import would fail the whole
 * file before a single pure function could be called.
 */
let fetcher: typeof fetch | null = null;

async function fetching(): Promise<typeof fetch> {
	if (fetcher) return fetcher;
	try {
		const electron = await import("electron");
		fetcher = electron.net?.fetch ? (electron.net.fetch.bind(electron.net) as typeof fetch) : fetch;
	} catch {
		fetcher = fetch;
	}
	return fetcher;
}

/**
 * How each host wants to be told who you are.
 *
 * GitLab's own header rather than `Bearer`, because a personal access token presented as a bearer
 * token is accepted by some GitLab versions and silently treated as anonymous by others — and
 * "anonymous" on a private instance is an empty list rather than an error, which is the worst way
 * for an authentication problem to present itself.
 */
function authHeader(conn: ForgeConnection): Record<string, string> {
	if (!conn.token) return {};
	switch (conn.account.kind) {
		case "gitlab":
			return { "PRIVATE-TOKEN": conn.token };
		case "gitee":
			return { Authorization: `token ${conn.token}` };
		default:
			return { Authorization: `Bearer ${conn.token}` };
	}
}

export interface CallOptions {
	method?: string;
	/** Sent as JSON. Absent for reads. */
	body?: unknown;
	/** Overrides `application/json`, for the hosts that serve a diff by content negotiation. */
	accept?: string;
	timeoutMs?: number;
	/** Appended as a query string; `undefined` values are dropped, arrays repeat the key. */
	query?: Record<string, string | number | boolean | undefined | (string | number)[]>;
	/**
	 * An origin to use instead of the account's API root.
	 *
	 * For the one endpoint that does not live under it: GitHub Enterprise serves REST from
	 * `/api/v3` and GraphQL from `/api/graphql`, siblings rather than parent and child.
	 */
	root?: string;
}

/**
 * One call against a host's API, as a `Response`.
 *
 * The path is relative to that host's API root — `/user`, `/repos/a/b/pulls` — so a driver never
 * writes an origin and never has to know whether this instance is the hosted one.
 */
async function call(conn: ForgeConnection, path: string, options: CallOptions = {}): Promise<Response> {
	const url = new URL(`${options.root ?? apiRoot(conn.account)}${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value === undefined) continue;
		if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
		else url.searchParams.set(key, String(value));
	}

	const send = await fetching();
	let response: Response;
	try {
		response = await send(url.toString(), {
			method: options.method ?? "GET",
			headers: {
				...authHeader(conn),
				Accept: options.accept ?? "application/json",
				"User-Agent": "Lyra",
				...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
		});
	} catch (error) {
		throw new ForgeError(networkMessage(error, conn.account.baseUrl), 0);
	}

	if (!response.ok) throw new ForgeError(describeStatus(response.status, await bodyMessage(response), conn.account.kind), response.status);
	return response;
}

export async function json<T>(conn: ForgeConnection, path: string, options: CallOptions = {}): Promise<T> {
	const response = await call(conn, path, options);
	// A 204 is how three of the four say "done, nothing to tell you" — approving, unapproving,
	// deleting. Parsing an empty body as JSON would turn every one of those into a failure.
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	if (!text.trim()) return undefined as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new ForgeError(nativeText("forge.notJson"), response.status);
	}
}

export async function text(conn: ForgeConnection, path: string, options: CallOptions = {}): Promise<string> {
	return (await call(conn, path, options)).text();
}

/**
 * Whatever the host said about the failure, in one line.
 *
 * All four wrap it differently — `message`, `error`, `errors[]` — and one of them sometimes sends
 * HTML. Best effort by design: this is only ever used to add detail to a message that already
 * stands on its own without it.
 */
async function bodyMessage(response: Response): Promise<string> {
	const raw = await response.text().catch(() => "");
	if (!raw.trim() || raw.trimStart().startsWith("<")) return "";
	try {
		const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown; errors?: unknown };
		const first = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined;
		const found =
			parsed.message ?? parsed.error ?? (typeof first === "string" ? first : (first as { message?: string })?.message);
		return typeof found === "string" ? found : "";
	} catch {
		return raw.slice(0, 200);
	}
}

/**
 * Run work with a cap on how much of it is in the air at once.
 *
 * Only one driver needs this, and it needs it badly: Gitee has no cross-repository search, so its
 * list is one request per repository. Unbounded, a person in thirty repositories opens thirty
 * sockets in one frame, which is how a list ends up rate-limited by the host it is reading.
 */
export async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = Array.from({ length: items.length });
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const at = next++;
			if (at >= items.length) return;
			out[at] = await work(items[at]);
		}
	});
	await Promise.all(runners);
	return out;
}
