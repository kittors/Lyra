/**
 * The tree, flattened into rectangles.
 *
 * This exists to solve one problem, and it is the problem that decides whether the whole dock is
 * usable: **a pane must never be unmounted by a rearrangement.**
 *
 * Rendering the tree recursively is the obvious approach and it is wrong. React reconciles by
 * position, so a pane that moves from one branch to another is a different element at a different
 * depth — it gets unmounted and remounted. For most panels that would only lose a scroll position.
 * For the terminal it kills the shell and its scrollback; for the browser it reloads the page. The
 * old panel already knew this, which is why it kept every tab mounted and merely hid the ones
 * behind. Dragging panes around makes the same promise, and it has to be kept the same way.
 *
 * So the tree is never rendered. It is *measured*: turned into a flat list of boxes in fractions
 * of the dock, and the panes are drawn as one flat, stable list positioned absolutely. React sees
 * the same elements in the same order no matter how the layout changes, and what moves is CSS —
 * which is also what makes the rearrangement animate for free.
 */

import { COLUMN_LIMIT, EPSILON } from "./geometry.ts";
import type { Axis, DockNode, PaneKind } from "./tree.ts";

/**
 * A rectangle in fractions of the dock, 0 to 1 on both axes.
 *
 * Fractions rather than pixels so this stays pure: it needs no element, no measurement and no
 * layout pass, and it produces the same answer before the first paint as after it. The percentages
 * go straight onto the elements, so a window resize is handled by the browser rather than by a
 * recalculation here.
 */
export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface PaneBox extends Box {
	kind: PaneKind;
}

/**
 * One draggable boundary between two panes.
 *
 * Identified by the split it belongs to and the child on its near side, which is exactly what
 * `resize` in `tree.ts` takes — so a handle can act without anything in between having to work
 * out what it is a handle *for*.
 */
export interface SplitterBox extends Box {
	path: number[];
	index: number;
	dir: Axis;
	/** The near pane's current share, so a drag can start from where the handle actually is. */
	share: number;
	/** The two panes' shares combined, which is the range a drag on this handle may cover. */
	pair: number;
	/**
	 * The box of the split this handle divides.
	 *
	 * Carried here rather than looked up later because it is the frame of reference a drag on this
	 * handle is measured in — and it is already known at the moment the handle is produced.
	 */
	split: Box;
}

const FULL: Box = { left: 0, top: 0, width: 1, height: 1 };

/** Carve a child's box out of its parent's, given where along the axis it starts and how much it takes. */
function slice(rect: Box, dir: Axis, offset: number, share: number): Box {
	return dir === "row"
		? { left: rect.left + offset * rect.width, top: rect.top, width: share * rect.width, height: rect.height }
		: { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: share * rect.height };
}

/**
 * Every pane and where it sits, in the tree's own order.
 *
 * The order matters and is deliberately the tree's rather than anything stable: it is what the
 * collapsed form and the keyboard walk through, and reading left-to-right, top-to-bottom is what
 * anyone looking at the window would call the order. Where React needs stability it keys by
 * `kind`, which cannot change.
 */
export function layoutPanes(tree: DockNode, within: Box = FULL): PaneBox[] {
	const out: PaneBox[] = [];
	const walk = (node: DockNode, rect: Box) => {
		if (node.type === "leaf") {
			out.push({ kind: node.kind, ...rect });
			return;
		}
		let offset = 0;
		node.children.forEach((child, i) => {
			const share = node.sizes[i] ?? 0;
			walk(child, slice(rect, node.dir, offset, share));
			offset += share;
		});
	};
	walk(tree, within);
	return out;
}

/**
 * Every boundary that can be dragged.
 *
 * A split of n children has n−1 of them — the outer edges of a split are the edges of whatever
 * contains it, and are not boundaries between two panes.
 *
 * Each is drawn as a zero-thickness line; the grab area is added by the component, which is the
 * only place that knows how many pixels nine of them are.
 */
