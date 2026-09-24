/**
 * The few dock operations a pointer drag needs, so every screen's dock shares one gesture.
 */

import type { DropAt, DockNode, PaneKind } from "./tree.ts";
import type { Floor } from "./layout.ts";

/** A drag in flight. Null the rest of the time, which is almost all of it. */
export interface DragState {
	kind: PaneKind;
	/** Where the pane was when the drag began, so the ghost can start there rather than jump. */
	from: { left: number; top: number; width: number; height: number };
	/** How far into the pane the pointer grabbed it, so the ghost hangs off the pointer correctly. */
	grip: { x: number; y: number };
	pointer: { x: number; y: number };
	/** The landing place currently committed to the tree, so a move is not re-applied per frame. */
	at: DropAt | null;
	/** The tree as it was before the drag, to restore if it lands nowhere. */
	before: DockNode;
	/**
	 * The layout without the carried pane, which is what the drag is hit-tested against.
	 *
	 * Fixed for the whole drag. The preview inserts into a copy of this rather than into whatever
	 * the previous frame produced — see `preview` in `pane-store.ts`.
	 */
	rest: DockNode;
}

export interface DockDragHost {
	floor?: (kind: PaneKind) => Floor;
	preserveAxis?: boolean;
	tree(): DockNode;
	restore(): void;
	beginDrag(drag: DragState): void;
	preview(rest: DockNode, kind: PaneKind, at: DropAt | null): void;
	dragTo(pointer: { x: number; y: number }, at: DropAt | null): void;
	endDrag(cancelled?: boolean): void;
	currentDrag(): DragState | null;
}
