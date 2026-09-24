/**
 * Opening a conversation into this window's tiling.
 *
 * The store only knows the tree. These functions also swap the live transcript slot and, for
 * a new window, ask the main process to build one.
 */

import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { canSplit, contains, type DropSide } from "./tree.ts";
import { canSplitSide, pickSplitTarget, preferredSide, SCREEN_MIN_WIDTH_PX, type ScreenBox } from "./geometry.ts";
import { columnCount } from "./moves.ts";
import { useSplit } from "./store.ts";
import { useSplitOverlay } from "./overlay.ts";

/**
 * Kept for tests that wait out the old burst window. The pane now swaps on
 * every press — retained trees made remounting every row cheap. Disk reads
 * still collapse to the last id in `readSelectedSession`.
 */
export const SESSION_SETTLE_MS = 360;

/** Tests call this between cases. Hydrate is no longer a timer, so there is nothing to drop. */
export function abandonSessionReveal(): void {
	return;
}

function stillWants(id: string): boolean {
	const state = useApp.getState();
	return state.pendingSessionId === id || state.activeSessionId === id;
}

function queueSettle(meta: SessionMeta): void {
	void commitSettle(meta);
}

async function commitSettle(target: SessionMeta): Promise<void> {
	if (!stillWants(target.id)) return;
	if (useApp.getState().pendingSessionId == null && useApp.getState().activeSessionId === target.id) return;
	/*
	 * Replace the focused leaf before the transcript swaps.
	 *
	 * `openSession` clears `pendingSessionId` in the same set that writes `activeSessionId`.
	 * If the tree still names the conversation we left, that row lights again as "still tiled"
	 * until `show` runs — the flash after a click. Move the leaf now, then hydrate.
	 */
	useSplit.getState().show(target.id);
	if (!stillWants(target.id)) return;
	await useApp.getState().openSession(target);
	if (useApp.getState().activeSessionId !== target.id) return;
	useSplit.getState().show(target.id);
}

/**
 * Light the sidebar row and swap the pane in this turn.
 *
 * A 360ms quiet window used to hold the transcript on the first row while
 * later presses only changed the highlight. People click 200–350ms apart, so
 * the chat they pointed at never arrived until they stopped. Cached trees
 * and a single in-flight disk read make a swap on every press cheap.
 */
export function revealSession(meta: SessionMeta): void {
	useApp.getState().previewSession(meta);
	const current = useApp.getState();
	if (current.activeSessionId === meta.id && current.pendingSessionId == null) {
		// A retained conversation can still be hidden behind another workspace page.
		if (current.view !== "chat") current.setView("chat");
		return;
	}
	queueSettle(meta);
}

export function focusPane(sessionId: string | null): void {
	useSplit.getState().focus(sessionId);
	if (!sessionId) return;
	if (useApp.getState().activeSessionId === sessionId && useApp.getState().pendingSessionId == null) return;
	const meta = useApp.getState().sessions.find((session) => session.id === sessionId);
	if (meta) revealSession(meta);
	else void useApp.getState().openSessionById(sessionId);
}

export function openInPane(meta: SessionMeta): void {
	revealSession(meta);
}

export function resetSplit(sessionId: string | null = null): void {
	useSplit.getState().reset(sessionId);
}

function measurePanes(): ScreenBox[] {
	const root = document.querySelector("[data-ly-split-root]");
	if (!root) return [];
	return [...root.querySelectorAll<HTMLElement>("[data-ly-split-pane]")].map((el) => {
		const box = el.getBoundingClientRect();
		const key = el.dataset.lySplitPane ?? "@draft";
		return { sessionId: key === "@draft" ? null : key, width: box.width, height: box.height };
	});
}

export function canOfferSplit(): boolean {
	const tree = useSplit.getState().tree;
	if (!canSplit(tree)) return false;
	if (canAddColumn()) return true;
	const panes = measurePanes();
	if (panes.length === 0) return true;
	return Boolean(bridge.windows) || panes.some((pane) => preferredSide(pane.width, pane.height) !== null);
}

function canAddColumn(): boolean {
	const root = document.querySelector("[data-ly-split-viewport]")?.getBoundingClientRect();
	return Boolean(root && root.width / (columnCount(useSplit.getState().tree) + 1) >= SCREEN_MIN_WIDTH_PX);
}

export function splitWith(meta: SessionMeta, target: string | null, width: number, height: number, side?: DropSide): void {
	if (contains(useSplit.getState().tree, meta.id) || (side && canSplitSide(width, height, side))) {
		useSplit.getState().split(target, meta.id, side ?? "right");
		revealSession(meta);
		return;
	}
	if (!side && canAddColumn() && useSplit.getState().addColumn(meta.id)) {
		revealSession(meta);
		return;
	}
	const panes = measurePanes();
	const picked = pickSplitTarget(panes.length ? panes : [{ sessionId: target, width, height }], target);
	if (!picked) {
		void openInNewWindow(meta.id);
		return;
	}
	useSplit.getState().split(picked.target, meta.id, picked.side);
	revealSession(meta);
}

export function closePane(sessionId: string): void {
	const next = useSplit.getState().close(sessionId);
	if (next) focusPane(next);
}

export function dropOnPane(sessionId: string, target: string | null, side: DropSide): boolean {
	const meta = useApp.getState().sessions.find((session) => session.id === sessionId);
	if (!meta) return false;
	const pane = document.querySelector<HTMLElement>(`[data-ly-split-pane="${target ?? "@draft"}"]`);
	const box = pane?.getBoundingClientRect();
	if (box && canSplit(useSplit.getState().tree) && !canSplitSide(box.width, box.height, side)) {
		useSplitOverlay.getState().clear();
		return false;
	}
	useSplitOverlay.getState().clear();
	useSplit.getState().split(target, meta.id, side);
	revealSession(meta);
	return true;
}

/**
 * This conversation is already a screen here: the drop moves it beside `target`.
 *
 * It used to open the conversation in a second native window, with nothing on screen during the
 * drag to say so — a reorder in the sidebar that overshot onto the workspace ended in a window
 * popping up. Moving it is what dropping something already on screen means; a second window is one
 * click away in its menu.
 */
export function moveOnto(sessionId: string, target: string | null, side: DropSide): boolean {
	useSplitOverlay.getState().clear();
	if (!useSplit.getState().relocate(sessionId, target, side)) return false;
	focusPane(sessionId);
	return true;
}

export async function openInNewWindow(sessionId: string): Promise<void> {
	if (!bridge.windows) return;
	await bridge.windows.open({ sessionId });
}

/** Bring a detached conversation back onto this window's tiling. */
export function revealInWorkspace(sessionId: string): void {
	const meta = useApp.getState().sessions.find((session) => session.id === sessionId);
	if (meta) {
		openInPane(meta);
		return;
	}
	useSplit.getState().show(sessionId);
	void useApp.getState().openSessionById(sessionId);
}

export function paneAtPoint(x: number, y: number): HTMLElement | null {
	const root = document.querySelector("[data-ly-split-root]");
	if (!root) return null;
	const box = root.getBoundingClientRect();
	if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
	const panes = root.querySelectorAll<HTMLElement>("[data-ly-split-pane]");
	for (const pane of panes) {
		const rect = pane.getBoundingClientRect();
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return pane;
	}
	return null;
}
