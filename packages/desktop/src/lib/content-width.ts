/**
 * How wide the conversation column may get.
 *
 * Its own file, away from the drawing, because it is arithmetic with a sentinel in it and the
 * failure is invisible: a measure of 40px looks like a broken layout rather than like a setting
 * that was never bounded, and by then the settings page is one word per line too.
 *
 * The value can arrive from a hand-edited `settings.json` as well as from the page, so it is
 * clamped on the way out rather than on the way in.
 */

/** Fill the window: two margins and no ceiling. Stored as a number so the setting stays one field. */
export const CONTENT_FILL = 0;

/**
 * Follow the pane, in three steps: full width below 864px, at most 864px up to 1279px, at most
 * 1120px from 1280px. The default — the column ZCode draws, wide where there is room for it and
 * never a narrow strip down the middle of a wide window. The steps are container queries on the pane
 * (`dock.css`); this only switches them on.
 */
export const CONTENT_AUTO = -1;

/** Narrower than this and a reply's code blocks wrap into columns nobody can read. */
export const CONTENT_MIN = 560;

/**
 * Past this the line is longer than the eye tracks comfortably, and 「铺满」 says the same thing
 * better on any window wide enough to reach it.
 */
export const CONTENT_MAX = 1600;

/** What the app rendered at before this was configurable, and the 「标准」 preset. */
export const CONTENT_DEFAULT = 640;

/** The five the segmented control offers; the field beside it covers everything between. */
const CONTENT_PRESETS = [CONTENT_AUTO, CONTENT_DEFAULT, 800, 960, CONTENT_FILL] as const;

/**
 * Which preset a stored width is, or `""` for a number typed into the field.
 *
 * The empty string is deliberate: it matches no button, so a custom measure leaves the segmented
 * control with nothing lit rather than lighting whichever preset is nearest — which would claim the
 * app is at 800 while it renders at 870.
 */
export function contentPreset(width: number | undefined): string {
	const value = width ?? CONTENT_AUTO;
	return (CONTENT_PRESETS as readonly number[]).includes(value) ? String(value) : "";
}

/** The CSS value for `--ly-content`. */
export function contentMeasure(width: number | undefined): string {
	// Auto starts from the whole column; the pane's container queries narrow it (see `CONTENT_AUTO`).
	if (width === undefined || !Number.isFinite(width) || width === CONTENT_AUTO) return "100%";
	if (width === CONTENT_FILL) return "100%";
	return `${Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, Math.round(width)))}px`;
}
