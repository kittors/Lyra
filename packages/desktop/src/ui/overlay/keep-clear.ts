/**
 * Where a menu goes when it must not cover the thing it is about.
 *
 * A right-click menu hangs from the cursor, and that is right for a pointer: the row it acts on is
 * under the cursor, and a menu opening beside the cursor opens beside the row. A long press has no
 * cursor. The finger is on the row, the row is lifted to show what the menu is about, and a menu
 * hung from the touch point lands on top of the very thing it is meant to be presenting — so the
 * phone registers the lifted rectangle here and the popover arranges itself around it instead.
 *
 * The same rule iOS uses for its own context menus: below the row if it fits, above if that fits,
 * and when neither does — a row near the bottom with a tall menu — the row travels up to make room
 * rather than being covered. Only the last case needs the row to move, and `shift` says how far.
 *
 * Kept in `ui/` and free of any notion of a phone: a popover asks "is there something to keep clear
 * of", and whoever registered it decides what that means.
 */

export interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export interface Placement {
	left: number;
	top: number;
	/** The menu's ceiling in the space it was given; it scrolls inside that rather than spilling. */
	maxHeight: number;
	/** How far the kept-clear rectangle has to travel (negative is up) to sit against the menu. */
	shift: number;
	/** Which side of the rectangle the menu ended up on. `over` when the rectangle fills the screen. */
	side: "below" | "above" | "over";
	/** Which edge the menu grows from, for the opening scale. */
	origin: string;
}

export interface KeepClear {
	/** The lifted thing, in viewport coordinates. */
	rect: Rect;
	/** Told where the menu landed, every time it is placed — the lift follows it. */
	onPlace?: (placement: Placement) => void;
}

/** Between the lifted thing and its menu: enough to read as two objects, close enough to read as one gesture. */
export const CLEAR_GAP = 10;

let held: KeepClear | null = null;

/** Register — or, with null, release — the rectangle the next point-anchored popover keeps clear of. */
export function holdClear(value: KeepClear | null): void {
	held = value;
}

export function heldClear(): KeepClear | null {
	return held;
}

/**
 * Put a menu of `size` beside `rect`, inside `bounds`.
 *
 * Horizontally it lines up with whichever edge of the rectangle is nearer the middle of the screen's
 * side it sits on: a sent message is right-aligned, and a menu hanging off its left edge would point
 * at nothing.
 */
export function placeBeside(
	rect: Rect,
	size: { width: number; height: number },
	bounds: Rect,
	gap = CLEAR_GAP,
): Placement {
	const room = Math.max(0, bounds.bottom - bounds.top);
	const height = Math.min(size.height, room);
	const middle = (bounds.left + bounds.right) / 2;
	const rightAligned = (rect.left + rect.right) / 2 > middle && rect.right - rect.left < (bounds.right - bounds.left) * 0.9;
	const wanted = rightAligned ? rect.right - size.width : rect.left;
	const left = Math.min(Math.max(bounds.left, wanted), Math.max(bounds.left, bounds.right - size.width));
	const originX = Math.min(Math.max(0, (rightAligned ? rect.right : rect.left + 24) - left), size.width);

	const below = rect.bottom + gap;
	if (below + height <= bounds.bottom) {
		return { left, top: below, maxHeight: bounds.bottom - below, shift: 0, side: "below", origin: `${originX}px 0px` };
	}
	const above = rect.top - gap - height;
	if (above >= bounds.top) {
		return { left, top: above, maxHeight: height, shift: 0, side: "above", origin: `${originX}px 100%` };
	}

	/*
	 * Neither side has room. If the rectangle and the menu fit together, stack them against the
	 * bottom and move the rectangle up to meet the menu — the thumb is at the bottom, and so is
	 * the menu it is about to use.
	 */
	const tall = rect.bottom - rect.top;
	if (tall + gap + height <= room) {
		const top = bounds.bottom - height;
		const shift = top - gap - tall - rect.top;
		return { left, top, maxHeight: height, shift, side: "below", origin: `${originX}px 0px` };
	}

	// A rectangle taller than the screen can spare — a long reply. The menu goes over its lower part.
	return { left, top: bounds.bottom - height, maxHeight: room, shift: 0, side: "over", origin: `${originX}px 100%` };
}

/**
 * The host's own chrome, as the stylesheet declares it — the notch, the home indicator.
 *
 * Read from `--ly-safe-*` on the root rather than asked of anything else, so a surface in `ui/`
 * learns about it without learning what a phone is. Absent everywhere but on a phone, where they
 * are all zero and every caller behaves as it always did.
 */
export function safeInsets(): Rect {
	if (typeof document === "undefined" || !document.documentElement) return { top: 0, bottom: 0, left: 0, right: 0 };
	const style = getComputedStyle(document.documentElement);
	const read = (side: string) => {
		const value = Number.parseFloat(style.getPropertyValue(`--ly-safe-${side}`));
		return Number.isFinite(value) && value > 0 ? value : 0;
	};
	return { top: read("top"), bottom: read("bottom"), left: read("left"), right: read("right") };
}
