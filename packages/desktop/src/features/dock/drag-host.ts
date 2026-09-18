/**
 * The few dock operations a pointer drag needs, so the window dock and a
 * screen dock can share one gesture.
 */

import type { DropAt, DockNode, PaneKind } from "./tree.ts";
import type { DragState } from "./store.ts";

export interface DockDragHost {
	tree(): DockNode;
	restore(): void;
	beginDrag(drag: DragState): void;
	preview(rest: DockNode, kind: PaneKind, at: DropAt | null): void;
	dragTo(pointer: { x: number; y: number }, at: DropAt | null): void;
	endDrag(cancelled?: boolean): void;
	currentDrag(): DragState | null;
}
