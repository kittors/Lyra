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
import { currentScope, panelsOf, toggleScopedPanel, usePaneDock } from "../features/dock/index.ts";
import type { PaneKind, PanelKind } from "../features/dock/index.ts";
import { closePane, frontToClose, layoutPanes, paneKey, stepConversation, useSplit } from "../features/split/index.ts";
import { useApp } from "../store/index.ts";
import { composingKey, macKeyboard, shortcutLetter } from "../ui/keyboard.ts";

/**
 * Ctrl+W in the main window on Windows and Linux: the pane in front, then the screen; see
 * `features/split/close-in-front.ts`. Wired here rather than in the split feature, which would have
 * to reach into the dock's front door — and the dock leads back to the split through the composer.
 */
function closeInFront(): boolean {
	const scope = currentScope();
	if (!scope) return false;
	const dock = usePaneDock.getState();
	// Focus counts only on the screen being worked in: a press elsewhere has already moved that.
	const holder = document.activeElement?.closest<HTMLElement>("[data-dock-pane]");
	const active = holder && holder.closest("[data-ly-split-pane]")?.getAttribute("data-ly-split-pane") === scope ? holder.getAttribute("data-dock-pane") : null;
	const choice = frontToClose({
		open: panelsOf(dock.tree(scope)),
		active,
		focused: dock.focused[scope] ?? null,
		screens: layoutPanes(useSplit.getState().tree).length,
		sessionId: scope === paneKey(null) ? null : scope,
	});
	if (!choice) return false;
	if ("pane" in choice) dock.close(scope, choice.pane as PaneKind);
	else closePane(choice.screen);
	return true;
}

export interface ShortcutDeps {
	/**
	 * Off while another screen is in front. The workspace stays mounted underneath so it keeps its
	 * scroll position, which used to be the same thing as being the screen you are on — it is not
	 * any more, and these keys act on panes that are out of sight.
	 */
	enabled: boolean;
	compact: boolean;
	/** The sidebar floats over the content (`NAV_OVERLAY_MAX`); Escape puts it away, as a drawer. */
	overlay?: boolean;
	navOpen: boolean;
	activeSessionId: string | null;
	workspace: unknown;
	toggleNav(): void;
	dismissNav(): void;
}