export function layoutSplitters(tree: DockNode, within: Box = FULL): SplitterBox[] {
	const out: SplitterBox[] = [];
	const walk = (node: DockNode, rect: Box, path: number[]) => {
		if (node.type === "leaf") return;
		let offset = 0;
		node.children.forEach((child, i) => {
			const share = node.sizes[i] ?? 0;
			const childRect = slice(rect, node.dir, offset, share);
			walk(child, childRect, [...path, i]);
			offset += share;
			// The boundary after this child, unless this was the last one.
			if (i < node.children.length - 1) {
				const next = node.sizes[i + 1] ?? 0;
				out.push({
					path,
					index: i,
					dir: node.dir,
					share,
					pair: share + next,
					split: rect,
					...(node.dir === "row"
						? { left: rect.left + offset * rect.width, top: rect.top, width: 0, height: rect.height }
						: { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: 0 }),
				});
			}
		});
	};
	walk(tree, within, []);
	return out;
}

/** The smallest a pane may be drawn, in pixels, on each axis. */
export interface Floor {
	width: number;
	height: number;
}

/**
 * Share out one split's length so nobody falls below their floor, keeping the total exactly.
 *
 * All values are pixels along the split's own axis. Panes short of their floor are brought up to
 * it, and the shortfall is taken from whoever has room to spare, in proportion to how much spare
 * they have — so squeezing one pane against its floor pushes the squeeze onward to the next one
 * rather than stopping there.
 *
 * That "pushes it onward" is the entire behaviour this exists for. Dragging the boundary on the
 * conversation's right used to stop having any effect once the conversation hit its floor — or
 * worse, let it grow out past its box and under the panel beside it. What should happen, and now
 * does, is that the pane on the *other* side gives up the room instead.
 *
 * Repeated because taking room from a pane can push that one below its own floor; each pass pins
 * at least one more, so it cannot loop.
 */
function fitSizes(sizes: number[], floors: number[], mayOverlap = false): number[] {
	const total = sizes.reduce((sum, size) => sum + size, 0);
	const needed = floors.reduce((sum, floor) => sum + floor, 0);
	if (needed >= total) {
		/*
		 * Not enough room for everyone's floor. Somebody has to give, and the question is *how*.
		 *
		 * Dividing what there is in proportion to the floors — which is what this used to do — puts
		 * every pane below its own minimum at once. Nothing is readable and nothing is at the size
		 * it says it is: a 420pt conversation drawn at 320 has its words breaking one per line, and
		 * the terminal beside it is wrapping its own prompt.
		 *
		 * So instead everyone keeps their floor except the *first*, which absorbs the entire
		 * shortfall. Its box goes as small as it has to; a `min-width` on the pane then draws it at
		 * its floor anyway — see `DockPane` — so it extends past its box and the pane after it is
		 * drawn over the overhang. The result is a conversation that is still laid out at its own
		 * width, with its right-hand side covered rather than reflowed.
		 *
		 * That overhang is the thing `geometry.ts` warns about, and this is the deliberate version
		 * of it. The accident it describes was a pane that believed it was tiling and was not: every
		 * pane could overflow, in any direction, and a panel silently ate a slice of the
		 * conversation. Here exactly one pane overflows, only when the row genuinely cannot hold its
		 * floors, only along the row's own axis, and the sizes still add up to the row — so nothing
		 * downstream has to know.
		 *
		 * `mayOverlap` is false for a column. Overlapping vertically would cover either the
		 * conversation's composer or the next pane's title bar, and those are the controls you need
		 * in order to undo it.
		 */
		if (mayOverlap && floors.length > 1) {
			const others = needed - floors[0];
			// Only when the rest of them genuinely fit. Otherwise the overhang would be the whole
			// row and the panes after the first would themselves be pushed off the end.
			if (others < total - EPSILON) {
				const out = [...floors];
				out[0] = total - others;
				return out;
			}
		}
		// The fallback, and the honest answer when even the panes after the first will not fit.
		return needed > 0 ? floors.map((floor) => (floor / needed) * total) : sizes.map(() => total / sizes.length);
	}

	const out = [...sizes];
	for (let pass = 0; pass < sizes.length; pass++) {
		const spare = out.map((size, i) => Math.max(0, size - floors[i]));
		const deficit = out.reduce((sum, size, i) => sum + Math.max(0, floors[i] - size), 0);
		if (deficit <= EPSILON) break;
		const available = spare.reduce((sum, room) => sum + room, 0);
		if (available <= EPSILON) break;
		const take = Math.min(deficit, available);
		for (let i = 0; i < out.length; i++) {
			if (out[i] < floors[i]) out[i] = floors[i];
			else out[i] -= (spare[i] / available) * take;
		}
	}
	return out;
}

