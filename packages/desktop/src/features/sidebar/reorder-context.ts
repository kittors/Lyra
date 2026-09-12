/**
 * Context and helpers for reordering projects and sessions via pointer drag.
 */

import { createContext, useContext } from "react";

type DragKind = "project" | "session";

export interface DraggingItem {
	kind: DragKind;
	id: string; // project path or session id
	title: string;
	projectPath?: string; // only for session
}

export interface DropTarget {
	kind: DragKind;
	id: string;
	placement: "before" | "after";
}

export interface SidebarReorderContextValue {
	dragging: DraggingItem | null;
	dropTarget: DropTarget | null;
	startDrag: (item: DraggingItem, event: React.PointerEvent) => void;
	registerTarget: (kind: DragKind, id: string, rect: DOMRect, clientY: number, projectPath?: string) => void;
	clearTarget: (id: string) => void;
}

export const SidebarReorderContext = createContext<SidebarReorderContextValue | null>(null);

export function useSidebarReorderContext(): SidebarReorderContextValue | null {
	return useContext(SidebarReorderContext);
}
