/**
 * The window's keyboard shortcuts.
 *
 * All of them in one place, because a shortcut is only ever wrong relative to the others: two
 * handlers claiming ⌘L, or Escape closing something a menu had already dealt with. Reading them as
 * a list is how those get noticed.
 *
 * What each one needs arrives as a parameter rather than being reached for, so this can be read
 * without knowing how the shell stores its state. The dock is the exception and is reached for
 * directly: every panel shortcut means the same thing to it — "put this pane in front, or take it
 * away" — and threading eight identical callbacks through the shell to say so taught nobody
 * anything.
 */

import { useEffect } from "react";
import { useDock } from "../features/dock/store.ts";
import type { PanelKind } from "../features/dock/sideStore.ts";

export interface ShortcutDeps {
	/**
	 * Off while another screen is in front. The workspace stays mounted underneath so it keeps its
	 * scroll position, which used to be the same thing as being the screen you are on — it is not
	 * any more, and these keys act on panes that are out of sight.
	 */
	enabled: boolean;
	compact: boolean;
	navOpen: boolean;
	activeSessionId: string | null;
	workspace: unknown;
	toggleNav(): void;
	dismissNav(): void;
}

export function useShortcuts(deps: ShortcutDeps): void {
	const { enabled, compact, navOpen, activeSessionId, workspace, toggleNav, dismissNav } = deps;

	useEffect(() => {
		if (!enabled) return;

		/** Open the pane, or put it away if it is already the one in front. */
		const panel = (kind: PanelKind, allowed: unknown) => {
			if (allowed) useDock.getState().toggle(kind);
		};

		const onKey = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			// ⌘B is the conventional shortcut, and it makes the transition easy to feel.
			if (mod && !event.altKey && event.key.toLowerCase() === "b") {
				event.preventDefault();
				toggleNav();
				return;
			}
			/*
			 * `code`, not `key`.
			 *
			 * Option is a dead-key modifier on macOS: ⌥S arrives as "ß", so matching on `key`
			 * would never fire. The physical key is what the shortcut is written as.
			 */
			if (mod && event.altKey && event.code === "KeyS") {
				event.preventDefault();
				panel("chat", activeSessionId);
				return;
			}
			if (mod && event.shiftKey && event.code === "KeyR") {
				event.preventDefault();
				panel("review", workspace);
				return;
			}
			if (mod && !event.altKey && !event.shiftKey && event.code === "KeyP") {
				event.preventDefault();
				panel("files", workspace);
				return;
			}
			// ⌥⌘P for the file itself — the tree's ⌘P with the modifier that means "the other one".
			if (mod && event.altKey && event.code === "KeyP") {
				event.preventDefault();
				panel("file", workspace);
				return;
			}
			// ⌘L for the trajectory: the log of what actually happened, beside the conversation.
			if (mod && !event.altKey && !event.shiftKey && event.code === "KeyL") {
				event.preventDefault();
				panel("trajectory", activeSessionId);
				return;
			}
			// ⌃` is what every terminal-bearing editor uses, and it is not a ⌘ shortcut.
			if (event.ctrlKey && !event.metaKey && event.code === "Backquote") {
				event.preventDefault();
				panel("terminal", workspace);
				return;
			}
			/*
			 * Escape steps back from whatever is *covering* something, and nothing else.
			 *
			 * A pane sitting beside the conversation is not covering anything, and closing
			 * something you are working alongside is not what Escape means — so in the ordinary
			 * layout it does nothing at all. A maximised pane is covering the rest of the dock and
			 * gets restored; the navigation drawer covers the whole window and gets dismissed.
			 *
			 * Anything that already acted on Escape — the editor's find bar, a menu, a drag in
			 * flight — calls `preventDefault` during capture. Without this check the same keypress
			 * also un-maximised a pane, so closing a find bar took the layout apart with it.
			 */
			if (event.key === "Escape" && !event.defaultPrevented) {
				if (compact && navOpen) dismissNav();
				else useDock.getState().restore();
			}
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled, compact, navOpen, toggleNav, dismissNav, activeSessionId, workspace]);
}
