/**
 * Which host this renderer is running in, and what that host can do.
 *
 * The same bundle runs in an Electron window and in a WebView on a phone. In the window every
 * method answers; on the phone only the ones `@lyra/contract` marks as `remote` do, and the rest
 * are absent — `mobile/src/bridge.ts` fills them with a function that rejects.
 *
 * Before this file, four components asked `window.lyra?.host === "mobile"` and each drew its own
 * conclusion. The problem with that is not the repetition, it is that no single place could answer
 * "what is broken on a phone" — and the failure mode is silent: a button that is there, does
 * nothing, and reports nothing.
 */

import { methodFor } from "@lyra/contract";

import { bridge } from "./bridge.ts";

export type Host = "desktop" | "mobile";

/** Where this renderer is being displayed. Desktop unless the bridge says otherwise. */
export function host(): Host {
	// Both spellings, for the same reason as `bridge.ts`.
	const scope = globalThis as { lyra?: { host?: Host }; window?: { lyra?: { host?: Host } } };
	return (scope.lyra ?? scope.window?.lyra)?.host ?? "desktop";
}

/** True when the interface is being shown through a phone rather than in a window. */
export function onPhone(): boolean {
	return host() === "mobile";
}

/**
 * Whether a method answers in this host.
 *
 * Answered from the contract rather than by probing the object, so a component can ask *before*
 * drawing a control rather than after a call has failed. `available("terminal", "open")` is false
 * on a phone because the contract says a shell is not something a pairing token should confer.
 *
 * Unknown methods answer `false`: a name that is not in the contract does not exist anywhere, and
 * saying "sure, try it" about a typo helps nobody.
 */
export function available(group: string, method: string): boolean {
	const entry = methodFor(`${group}.${method}`);
	if (!entry) return false;
	return host() === "desktop" || entry.remote;
}

/**
 * Why a method is unavailable here, in words that can go on screen.
 *
 * The contract requires a reason for everything it withholds from the phone, which means this can
 * always say something better than "not supported".
 */
export function unavailableBecause(group: string, method: string): string | undefined {
	const entry = methodFor(`${group}.${method}`);
	if (!entry) return `未知的方法 ${group}.${method}`;
	if (host() === "desktop" || entry.remote) return undefined;
	return entry.why;
}

export { bridge };
