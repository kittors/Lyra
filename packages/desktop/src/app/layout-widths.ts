/**
 * How wide the sidebar may be, and what it was last time.
 *
 * Remembered across launches because a width is a preference, not a state — someone who widened
 * the sidebar to read long session titles meant it for next time too. Clamped on the way back in,
 * since a stored width from a larger display would otherwise leave no room for anything else.
 */

export const SIDEBAR_DEFAULT = 272;
/**
 * Narrow enough to be worth dragging to, wide enough to draw the strip.
 *
 * Measured rather than chosen: the tab strip plus the two buttons beside it comes to 216px at the
 * default type size, and the list's own padding takes 10px either side — so the pane needs 236 for
 * the row to fit, and this leaves a few pixels over. The old floor was 208, which is 28px short:
 * dragging all the way in cut the archive button in half, because nothing in that row shrinks.
 *
 * The row shrinks now too (`SidebarTabs`), so a larger type size degrades by narrowing the tabs
 * rather than by pushing a control off the edge — this number is what keeps that from being needed
 * at the size almost everyone runs.
 */
export const SIDEBAR_MIN = 240;
/** Past this the sidebar is wider than the thing it navigates, which is not a use. */
export const SIDEBAR_MAX = 420;

/*
 * The right-hand panel's widths used to live here too. The dock divides itself in shares and
 * remembers them per project, so there is no one width left to store — what replaced them is
 * `CONVERSATION_MIN_WIDTH_PX` and `PANEL_MIN_WIDTH_PX` in `dock/geometry.ts`, which are floors on
 * how small a pane may be *drawn* rather than a width anything is set to.
 */

export function storedWidth(key: string, fallback: number, min: number, max: number): number {
	const raw = Number(window.localStorage.getItem(key));
	return Number.isFinite(raw) && raw > 0 ? Math.min(max, Math.max(min, raw)) : fallback;
}
