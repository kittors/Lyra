/**
 * What the main window remembers about itself between launches, as a rule apart from Electron.
 *
 * Two things went wrong, both on Windows and both invisible on a Mac:
 *
 *   - A maximised window was not remembered at all. Its bounds are the screen's, not a size anyone
 *     chose, so they were never written — and with them went the fact that it was maximised, so
 *     every launch came back as an ordinary window. Now the *normal* bounds are kept, as before,
 *     with `maximized` beside them.
 *   - The window grew on every launch: 1202×802, then 1206×807, 1210×813, 1214×819 at 125%. What was
 *     saved was what the window read back, and a window built at 125% does not come out at the size
 *     it was asked for — rounding through physical pixels, and a few pixels of frame the system adds
 *     at creation. Saving the reading made each launch the next one's request. So until someone
 *     actually moves or resizes the window, the size it was asked for is what gets saved again.
 */

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	/** Maximised when last closed. Only Windows and Linux reopen it so; see `reopenMaximized`. */
	maximized?: boolean;
}

/** What the window was asked to open at, and what it actually opened at. */
export interface Opened {
	asked: Box;
	got: Box;
}

const same = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * The state to write now, or null to leave the file as it is.
 *
 * `normal` is the window's bounds in its ordinary state (`getNormalBounds`), which stays the size
 * someone chose while the window is maximised.
 */
export function stateToSave(input: {
	normal: Box;
	maximized: boolean;
	fullScreen: boolean;
	minimized: boolean;
	opened: Opened | null;
}): WindowState | null {
	// Full screen is a mode, and a minimised window is about to be something else; neither is a choice to keep.
	if (input.fullScreen || input.minimized) return null;
	const untouched = input.opened !== null && same(input.normal, input.opened.got);
	const box = untouched ? input.opened!.asked : input.normal;
	return { width: box.width, height: box.height, x: box.x, y: box.y, ...(input.maximized ? { maximized: true } : {}) };
}

/**
 * Whether to open maximised.
 *
 * Not on macOS: there "maximised" is the green button's zoom, which fills the screen without being a
 * mode, and the platform's convention is to reopen at the size the window had — which is what the
 * saved normal bounds already give.
 */
export function reopenMaximized(state: WindowState | null, platform: string): boolean {
	return platform !== "darwin" && state?.maximized === true;
}
