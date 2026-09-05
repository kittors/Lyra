/**
 * How much of the window's top row belongs to the system, at each end.
 *
 * Every platform draws its own window controls over the page, and they are drawn *over* it — not
 * in the document, not measurable from it, and different at each end depending on which system it
 * is. Everything this app puts in that row has to be told to stay clear:
 *
 *   macOS    traffic lights at the left, a fixed width, gone in native full screen
 *   Windows  minimise/maximise/close at the right, width set by display scaling
 *   Linux    the same overlay as Windows when the desktop draws one
 *
 * Only macOS was ever handled. Everywhere else the window wore macOS's geometry: 78px held open at
 * the left for lights that are not there, so the sidebar toggle floated out of line with the marks
 * below it, and nothing at all at the right, where the system's own buttons sat on top of the
 * panel controls — drawn, and impossible to press, because the press went to the window manager.
 *
 * Kept apart from `layout.tsx` so the rule can be read and tested on its own; the hook there is
 * the part that subscribes to the overlay changing.
 */

/**
 * Where the first window control sits on macOS, measured from the window's left edge.
 *
 * The three traffic lights are 14pt wide on a 23pt pitch starting at x=16, ending at x=76.
 * The 28px toggle starts at 78; its centred 15px icon leaves an 8.5pt visual gap after the green light.
 */
export const TRAFFIC_LIGHTS_WIDTH = 78;

/**
 * And the margin the top row uses when there are no window controls at that end at all.
 *
 * macOS in native full screen, and the left-hand end of every window on Windows and Linux. 12 is
 * the same margin the rest of the window's edges use, which is what puts the sidebar toggle in
 * line with the search and notification marks directly below it.
 */
export const TOOLBAR_EDGE = 12;

/**
 * Three Windows buttons at 100% scaling, for the moment before the overlay reports its own size.
 *
 * An overlay that is enabled but not yet measured answers with a rect of zeroes, and treating that
 * as "nothing reserved" puts the panel controls straight back underneath the close button for as
 * long as it lasts.
 */
export const OVERLAY_FALLBACK = 138;

export interface TitlebarInsets {
	start: number;
	end: number;
}

export function titlebarInsets(
	platform: string,
	nativeFullScreen: boolean,
	/** What the system's own buttons take at the trailing end; see `overlayReserved`. */
	overlayEnd: number,
	/**
	 * Whether this is a window at all.
	 *
	 * On a phone it is not: the interface fills the screen, there are no traffic lights and no
	 * minimise button, and the notch is handled outside the page. Reserving for controls that do
	 * not exist left 78px of nothing at the top left — the toggle sat marooned in the middle of the
	 * row instead of at the edge where every other mark below it lines up.
	 */
	windowed = true,
): TitlebarInsets {
	if (!windowed) return { start: TOOLBAR_EDGE, end: TOOLBAR_EDGE };
	// macOS keeps its controls at the leading end and puts nothing at the other one.
	if (platform === "darwin") {
		return { start: nativeFullScreen ? TOOLBAR_EDGE : TRAFFIC_LIGHTS_WIDTH, end: 0 };
	}
	return { start: TOOLBAR_EDGE, end: overlayEnd };
}

/** The shape of `navigator.windowControlsOverlay`, reduced to what this needs. */
export interface OverlayLike {
	visible: boolean;
	getTitlebarAreaRect(): { right: number; width: number };
}

/**
 * How wide the system's own buttons are, from the one API that knows.
 *
 * `getTitlebarAreaRect` describes the strip left over *for the page*, so what the system took is
 * whatever lies beyond its right edge. Hidden — full screen, or a platform that draws no overlay —
 * leaves nothing to clear.
 */
export function overlayReserved(overlay: OverlayLike | undefined, windowWidth: number): number {
	if (!overlay?.visible) return 0;
	const rect = overlay.getTitlebarAreaRect();
	if (rect.width === 0) return OVERLAY_FALLBACK;
	return Math.max(0, Math.round(windowWidth - rect.right));
}