/** How much of `axis` a node needs before it stops being usable. */
function floorOf(node: DockNode, axis: Axis, floor: (kind: PaneKind) => Floor): number {
	if (node.type === "leaf") {
		const min = floor(node.kind);
		return axis === "row" ? min.width : min.height;
	}
	const children = node.children.map((child) => floorOf(child, axis, floor));
	// Along its own axis a split needs the sum of its children; across it, the largest of them.
	return node.dir === axis
		? children.reduce((sum, size) => sum + size, 0)
		: children.reduce((largest, size) => Math.max(largest, size), 0);
}

/**
 * The tree as it should be *drawn*, with every pane at or above its floor.
 *
 * Separate from the tree that is stored, and deliberately so: the stored one keeps the shares the
 * user actually dragged to, so widening the window returns the layout to them. This is the same
 * layout expressed against a particular window size, which is the only frame in which "too small
 * to read" means anything.
 */
export function fitTree(node: DockNode, span: { width: number; height: number }, floor: (kind: PaneKind) => Floor): DockNode {
	if (node.type === "leaf") return node;
	if (!(span.width > 0) || !(span.height > 0)) return node;

	// The sidebar can leave less room than the window's layout mode promises. Prefer the
	// other axis only when it keeps every floor; the persisted axis and shares remain intact.
	const fits = (dir: Axis) => {
		const candidate = { ...node, dir };
		return floorOf(candidate, "row", floor) <= span.width + EPSILON
			&& floorOf(candidate, "col", floor) <= span.height + EPSILON;
	};
	const other = node.dir === "row" ? "col" : "row";
	/*
	 * Turning the arrangement on its side is worth it for a pair, and not for a crowd.
	 *
	 * Clearing every floor is necessary and is not sufficient, which is what this used to assume.
	 * Two panes that will not fit side by side are both usable stacked, and that is the Windows case
	 * this was written for — a 498px dock, a conversation and a terminal, where a column is the only
	 * arrangement in which you can read either of them.
	 *
	 * Four is a different thing wearing the same arithmetic. Every pane clears its 150px floor and
	 * the answer is still a column of full-width strips: the arrangement someone had made, replaced
	 * on the layout's own initiative by one they did not ask for and cannot drag back — because this
	 * runs on every render and re-derives it every frame. That is what "the window feels locked" was.
	 *
	 * Past `COLUMN_LIMIT` the room is not there to be found by rotating, and the honest answer is
	 * that the row keeps its shape and overflows instead — see `fitSizes`.
	 */
	const worthTurning = node.children.length <= COLUMN_LIMIT;
	const dir = !fits(node.dir) && worthTurning && fits(other) ? other : node.dir;
	const along = dir === "row" ? span.width : span.height;
	const sizes = node.children.map((_, i) => (node.sizes[i] ?? 0) * along);
	const floors = node.children.map((child) => floorOf(child, dir, floor));
	// Overlap along a row only. See `fitSizes` for why a column does not.
	const fitted = fitSizes(sizes, floors, dir === "row");

	return {
		...node,
		dir,
		sizes: fitted.map((size) => (along > 0 ? size / along : 0)),
		children: node.children.map((child, i) =>
			fitTree(
				child,
				dir === "row" ? { width: fitted[i], height: span.height } : { width: span.width, height: fitted[i] },
				floor,
			),
		),
	};
}

/**
 * Turn a pointer position into the share the handle's near pane should take.
 *
 * The split's own box is the frame of reference, not the dock's. A handle inside a nested split
 * moves within *that* split's length, and measuring against the whole window would make it travel
 * at the wrong rate — sluggish inside a narrow column, and running off both ends of a wide one.
 *
 * `position` is a client coordinate on the drag axis: `clientX` for a row, `clientY` for a column.
 */
export function shareFromPointer(
	handle: SplitterBox,
	position: number,
	container: { left: number; top: number; width: number; height: number },
): number {
	const { split } = handle;
	const row = handle.dir === "row";
	const span = row ? split.width * container.width : split.height * container.height;
	if (!(span > 0)) return handle.share;

	// Where the split starts, and where the pointer is, both as a share of the split's length.
	const origin = row ? container.left + split.left * container.width : container.top + split.top * container.height;
	const at = (position - origin) / span;
	// How much of the split lies before the near pane — everything on this side of the handle
	// except the pane the handle is *for*.
	const boundary = row ? (handle.left - split.left) / split.width : (handle.top - split.top) / split.height;
	return at - (boundary - handle.share);
}
