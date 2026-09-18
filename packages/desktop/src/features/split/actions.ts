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
import { canSplitSide, pickSplitTarget, preferredSide, type ScreenBox } from "./geometry.ts";
import { useSplit } from "./store.ts";
import { useSplitOverlay } from "./overlay.ts";

/**
 * How long the pointer has to stay on one row before we swap the live transcript.
 *
 * A determined mash is 80–300ms between presses. 140ms sat inside that window, so
 * every press still parked the last chat, replaced the split leaf, and remounted
 * sixty rows — that is the freeze, not the row highlight. The row still lights in
 * the click turn; this timer is only the expensive half, and a newer click resets it.
 */
export const SESSION_SETTLE_MS = 360;

let settleTimer: ReturnType<typeof setTimeout> | null = null;
let settleTarget: SessionMeta | null = null;

/** Drop a queued hydrate. Tests call this so a timer from the last case cannot land in the next. */
export function abandonSessionReveal(): void {
	if (settleTimer !== null) clearTimeout(settleTimer);
	settleTimer = null;
	settleTarget = null;
}

function stillWants(id: string): boolean {
	const state = useApp.getState();
	return state.pendingSessionId === id || state.activeSessionId === id;
}

function queueSettle(meta: SessionMeta): void {
	settleTarget = meta;
	if (settleTimer !== null) clearTimeout(settleTimer);
	settleTimer = setTimeout(() => {
		settleTimer = null;
		void commitSettle();
	}, SESSION_SETTLE_MS);
}

async function commitSettle(): Promise<void> {
	const target = settleTarget;
	settleTarget = null;
	if (!target) return;
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
	await useApp.getState().openSession(target);
	if (useApp.getState().activeSessionId !== target.id) return;
	useSplit.getState().show(target.id);
}

/**
 * Light the sidebar row in this turn. Hydrate only after the click stream goes quiet.
 *
 * `openSession` parks the last chat and mounts the next one. Doing that per click
 * is what locked the main thread when someone raked the list. The row only needs
 * `pendingSessionId`. The rest waits `SESSION_SETTLE_MS` and keeps only the last id.
 */
export function revealSession(meta: SessionMeta): void {
	useApp.getState().previewSession(meta);
	if (useApp.getState().activeSessionId === meta.id && useApp.getState().pendingSessionId == null) return;
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
	const panes = measurePanes();
	if (panes.length === 0) return true;
	return panes.some((pane) => preferredSide(pane.width, pane.height) !== null);
}

export function splitWith(meta: SessionMeta, target: string | null, width: number, height: number, side?: DropSide): void {
	if (contains(useSplit.getState().tree, meta.id) || (side && canSplitSide(width, height, side))) {
		useSplit.getState().split(target, meta.id, side ?? "right");
		revealSession(meta);
		return;
	}
	const panes = measurePanes();
	const picked = pickSplitTarget(panes.length ? panes : [{ sessionId: target, width, height }], target);
	if (!picked) return;
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

/** This conversation is already a screen here, so the drop opens another window. */
export function dropAlreadyOpen(sessionId: string): boolean {
	if (!bridge.windows) return false;
	useSplitOverlay.getState().clear();
	void openInNewWindow(sessionId);
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
