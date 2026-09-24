import { inertPanes } from "../../ui/motion/freeze.ts";
import { forgetSplitRoot } from "./hit.ts";
import { useSplitOverlay } from "./overlay.ts";

/**
 * Carrying a sidebar conversation onto the workspace.
 *
 * The sidebar already has a reorder drag. This is the other landing: the pointer is over a
 * conversation screen, not over another row. The two share a press — SessionRow offers the
 * candidate, the workspace decides whether a drop is a split, a move or nothing.
 *
 * Module state rather than React, so the reorder hook and the workspace can ask the same question
 * without threading a callback through the sidebar.
 */

interface SessionDragCandidate {
	id: string;
	title: string;
	pointerId: number;
	originX: number;
	originY: number;
}

export interface SessionDragLive extends SessionDragCandidate {
	x: number;
	y: number;
}

const THRESHOLD = 5;

let candidate: SessionDragCandidate | null = null;
let live: SessionDragLive | null = null;
let frame = 0;
let pending: { x: number; y: number } | null = null;
/** Hands hit testing back to the panes; held for exactly as long as the carry is live. */
let unfreeze: (() => void) | null = null;

type Listener = (state: SessionDragLive | null) => void;
const listeners = new Set<Listener>();

export type SplitDropper = (sessionId: string, x: number, y: number, phase: "move" | "up") => boolean;

let dropper: SplitDropper | null = null;

export function setSplitDropper(next: SplitDropper | null): void {
	dropper = next;
}

export function offerSessionDrag(session: { id: string; title: string }, event: { pointerId: number; clientX: number; clientY: number; button: number; pointerType: string }): void {
	if (event.button !== 0 || event.pointerType !== "mouse") return;
	candidate = {
		id: session.id,
		title: session.title,
		pointerId: event.pointerId,
		originX: event.clientX,
		originY: event.clientY,
	};
}

/** Is a conversation being carried right now? */
export function sessionDragLive(): boolean {
	return live !== null;
}

function emit(next: SessionDragLive | null): void {
	live = next;
	for (const listener of listeners) listener(next);
}

function applyMove(): void {
	frame = 0;
	const point = pending;
	pending = null;
	if (!point || !candidate) return;
	if (!live && Math.hypot(point.x - candidate.originX, point.y - candidate.originY) < THRESHOLD) return;
	if (live && live.x === point.x && live.y === point.y) return;
	/*
	 * The panes stop taking the pointer the moment this becomes a carry.
	 *
	 * A screen may hold a browser, and its <webview> is a process of its own: the pointer crossing
	 * it goes to the page, and a release over it never comes back to this document. The carry used
	 * to go on for as long as that took — the frost and the chip standing on screen after the hand
	 * had let go, and the drop happening wherever the pointer next came back in. The pane drag has
	 * always done this; the carry never did. The drag listens on the window, so it is unaffected.
	 */
	if (!live && !unfreeze) unfreeze = inertPanes();
	const next: SessionDragLive = { ...candidate, x: point.x, y: point.y };
	emit(next);
	dropper?.(candidate.id, point.x, point.y, "move");
}

export function moveSessionDrag(event: PointerEvent): void {
	if (!candidate || event.pointerId !== candidate.pointerId) return;
	/*
	 * Some machines fire a move with buttons=0 before pointerup. Treating that as a cancel left the
	 * frost on the conversation and never ran the drop — the window looked locked. It is the release,
	 * so it lands where the button was last down: that is where the hand let go, and the pointer may
	 * have travelled since if the up went somewhere this document cannot hear.
	 */
	if (!(event.buttons & 1)) {
		dropSessionDrag(event, true);
		return;
	}
	pending = { x: event.clientX, y: event.clientY };
	if (!frame) frame = requestAnimationFrame(applyMove);
}

/**
 * True when the workspace took the drop, so a list reorder must not also fire.
 *
 * `atLastPress` lands it where the carry was last seen with the button down, for the releases this
 * document heard about late.
 */
export function dropSessionDrag(event: PointerEvent, atLastPress = false): boolean {
	if (!candidate || event.pointerId !== candidate.pointerId) return false;
	const id = candidate.id;
	const x = atLastPress && live ? live.x : event.clientX;
	const y = atLastPress && live ? live.y : event.clientY;
	const taken = Boolean(live) && Boolean(dropper?.(id, x, y, "up"));
	reset();
	return taken;
}

export function cancelSessionDrag(): void {
	if (!candidate) return;
	reset();
}

function reset(): void {
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
	pending = null;
	candidate = null;
	unfreeze?.();
	unfreeze = null;
	forgetSplitRoot();
	emit(null);
	useSplitOverlay.getState().clear();
}

export function subscribeSessionDrag(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
