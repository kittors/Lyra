/**
 * Where a selection is, where its handles are, and where the toolbar can sit.
 *
 * Separated from the overlay because all of it is arithmetic with no React in it — which means it
 * can be tested, and the rules that are easy to get subtly wrong (a handle that reports the corner
 * you are not on, a drag that inverts the rectangle, a toolbar that leaves the screen) are the
 * ones worth testing rather than clicking through.
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/**
 * The eight directions, named the way CSS cursors are.
 *
 * Ordered corners first so a hit test that walks this list prefers a corner where a corner and an
 * edge overlap — which they always do, and where the corner is what the pointer is aiming at.
 */
export const HANDLES = ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const;

export type Handle = (typeof HANDLES)[number];

/** The cursor each handle should show, which is its name plus the suffix CSS wants. */
export const HANDLE_CURSOR: Record<Handle, string> = {
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
};

/** Where a handle sits, as a point on the selection's edge. */
export function handlePoint(rect: Rect, handle: Handle): Point {
	const midX = rect.x + rect.width / 2;
	const midY = rect.y + rect.height / 2;
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	switch (handle) {
		case "nw": return { x: rect.x, y: rect.y };
		case "n": return { x: midX, y: rect.y };
		case "ne": return { x: right, y: rect.y };
		case "e": return { x: right, y: midY };
		case "se": return { x: right, y: bottom };
		case "s": return { x: midX, y: bottom };
		case "sw": return { x: rect.x, y: bottom };
		case "w": return { x: rect.x, y: midY };
	}
}

/**
 * Which handle the pointer is on, or null.
 *
 * `tolerance` is a radius in screen pixels rather than the handle's drawn size: the target has to
 * be bigger than the mark for the same reason a scrollbar's is — eight pixels of square is not
 * something a hand lands on reliably.
 */
export function hitHandle(rect: Rect, at: Point, tolerance: number): Handle | null {
	for (const handle of HANDLES) {
		const point = handlePoint(rect, handle);
		if (Math.abs(at.x - point.x) <= tolerance && Math.abs(at.y - point.y) <= tolerance) return handle;
	}
	return null;
}

/** Whether a point is inside the selection, which is what starts a move rather than a new drag. */
export function insideRect(rect: Rect, at: Point): boolean {
	return at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height;
}

/** A rectangle from two corners, in either order. */
export function rectFromPoints(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

/**
 * The selection after dragging one handle to a point.
 *
 * Written as "move the edges this handle owns, then normalise", so dragging past the opposite edge
 * flips the rectangle rather than producing a negative width — which is what a person expects from
 * every other resize they have ever done, and what `rectFromPoints` already encodes.
 */
export function resizeRect(rect: Rect, handle: Handle, to: Point): Rect {
	let { x: left, y: top } = rect;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;

	if (handle.includes("n")) top = to.y;
	if (handle.includes("s")) bottom = to.y;
	if (handle.includes("w")) left = to.x;
	if (handle.includes("e")) right = to.x;

	return rectFromPoints({ x: left, y: top }, { x: right, y: bottom });
}

/** The selection moved by a delta, kept whole and kept on screen. */
export function moveRect(rect: Rect, dx: number, dy: number, within: { width: number; height: number }): Rect {
	/*
	 * Clamped rather than truncated: dragging a selection off the edge should stop it at the edge
	 * with its size intact, not shrink it. `Math.max(0, …)` on the low side and the screen's extent
	 * minus the selection on the high side is exactly that.
	 */
	const x = Math.min(Math.max(0, rect.x + dx), Math.max(0, within.width - rect.width));
	const y = Math.min(Math.max(0, rect.y + dy), Math.max(0, within.height - rect.height));
	return { ...rect, x, y };
}

/** The selection clipped to the screen, for a resize that ran past the edge. */
export function clampRect(rect: Rect, within: { width: number; height: number }): Rect {
	const left = Math.max(0, rect.x);
	const top = Math.max(0, rect.y);
	const right = Math.min(within.width, rect.x + rect.width);
	const bottom = Math.min(within.height, rect.y + rect.height);
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** How far the toolbar sits from the selection, and from the edge of the screen. */
const TOOLBAR_GAP = 12;
const SCREEN_MARGIN = 12;

/**
 * Where the toolbar goes: under the selection, aligned to its left edge.
 *
 * Left-aligned because the first control is the one reached most, and because a toolbar that
 * starts where the selection starts reads as belonging to it — right-aligning it against a
 * selection narrower than the toolbar pushes the controls away from the thing they act on.
 *
 * It flips above when there is no room below, and slides along the edge rather than hanging off
 * it. Both are ordinary; what is not is a selection at the very bottom of a short screen, where
 * neither side fits — there it goes inside, at the bottom, which is the only place left.
 */
/**
 * Where the toolbar goes, and which side of the region it ended up on.
 *
 * The side is not decoration: anything the bar opens — the size and colour bubble, for one — has to
 * open *away* from the region, or it covers the very thing being annotated. Only the caller of this
 * function knows which way that is, so it is returned rather than guessed at downstream.
 */
export interface ToolbarPlacement extends Point {
	/** `over` means neither side fits and the bar is on top of the region. */
	side: "below" | "above" | "over";
}

export function toolbarPosition(
	rect: Rect,
	viewport: { width: number; height: number },
	toolbar: { width: number; height: number },
	/**
	 * How tall the bubble the bar opens is, if it opens one.
	 *
	 * The bar was placed as though it were the only thing that had to fit, and the size-and-colour
	 * bubble opens *further* from the region than the bar — so a selection reaching the bottom of
	 * the screen put the bar in the last strip that fitted and the bubble below that, off the
	 * screen entirely. All that was visible of it was a row of pixels along the bottom edge.
	 *
	 * Counted as part of the stack on both sides: a side only counts as fitting if the bar *and*
	 * whatever it opens both land on screen there.
	 */
	bubble: { height: number } = { height: 0 },
): ToolbarPlacement {
	const extra = bubble.height > 0 ? TOOLBAR_GAP + bubble.height : 0;
	const stack = toolbar.height + extra;
	const below = rect.y + rect.height + TOOLBAR_GAP;
	const above = rect.y - toolbar.height - TOOLBAR_GAP;

	let y: number;
	let side: ToolbarPlacement["side"];
	if (below + stack <= viewport.height - SCREEN_MARGIN) {
		y = below;
		side = "below";
	} else if (above - extra >= SCREEN_MARGIN) {
		y = above;
		side = "above";
	} else {
		/*
		 * Neither side fits the whole stack, so the bar sits over the region — high enough that the
		 * bubble, which opens upward in this state, still has somewhere to go.
		 */
		y = Math.max(SCREEN_MARGIN, viewport.height - toolbar.height - SCREEN_MARGIN);
		// Neither side fits, so the bar is over the region itself and there is no "away from the
		// selection" left to be on.
		side = "over";
	}

	/*
	 * Right-aligned to the selection, then kept on screen.
	 *
	 * The bar ends with the two controls that finish the job — cancel and confirm — and lining its
	 * right edge up with the region's puts those under the hand that just released the drag, which
	 * usually ended at the bottom-right corner. Left-aligned, the same two buttons are a whole bar's
	 * width away from where the gesture ended.
	 */
	const x = Math.min(
		Math.max(SCREEN_MARGIN, rect.x + rect.width - toolbar.width),
		Math.max(SCREEN_MARGIN, viewport.width - toolbar.width - SCREEN_MARGIN),
	);
	return { x, y, side };
}
