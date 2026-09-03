/**
 * Attaching the security rules to Electron.
 *
 * The rules themselves are in `security-policy.ts`, which imports nothing — see the note there for
 * why they are apart. This file is the wiring: which event, on which object, at which moment.
 *
 * All four are from Electron's own security checklist. None is clever; the reason to gather them is
 * that each is invisible until it is missing, and three of them were.
 */

import { session, shell, type WebContents, type WebPreferences } from "electron";

import { harden, isOpenable, isOurPage, isPermissionGranted, isWebviewSourceAllowed } from "./security-policy.ts";

/** The dev server's origin, or undefined in a packaged build. */
const devServer = () => process.env.ELECTRON_RENDERER_URL;

/** Hand a URL to the user's browser, or refuse it. Returns whether it was opened. */
export function openExternalSafely(raw: string): boolean {
	if (!isOpenable(raw)) return false;
	void shell.openExternal(new URL(raw).href);
	return true;
}

/** Keep `contents` on our own pages; send everything else to the browser. */
export function guardNavigation(contents: WebContents): void {
	contents.on("will-navigate", (event, url) => {
		if (isOurPage(url, devServer())) return;
		event.preventDefault();
		openExternalSafely(url);
	});

	/*
	 * Redirects are refused rather than sent to the browser.
	 *
	 * A redirect is not something the user asked for, so opening a window for it would be a
	 * navigation nobody initiated — and a chain ending somewhere hostile is exactly how an
	 * ordinary-looking link becomes a problem.
	 */
	contents.on("will-redirect", (event, url) => {
		if (!isOurPage(url, devServer())) event.preventDefault();
	});

	// Links asking for a new window open in the user's browser; the app has no second window.
	contents.setWindowOpenHandler(({ url }) => {
		openExternalSafely(url);
		return { action: "deny" };
	});
}

/**
 * Constrain every `<webview>` this page attaches.
 *
 * `will-attach-webview` fires on the embedder, so a tag written into the page by injected markup
 * cannot quietly ask for node integration or a preload — those are taken away here regardless of
 * what the tag said.
 */
export function guardWebviews(contents: WebContents): void {
	contents.on("will-attach-webview", (event, preferences: WebPreferences, params) => {
		harden(preferences);
		if (!isWebviewSourceAllowed(String((params as { src?: string }).src ?? ""))) event.preventDefault();
	});
}

/** Answer permission requests for the default session and any extra partitions. */
export function installPermissionHandlers(partitions: string[]): void {
	const sessions = [session.defaultSession, ...partitions.map((name) => session.fromPartition(name))];

	for (const ses of sessions) {
		ses.setPermissionRequestHandler((contents, permission, callback) => {
			callback(isPermissionGranted(contents?.getURL() ?? "", permission, devServer()));
		});
		/*
		 * The synchronous half.
		 *
		 * Some capabilities are checked rather than requested — a page asking whether it *could*
		 * have the microphone. Leaving this unset means the answer is yes for things the handler
		 * above would refuse, which is a confusing pair of answers to give.
		 */
		ses.setPermissionCheckHandler((contents, permission) =>
			isPermissionGranted(contents?.getURL() ?? "", permission, devServer()),
		);
	}
}
