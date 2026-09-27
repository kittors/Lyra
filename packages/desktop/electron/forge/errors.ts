/**
 * What went wrong, in a sentence someone can act on.
 *
 * This is the file that decides whether a failure is useful. The raw material is bad: a GitLab
 * token with the wrong scope 404s rather than 403s, Gitee answers an expired token with a code
 * nobody has seen before, and a `fetch` that cannot reach a host says `ENOTFOUND` and nothing else.
 * Left alone, all of that reaches a person as a line of English punctuation.
 *
 * The rule is that a message names the thing to do next, and says which account it is about when
 * there is more than one. Everything here is pure — no network, no Electron — because a message
 * about a failure is exactly the code you cannot test by causing the failure.
 */

import { nativeText, type NativeMessageKey } from "../i18n.ts";
import type { ForgeKind } from "./types.ts";

/** A failure with the host's own status attached, so callers can tell 401 from 500. */
export class ForgeError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ForgeError";
		this.status = status;
	}
}

/**
 * What to say when a host answers 401, naming the thing you have to go fix the way that host names
 * it. A whole sentence per host rather than a name dropped into one sentence, because where the
 * name goes, and what form it takes there, is up to each language.
 */
const TOKEN_INVALID: Record<ForgeKind, NativeMessageKey> = {
	github: "forge.githubTokenInvalid",
	gitlab: "forge.gitlabTokenInvalid",
	gitee: "forge.giteeTokenInvalid",
	gitea: "forge.giteaTokenInvalid",
};

/**
 * An HTTP status turned into the thing to do about it.
 *
 * `detail` is whatever the host said. It is appended rather than trusted: it is often the only
 * clue (which scope was missing, which field was rejected) and just as often a sentence about an
 * internal service nobody outside that company can act on — so it is never the whole message.
 */
export function describeStatus(status: number, detail: string, kind: ForgeKind): string {
	const said = detail.trim().split("\n")[0].slice(0, 160);
	// Joined with the interface language's own separator: 「：」 in Chinese, ": " in English.
	const withDetail = (message: string) => (said ? nativeText("forge.withDetail", { message, detail: said }) : message);

	if (status === 401) return nativeText(TOKEN_INVALID[kind]);
	/*
	 * 403 is two different problems wearing one number, and the fix is opposite in each case.
	 *
	 * GitHub says 403 both for "you are over the rate limit" (wait) and for "this token has no
	 * such scope" (go make a new one). The body is the only thing that separates them, which is
	 * why it is read rather than merely appended here.
	 */
	if (status === 403) {
		if (/rate limit|too many/i.test(detail)) return nativeText("forge.rateLimited");
		return said ? withDetail(nativeText("forge.forbidden")) : nativeText("forge.forbiddenScope");
	}
	if (status === 404) return nativeText("forge.notFound");
	if (status === 422) return withDetail(nativeText("forge.rejected"));
	if (status === 429) return nativeText("forge.rateLimited");
	if (status >= 500) return withDetail(nativeText("forge.serverError", { status }));
	return withDetail(nativeText("forge.requestFailed", { status }));
}

/**
 * A `fetch` that never reached anybody, said in terms of the host it was trying to reach.
 *
 * The host name is the useful part. With several accounts configured, "连不上" on its own leaves
 * somebody guessing which of them is the one that is unreachable — and the answer is usually the
 * self-hosted one behind a VPN that is not connected.
 */
export function networkMessage(error: unknown, baseUrl: string): string {
	const host = hostLabel(baseUrl);
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

	if (/TimeoutError|AbortError|timed? ?out/i.test(message)) return nativeText("forge.timeout", { host });
	if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|NAME_NOT_RESOLVED/i.test(message)) return nativeText("forge.unresolved", { host });
	if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(message)) return nativeText("forge.refused", { host });
	if (/CERT|certificate|SSL|TLS/i.test(message)) return nativeText("forge.certificate", { host });
	return nativeText("forge.unreachable", { host });
}

function hostLabel(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl || nativeText("forge.theServer");
	}
}

/**
 * Any thrown thing, as one line.
 *
 * A `ForgeError` has already been through the two functions above and is passed through untouched.
 * Everything else is a bug or a surprise, and gets trimmed rather than dressed up — inventing a
 * friendly message for an unknown failure is how the real one stops reaching anybody.
 */
export function describe(error: unknown): string {
	if (error instanceof ForgeError) return error.message;
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n")[0].slice(0, 200) || nativeText("forge.unknownError");
}