export function useShortcuts(deps: ShortcutDeps): void {
	const { enabled, compact, overlay = false, navOpen, activeSessionId, workspace, toggleNav, dismissNav } = deps;

	useEffect(() => {
		if (!enabled) return;

		/** Open the pane in the screen being worked in, or put it away if it is already there. */
		const panel = (kind: PanelKind, allowed: unknown) => {
			if (!allowed) return;
			const scope = currentScope();
			if (scope) toggleScopedPanel(scope, kind, { compact });
		};

		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || composingKey(event)) return;
			const mod = event.metaKey || event.ctrlKey;
			/*
			 * The letter on the key, not the key's position.
			 *
			 * This matched `code` alone, because Option is a dead-key modifier on macOS: ⌥S arrives as
			 * "ß", so matching on `key` would never fire. That still holds, and `shortcutLetter` still
			 * falls back to `code` for exactly that case. What `code` got wrong is every layout that
			 * is not QWERTY: it names the QWERTY position, so on AZERTY ⌃⌥A was the key labelled Q.
			 */
			const letter = shortcutLetter(event);
			// ⌘B is the conventional shortcut, and it makes the transition easy to feel.
			if (mod && !event.altKey && !event.shiftKey && letter === "b") {
				event.preventDefault();
				toggleNav();
				return;
			}
			if (mod && event.altKey && !event.shiftKey && letter === "s") {
				event.preventDefault();
				panel("chat", activeSessionId);
				return;
			}
			if (mod && event.shiftKey && !event.altKey && letter === "r") {
				event.preventDefault();
				panel("review", workspace);
				return;
			}
			if (mod && !event.altKey && !event.shiftKey && letter === "p") {
				event.preventDefault();
				panel("files", workspace);
				return;
			}
			// ⌥⌘P for the file itself — the tree's ⌘P with the modifier that means "the other one".
			if (mod && event.altKey && !event.shiftKey && letter === "p") {
				event.preventDefault();
				panel("file", workspace);
				return;
			}
			/*
			 * ⌥⌘U, not ⌥⌘A. On Windows that is Ctrl+Alt+A, QQ's and TIM's screenshot hotkey — with
			 * either running the system hands it to them, and the pane never opened. G was the next
			 * thought and is the editor's go-to-line (Mod-Alt-g in CodeMirror); U is free everywhere.
			 */
			if (mod && event.altKey && !event.shiftKey && letter === "u") {
				event.preventDefault();
				panel("subagents", activeSessionId);
				return;
			}
			if (mod && !event.altKey && !event.shiftKey && (letter === "t" || letter === "j")) {
				event.preventDefault();
				panel(letter === "t" ? "browser" : "tasks", true);
				return;
			}
			// ⌘L for the trajectory: the log of what actually happened, beside the conversation.
			if (mod && !event.altKey && !event.shiftKey && letter === "l") {
				event.preventDefault();
				panel("trajectory", activeSessionId);
				return;
			}
			/*
			 * Ctrl+W on Windows and Linux: the pane in front, then the screen — never the window.
			 *
			 * It was the menu's `close`, which put the whole window into the tray, where the key means
			 * "close this tab or pane" to anyone on Windows. macOS keeps ⌘W as the system's own. A
			 * focused terminal never gets here: xterm takes Ctrl+W as the shell's delete-word and marks
			 * the key handled (see `terminal-keys.ts`). Handled here even when nothing closes, so the
			 * key does not fall through to the menu.
			 */
			if (!macKeyboard() && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && letter === "w") {
				event.preventDefault();
				closeInFront();
				return;
			}
			/*
			 * Ctrl+Tab and Ctrl+Shift+Tab — ⌃Tab on a Mac as well: the next or previous conversation by
			 * recency, into the screen being worked in, as pressing its row would. A focused terminal
			 * keeps the key: xterm takes it before it gets here.
			 */
			if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
				event.preventDefault();
				stepConversation(event.shiftKey ? -1 : 1);
				return;
			}
			// ⌃` is what every terminal-bearing editor uses, and it is not a ⌘ shortcut.
			if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "Backquote") {
				event.preventDefault();
				panel("terminal", true);
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
				if ((compact || overlay) && navOpen) dismissNav();
				else {
					// Full screen is per screen: Escape steps back in the one being worked in.
					const scope = currentScope();
					if (scope) usePaneDock.getState().restore(scope);
				}
			}
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled, compact, overlay, navOpen, toggleNav, dismissNav, activeSessionId, workspace]);
}

/**
 * Keys that mean the same on every screen of the main window, settings included: a new
 * conversation and the settings themselves.
 *
 * Ctrl+N and Ctrl+, on Windows and Linux, ⌘N and ⌘, on a Mac — the chords Codex, VS Code and the
 * browsers use, and none of them did anything here. Reached for rather than passed in, as the tray's
 * own 新对话 and 设置… are (`tray-commands.ts`). A focused terminal keeps Ctrl+N, readline's
 * next-history: xterm takes it before it gets here (`terminal-keys.ts`).
 */
export function useAppKeys(): void {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || composingKey(event) || event.altKey || event.shiftKey) return;
			const primary = macKeyboard() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			if (!primary) return;
			if (event.key === "," || event.code === "Comma") {
				event.preventDefault();
				useApp.getState().setView("settings");
				return;
			}
			if (shortcutLetter(event) === "n") {
				event.preventDefault();
				// Switch first, then create, as the tray does: the other order shows the new conversation over the old screen.
				const app = useApp.getState();
				app.setView("chat");
				void app.newSession();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
