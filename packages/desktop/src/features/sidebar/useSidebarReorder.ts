import { translate } from "../../i18n/translate.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../store/index.ts";
import type { SortKey } from "./ListMenu.tsx";
import type { Grouped } from "./grouping.ts";
import type { DraggingItem, DropTarget, SidebarReorderContextValue } from "./reorder-context.ts";

const DRAG_THRESHOLD = 5;

export function useSidebarReorder(groups: Grouped, sort: SortKey, onReordered?: () => void): {
	contextValue: SidebarReorderContextValue;
	dragging: DraggingItem | null;
	dropTarget: DropTarget | null;
	pointer: { x: number; y: number };
} {
	const [dragging, setDragging] = useState<DraggingItem | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [pointer, setPointer] = useState({ x: 0, y: 0 });
	const candidateRef = useRef<{ item: DraggingItem; originX: number; originY: number; pointerId: number } | null>(null);
	const draggingRef = useRef<DraggingItem | null>(null);
	const dropTargetRef = useRef<DropTarget | null>(null);
	const suppressClick = useRef(false);
	const saving = useRef(false);

	const eligible = useCallback((kind: "project" | "session", id: string, projectPath?: string) => {
		if (!onReordered) return false;
		const all = [...groups.pinned, ...groups.projects];
		if (kind === "session") return all.some((group) => group.path === projectPath && group.sessions.some((session) => session.id === id));
		return all.some((group) => group.path === id) && Boolean(useApp.getState().settings?.projects.some((project) => project.path === id));
	}, [groups, onReordered]);

	const reset = useCallback(() => {
		candidateRef.current = null;
		draggingRef.current = null;
		dropTargetRef.current = null;
		setDragging(null);
		setDropTarget(null);
	}, []);

	const startDrag = useCallback((item: DraggingItem, event: React.PointerEvent) => {
		// Touch keeps native scrolling; only a row's primary button starts a mouse drag.
		if (event.button !== 0 || event.pointerType !== "mouse" || saving.current || !eligible(item.kind, item.id, item.projectPath)) return;
		candidateRef.current = { item, originX: event.clientX, originY: event.clientY, pointerId: event.pointerId };
		setPointer({ x: event.clientX, y: event.clientY });
	}, [eligible]);

	const registerTarget = useCallback((kind: "project" | "session", id: string, rect: DOMRect, clientY: number, projectPath?: string) => {
		const active = draggingRef.current;
		if (!active || active.kind !== kind || active.id === id || !eligible(kind, id, projectPath)) return;
		if (kind === "session" && active.projectPath !== projectPath) return;
		if (kind === "project" && groups.pinned.some((group) => group.path === active.id) !== groups.pinned.some((group) => group.path === id)) return;
		const placement = clientY < rect.top + rect.height / 2 ? "before" : "after";
		const current = dropTargetRef.current;
		if (!current || current.id !== id || current.placement !== placement) {
			const next: DropTarget = { kind, id, placement };
			dropTargetRef.current = next;
			setDropTarget(next);
		}
	}, [eligible, groups.pinned]);

	const clearTarget = useCallback((id: string) => {
		if (dropTargetRef.current?.id === id) {
			dropTargetRef.current = null;
			setDropTarget(null);
		}
	}, []);

	useEffect(() => {
		const handlePointerDown = () => { suppressClick.current = false; };
		const handlePointerMove = (event: PointerEvent) => {
			const candidate = candidateRef.current;
			if (!candidate || event.pointerId !== candidate.pointerId) return;
			if (!(event.buttons & 1)) { reset(); return; }
			if (!draggingRef.current && Math.hypot(event.clientX - candidate.originX, event.clientY - candidate.originY) >= DRAG_THRESHOLD) {
				draggingRef.current = candidate.item;
				suppressClick.current = true;
				setDragging(candidate.item);
			}
			if (draggingRef.current) {
				event.preventDefault();
				setPointer({ x: event.clientX, y: event.clientY });
			}
		};
		const commit = async (active: DraggingItem, target: DropTarget) => {
			saving.current = true;
			try {
				const store = useApp.getState();
				const changed = active.kind === "project"
					? await store.reorderProjects(active.id, target.id, target.placement)
					: active.projectPath && await store.reorderProjectSessions(active.projectPath, active.id, target.id, target.placement, sort);
				if (changed && active.kind === "session") onReordered?.();
			} catch (cause) {
				useApp.getState().notify(translate("reorder.saveFailed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
			} finally { saving.current = false; }
		};
		const handlePointerUp = (event: PointerEvent) => {
			if (event.pointerId !== candidateRef.current?.pointerId) return;
			const active = draggingRef.current;
			const target = dropTargetRef.current;
			reset();
			if (active && target) void commit(active, target);
		};
		const cancelPointer = (event: PointerEvent) => {
			if (event.pointerId === candidateRef.current?.pointerId) reset();
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && candidateRef.current) { event.preventDefault(); reset(); }
		};
		const handleClick = (event: MouseEvent) => {
			if (suppressClick.current && event.detail > 0) {
				suppressClick.current = false;
				event.preventDefault();
				event.stopPropagation();
			}
		};
		const preventSelection = (event: Event) => { if (candidateRef.current) event.preventDefault(); };
		const clearScrolledTarget = () => { dropTargetRef.current = null; setDropTarget(null); };
		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("pointermove", handlePointerMove, true);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", cancelPointer);
		window.addEventListener("keydown", handleKey, true);
		window.addEventListener("click", handleClick, true);
		window.addEventListener("selectstart", preventSelection);
		window.addEventListener("blur", reset);
		window.addEventListener("scroll", clearScrolledTarget, true);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointermove", handlePointerMove, true);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", cancelPointer);
			window.removeEventListener("keydown", handleKey, true);
			window.removeEventListener("click", handleClick, true);
			window.removeEventListener("selectstart", preventSelection);
			window.removeEventListener("blur", reset);
			window.removeEventListener("scroll", clearScrolledTarget, true);
		};
	}, [sort, onReordered, reset]);

	return { contextValue: { dragging, dropTarget, startDrag, registerTarget, clearTarget }, dragging, dropTarget, pointer };
}
