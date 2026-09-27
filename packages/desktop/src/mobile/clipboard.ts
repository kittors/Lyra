/**
 * Copying, on a phone.
 *
 * Two ways into the clipboard are used across the app and neither worked on a phone:
 *
 * - `navigator.clipboard.writeText` — every copy button (a message, a code block, a path). The phone
 *   loads this interface over plain HTTP from the desktop on the same network, and a page served that
 *   way is not a secure context, which is exactly where browsers leave the Clipboard API out. Each of
 *   those buttons threw a TypeError and did nothing.
 * - `bridge.clipboard.write` / `read` — the contract's names, used by the field menu, the file
 *   panel, the attachment menu. The phone's bridge answers the same thing as `writeText` /
 *   `readText`, so the contract's names fell through to its floor and resolved to nothing.
 *
 * Both are filled from the native side's text clipboard (expo-clipboard, see `desk.tsx`), and only
 * where they are missing: a page that has the real ones — the desktop, or a phone reached over HTTPS —
 * keeps them. Images stay unsupported; the native side only carries text.
 */

interface NativeClipboard {
	writeText?: (text: string) => Promise<unknown>;
	readText?: () => Promise<unknown>;
	write?: (text: string) => Promise<unknown>;
	read?: () => Promise<unknown>;
}

export interface ClipboardScope {
	navigator?: { clipboard?: unknown };
	lyra?: { clipboard?: NativeClipboard };
	window?: { lyra?: { clipboard?: NativeClipboard } };
}

/** Returns which of the two it filled in, for a test to read. */
export function lendClipboard(scope: ClipboardScope = globalThis as unknown as ClipboardScope): { navigator: boolean; bridge: boolean } {
	const native = (scope.lyra ?? scope.window?.lyra)?.clipboard;
	const writeText = native?.writeText;
	const readText = native?.readText;
	const lent = { navigator: false, bridge: false };
	if (!native || typeof writeText !== "function" || typeof readText !== "function") return lent;

	const write = (text: string) => writeText.call(native, String(text)).then(() => undefined);
	const read = () => readText.call(native).then((value) => (typeof value === "string" ? value : ""));

	const nav = scope.navigator;
	if (nav && !nav.clipboard) {
		const unsupported = () => Promise.reject(new DOMException("Only text can be copied on this device.", "NotAllowedError"));
		Object.defineProperty(nav, "clipboard", {
			configurable: true,
			value: { writeText: write, readText: read, write: unsupported, read: unsupported },
		});
		lent.navigator = true;
	}

	// `in` rather than a lookup: the bridge answers any missing name with a stub, so a lookup always
	// finds something. `in` asks what the bridge actually defined.
	if (!("write" in native)) {
		native.write = write;
		lent.bridge = true;
	}
	if (!("read" in native)) {
		native.read = read;
		lent.bridge = true;
	}
	return lent;
}
