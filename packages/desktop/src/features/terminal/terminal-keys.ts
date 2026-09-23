/**
 * Which keys in the terminal are the shell's, and which are the app's — and the one thing xterm
 * has to be told about the pty it is drawing for on Windows.
 *
 * Pure, and apart from `TerminalPane`, so both can be tested without a terminal.
 */

import type { IWindowsPty } from "@xterm/xterm";
import { composingKey, macKeyboard, shortcutLetter } from "../../ui/keyboard.ts";

/**
 * What to do with a key before xterm sees it.
 *
 *   copy   put the selection on the clipboard, and nothing reaches the shell
 *   paste  keep xterm away from it, so the browser's own paste lands in xterm's input and is
 *          sent from there (bracketed-paste aware)
 *   app    keep xterm away from it, so the window's shortcut handler gets it
 *   shell  xterm's, as always
 */
export type TerminalKey = "copy" | "paste" | "app" | "shell";

/**
 * The shortcuts that have to work with the terminal focused, as the letter pressed with Ctrl+Alt:
 * the conversation beside it, the open file, and the sub-agents (see `app/shortcuts.ts`).
 */
const APP_WITH_CTRL_ALT = new Set(["s", "p", "a"]);

/**
 * Decide a key, for a keyboard where Ctrl is both the shell's key and the app's.
 *
 * Nothing changes on a Mac: the app's shortcuts are ⌘, which xterm leaves alone, and copy and paste
 * are the Edit menu's, which reach xterm through the clipboard events it already handles.
 *
 * Elsewhere xterm turns every Ctrl+letter into a control character and swallows the event, and
 * Chromium has no copy of its own there to fall back on. So:
 *
 *   - Ctrl+C with something selected copies it and clears the selection; with nothing selected it
 *     is still ^C. It used to be ^C either way: selecting a dev server's URL and pressing Ctrl+C
 *     interrupted the dev server. Ctrl+Shift+C always copies, as in every Linux terminal.
 *   - Ctrl+Shift+V is left to the browser's paste. xterm ignores it today; saying so here is what
 *     keeps it working if that changes.
 *   - Ctrl+Alt+S/P/A are the app's. The shell has no use for them, and xterm sent them as
 *     ESC-prefixed control characters, so the panels could not be reached from a focused terminal.
 *     AltGr arrives as Ctrl+Alt on Windows and types letters on many layouts (Polish ś is AltGr+S),
 *     so a composing key stays the shell's.
 *   - Ctrl+B/P/J/T/L stay the shell's, although the app uses them elsewhere. They are readline's
 *     back-char, previous-history, newline, transpose and clear-screen, and Ctrl+B is tmux's prefix;
 *     someone in a shell presses them far more often than they want a panel, and the panels are a
 *     click away. The Ctrl+Shift ones the app uses (Ctrl+Shift+R) xterm already lets through.
 */
export function terminalKey(event: KeyboardEvent, hasSelection: boolean, platform = navigator.platform): TerminalKey {
	if (macKeyboard(platform) || composingKey(event) || event.metaKey || !event.ctrlKey) return "shell";
	const letter = shortcutLetter(event);
	if (!event.altKey) {
		if (event.shiftKey && letter === "c") return "copy";
		if (event.shiftKey && letter === "v") return "paste";
		if (!event.shiftKey && letter === "c" && hasSelection) return "copy";
		return "shell";
	}
	if (!event.shiftKey && letter !== null && APP_WITH_CTRL_ALT.has(letter)) return "app";
	return "shell";
}

/**
 * The first Windows build whose ConPTY node-pty uses; below it node-pty falls back to winpty.
 * The same line `node-pty/lib/windowsPtyAgent.js` draws, so the two cannot disagree.
 */
const CONPTY_FROM_BUILD = 18309;

/**
 * What xterm has to know about a pty hosted on Windows, or nothing anywhere else.
 *
 * Without it xterm assumes a Unix pty. ConPTY does not bring scrollback back into view when the
 * terminal grows taller — it adds empty rows — so growing the pane dropped the lines that should
 * have come back; and before build 21376 ConPTY's own reflow fights xterm's, which scrambles
 * wrapped lines on a resize. xterm handles both once told the backend and the build.
 *
 * `systemVersion` is `process.getSystemVersion()` from the preload, "10.0.22631" on Windows 11.
 * When it cannot be read the backend is still named, which switches on the scrollback handling
 * and — with no build to prove otherwise — leaves reflow off, the safe side of both.
 */
export function windowsPtyFor(platform: string, systemVersion: string | undefined): IWindowsPty | undefined {
	if (platform !== "win32") return undefined;
	const build = Number(systemVersion?.split(".")[2]);
	if (!Number.isInteger(build) || build <= 0) return { backend: "conpty" };
	return { backend: build >= CONPTY_FROM_BUILD ? "conpty" : "winpty", buildNumber: build };
}
