/**
 * A spent quota, told apart from a busy moment before anything waits on it.
 *
 * Both arrive as 429. A busy moment is worth a retry a second later; a spent quota answers the same
 * for hours — Antigravity says "Your quota will reset after 1h52m45s" — and every retry against it is
 * a turn held open with the card spinning, for an answer that was already final. So the response is
 * read before the retry loop sees it, and a spent quota leaves as final, with the wait it named.
 */

import { classifyFailure, FailureError } from "../ai/failure.ts";

const SPENT = /QUOTA_EXHAUSTED|exhausted your capacity|quota will reset|insufficient_quota|model_cooldown|billing_hard_limit/i;

/** `1h52m45.9s`, `45s`, or a `reset_seconds` count, as milliseconds. */
export function resetAfterMs(body: string): number | undefined {
	const seconds = /"?reset_seconds"?\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(body);
	if (seconds) return Math.round(Number(seconds[1]) * 1000);
	const spelled = /reset(?:\s+after|Delay\\?"?\s*:\s*\\?")\s*((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)/i.exec(body);
	if (!spelled?.[1]) return undefined;
	const part = (unit: string) => Number(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`).exec(spelled[1])?.[1] ?? 0);
	const ms = (part("h") * 3600 + part("m") * 60 + part("s")) * 1000;
	return ms > 0 ? Math.round(ms) : undefined;
}

export function quotaGuard(doFetch: typeof globalThis.fetch): typeof globalThis.fetch {
	return async (url, init) => {
		const response = await doFetch(url, init);
		if (response.status !== 429 && response.status !== 402) return response;
		const body = await response.clone().text().catch(() => "");
		if (!SPENT.test(body)) return response;
		await response.body?.cancel().catch(() => undefined);
		const failure = classifyFailure({ from: "status", status: response.status, body });
		throw new FailureError({ ...failure, kind: "fatal", hint: "check-billing", retryAfterMs: resetAfterMs(body) ?? failure.retryAfterMs, retryLimit: 0 });
	};
}
