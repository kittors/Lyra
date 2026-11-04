/**
 * What Ctrl+W closes in the main window on Windows and Linux: the pane in front, then the screen.
 *
 * Ctrl+W there used to be the menu's `close`, which put the whole window into the tray — while on
 * Windows the key closes a tab or a pane, not the program. Now it peels one layer at a time: the
 * panel in front on the screen being worked in, and once that screen has no panels left, the
 * screen itself. A single screen with nothing beside its conversation is the end; the key does
 * nothing there rather than taking the window with it.
 *
 * "In front" is the panel holding keyboard focus; failing that, the one the dock last brought
 * forward (opening or pressing a panel does that); failing that, the last one in the layout. A
 * blank screen is never closed this way, as it has no close button either.
 *
 * Pure so it can be tested without a window; `closeInFront` in `app/shortcuts.ts` reads the inputs.
 */

export type FrontChoice = { pane: string } | { screen: string } | null;

export function frontToClose(input: {
	/** Panels open on the screen being worked in, in layout order — never the conversation. */
	open: readonly string[];
	/** The panel holding keyboard focus on that screen, if any. */
	active: string | null;
	/** The panel the dock last brought forward on that screen. */
	focused: string | null;
	/** How many screens the split shows. */
	screens: number;
	/** The screen's conversation; null for a blank screen. */
	sessionId: string | null;
}): FrontChoice {
	const { open, active, focused, screens, sessionId } = input;
	if (open.length > 0) {
		const pane = active && open.includes(active) ? active : focused && open.includes(focused) ? focused : open[open.length - 1];
		return { pane };
	}
	if (screens > 1 && sessionId) return { screen: sessionId };
	return null;
}
