/**
 * What a window may open, go to, host and be granted — as decisions, not as wiring.
 *
 * A renderer with a preload is the most privileged surface this application has: `window.lyra`
 * reaches the filesystem, the shell and the model keys. These rules exist so that surface only ever
 * hosts our own page, and so the pages we *do* host cannot ask for more than they need.
 *
 * Kept apart from `window-security.ts`, which attaches them to Electron, for the reason
 * `mobile/drawer-gesture.ts` is kept apart from the hook that binds it: what is worth arguing with
 * is the rule, and a rule that imports `electron` cannot be argued with outside Electron. It
 * matters more than usual here — every one of these functions exists to *refuse* something, and a
 * refusal that quietly stopped working looks exactly like one that was never reached.
 */

/**
 * Schemes we will hand to the operating system.
 *
 * `file:` is the one that matters. `shell.openExternal("file:///…")` opens that path with whatever
 * the OS associates with it — so a link in a model's answer becomes arbitrary local execution.
 */
const OPENABLE = new Set(["http:", "https:", "mailto:"]);

/** Whether this URL may be handed to the user's browser or mail client. */
export function isOpenable(raw: string): boolean {
	try {
		return OPENABLE.has(new URL(raw).protocol);
	} catch {
		return false;
	}
}

/** The schemes our own interface is served from, whatever the build. */
const OURS = ["file://", "ly-media://", "ly-preview://"];

/**
 * Whether a URL is one of our own pages.
 *
 * In development the renderer comes from Vite over http; packaged, it is a `file:` URL inside the
 * bundle. Project files and generated previews arrive through their own schemes. Anything else — a
 * clicked link, a redirect, a `location.href` written by injected script — is somewhere else.
 *
 * Without this rule one successful injection is enough: `location.href = "https://…"` loads a
 * remote page *into the window that holds the preload*, and that page then owns `window.lyra`.
 *
 * The dev server is compared as an origin rather than as a prefix. `startsWith` would accept
 * `http://localhost:51730` for a server on `:5173`, and — worse — a hostile page can put the whole
 * thing in its own name: `https://localhost:5173.evil.com`.
 */
export function isOurPage(url: string, devServer?: string): boolean {
	if (!url) return false;
	if (OURS.some((scheme) => url.startsWith(scheme))) return true;
	if (!devServer) return false;
	try {
		return new URL(url).origin === new URL(devServer).origin;
	} catch {
		return false;
	}
}

/**
 * What a `<webview>` may load.
 *
 * http(s) is the browser panel's whole point. `about:blank` is its empty state, `ly-preview:` is
 * how a generated page is shown. `file:` is deliberately absent: a guest that can read `file:///`
 * can read the disk through a page we did not write.
 */
export function isWebviewSourceAllowed(src: string): boolean {
	return /^(https?:\/\/|about:blank$|ly-preview:\/\/)/.test(src ?? "");
}

/**
 * Capabilities a page may ask the operating system for.
 *
 * Electron grants whatever is requested unless told otherwise — wrong for an application that hosts
 * other people's pages in a panel, where a site can simply ask for the camera and have it.
 *
 * Our own renderer needs almost nothing: everything it does with the machine goes through IPC,
 * where it can be reasoned about. Guests get nothing.
 */
const GRANTED = new Set(["clipboard-sanitized-write", "fullscreen"]);

export function isPermissionGranted(url: string, permission: string, devServer?: string): boolean {
	return isOurPage(url, devServer) && GRANTED.has(permission);
}

/** The preferences a guest gets, whatever its tag asked for. */
export interface GuestPreferences {
	preload?: string;
	nodeIntegration?: boolean;
	contextIsolation?: boolean;
	sandbox?: boolean;
}

/**
 * Take the keys away from the guest.
 *
 * Mutates rather than returns, because that is the shape Electron's event gives us: the object
 * handed to `will-attach-webview` *is* the one the guest is created with.
 */
export function harden(preferences: GuestPreferences): void {
	// Nothing in a guest page needs our preload, and handing it over would hand over `window.lyra`.
	delete preferences.preload;
	preferences.nodeIntegration = false;
	preferences.contextIsolation = true;
	preferences.sandbox = true;
}
