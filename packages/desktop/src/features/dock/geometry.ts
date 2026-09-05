import type { PaneKind } from "./tree.ts";

/**
 * The numbers the dock is built out of.
 *
 * Kept apart from the components so the pure layout code — the tree, the drop test — can be read
 * and tested without pulling React in behind them.
 */

/**
 * How thin a pane may get, as a share of its row or column.
 *
 * A *share*, not a pixel count, because that is what the tree stores: pixels would have to be
 * recomputed and re-normalised on every window resize, and the rounding drift from doing that
 * repeatedly is what makes a layout creep. The pixel floor is a separate, simpler thing —
 * `min-width`/`min-height` on the pane itself, enforced by the browser.
 *
 * 8% rather than something smaller: below this a pane is a sliver you cannot read or aim at, and
 * a drag that lands there looks like the pane was lost rather than moved.
 */
export const MIN_FRACTION = 0.08;

/**
 * How small a pane may be drawn, in pixels.
 *
 * A share cannot express this. 8% of a wide window is a usable column and 8% of a small one is a
 * ribbon, and the conversation has a size below which it stops being readable at all: the words
 * begin breaking one per line.
 *
 * These are enforced by *redistribution*, not by overflow — see `fitTree`. Dragging a splitter into
 * the conversation's floor pushes the squeeze onward to whatever is on its other side, so the row
 * always adds up to the row. An earlier version let the pane grow past its box instead, which is
 * how a panel ended up with a slice of the conversation hidden underneath it.
 */
export const CONVERSATION_MIN_WIDTH_PX = 420;
/** Vertically: a title bar, the composer, and something between them. */
const CONVERSATION_MIN_HEIGHT_PX = 260;
/**
 * A panel's floor: smaller than the conversation's, so panels give way first — but not small
 * enough to be useless.
 *
 * 300 is what the old side panel used, and it is about the width at which a terminal stops
 * wrapping its own prompt and a file tree stops truncating every name. 180 was tried and was
 * plainly too narrow: at that size a shell wraps `Using Node v24.18.0` onto two lines.
 *
 * The height is a title bar plus enough content to be worth having opened.
 */
export const PANEL_MIN_WIDTH_PX = 300;
const PANEL_MIN_HEIGHT_PX = 150;

/**
 * How small each kind may be drawn.
 *
 * One definition, shared by the renderer and the drag's hit test — they have to agree, or the drop
 * regions sit somewhere other than the panes they belong to.
 *
 * The conversation's floor being much larger than a panel's is what decides who gives way:
 * squeezing a row pushes the panels down to their floors before the conversation moves at all.
 */
export const paneFloor = (kind: PaneKind): { width: number; height: number } =>
	kind === "conversation"
		? { width: CONVERSATION_MIN_WIDTH_PX, height: CONVERSATION_MIN_HEIGHT_PX }
		: { width: PANEL_MIN_WIDTH_PX, height: PANEL_MIN_HEIGHT_PX };

/** Floating-point slack. Shares are compared, added and re-normalised constantly. */
export const EPSILON = 1e-6;

/**
 * How much of a pane's width or height counts as its edge, for the drop test.
 *
 * 28% leaves a centre region that is comfortably larger than any of the four bands, which is what
 * makes "I did not mean to split anything" the easy gesture rather than a lucky one.
 */
export const EDGE_BAND = 0.28;

/**
 * How far in from the dock's outer edge a drop lands on the *root* instead of on a pane.
 *
 * In pixels, not a share: this is a target the hand aims at, and a target that grows with the
 * window is one you have to re-learn every time the window changes. 26 is a little over a
 * fingertip's worth of slop at pointer precision.
 */
export const ROOT_BAND = 26;

/**
 * The pane title bar, which is also the window's top row.
 *
 * The traffic lights' centre line is at y=22, and a pane in the
 * top row has to put its own title on that same line or the window reads as two misaligned strips.
 * There is no separate toolbar above the dock any more — the top row *is* the first row of panes,
 * so this number belongs to both.
 */
export { WINDOW_HEADER_HEIGHT as HEADER_HEIGHT } from "../../../shared/window-chrome.ts";

/**
 * The gap around each pane, which is what makes them read as separate cards.
 *
 * Applied inside the pane's box rather than by shrinking the box, which keeps the tiling
 * arithmetic exact — the boxes still meet edge to edge, and the seam is each of two neighbours
 * holding back this much.
 */
export const PANE_INSET = 3;

/**
 * The header's own left padding, before any inset for the traffic lights.
 *
 * Named because the traffic-light inset is derived from it: the lights sit at a fixed distance
 * from the *window's* edge, and what the header needs is that distance minus everything already
 * between them — this padding and the card's border.
 */
export const HEADER_PAD = 10;

/**
 * The grip's target: how far it reaches around the mark it draws.
 *
 * The mark is 36×3, which is far too small to aim at, so the pressable area is bigger than the
 * thing you see. Bigger, but not unbounded — the point of moving the drag off the whole title bar
 * is that pressing the bar should do nothing, so this stays a patch around the mark rather than a
 * strip across the pane.
 */
export const GRIP_WIDTH = 64;
export const GRIP_REACH = 17;

/**
 * How far the pointer may travel before a press on a header becomes a drag.
 *
 * Without a threshold every click on a header — to focus a pane, to hit its close button — starts
 * a one-pixel drag, and the layout flickers under the pointer on an ordinary click.
 */
export const DRAG_THRESHOLD = 4;

/**
 * The splitter's grab area, straddling the boundary between two panes.
 *
 * Same 9px as `ResizeHandle` uses on the sidebar, for the same reason: it is the smallest strip
 * that can be hit reliably without being a visible border.
 */
export const SPLITTER_HIT = 9;

/** Keyboard resizing, per press, as a share. Shift multiplies it. */
export const SPLITTER_STEP = 0.02;

/** How long the splitter's grip is: enough to read as a handle, short enough not to read as a border. */
export const GRIP_SPAN = 30;
