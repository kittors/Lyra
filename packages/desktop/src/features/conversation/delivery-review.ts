/**
 * Which turn's diffs each conversation's delivery pane is showing.
 *
 * The card and the pane are two surfaces of one review. Git's pane is the
 * worktree; this is only what this turn recorded. The store stays here so
 * the dock panel can read it without the card holding pane state.
 *
 * One review per conversation, not per window. A split shows a delivery pane in each screen, and a
 * single review made them share it: opening 乙's review took the one 甲's screen had open, and an
 * undo on 乙's card rewrote whatever review was on show. Keyed by the conversation, each screen's
 * pane reads its own, the way ADR-0023 has containers belong to their conversation.
 *
 * An undo made on either surface reaches the other, and other windows, through `delivery-undo.ts`.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { TurnDelivery } from "../../../electron/turn-delivery.ts";

interface DeliveryTarget {
	sessionId: string;
	timestamp: number;
	/** Null shows every file from the turn. */
	path: string | null;
}

interface DeliveryReview {
	target: DeliveryTarget;
	data: TurnDelivery | null;
}

interface DeliveryReviewState {
	/** By conversation. */
	reviews: Readonly<Record<string, DeliveryReview>>;
	open(target: DeliveryTarget, data?: TurnDelivery | null): void;
	/** Take a target another window chose, without writing it back. */
	adopt(target: DeliveryTarget): void;
	setData(sessionId: string, data: TurnDelivery | null): void;
	close(sessionId: string): void;
}

/*
 * The target also goes to localStorage, per conversation — the one store every window of the app
 * shares. A popped-out delivery pane is a second renderer with a fresh copy of this store, and the
 * pop-out hands it only the conversation: with no turn to show it drew its empty state, 「文件变更」
 * and nothing else. The terminal's `ly:terminal-selection:*` crosses windows the same way.
 */
const storageKey = (sessionId: string) => `ly:delivery-target:${sessionId}`;

function remember(target: DeliveryTarget): void {
	try {
		localStorage.setItem(storageKey(target.sessionId), JSON.stringify({ timestamp: target.timestamp, path: target.path }));
	} catch {
		// Storage full or unavailable: this window still has its review; only a popped-out pane goes without.
	}
}

function forget(sessionId: string): void {
	try {
		localStorage.removeItem(storageKey(sessionId));
	} catch {
		// Nothing to forget where nothing could be written.
	}
}

/** The target a window last opened for this conversation, if any window did. */
function rememberedTarget(sessionId: string): DeliveryTarget | null {
	try {
		const raw = localStorage.getItem(storageKey(sessionId));
		if (!raw) return null;
		const value = JSON.parse(raw) as { timestamp?: unknown; path?: unknown };
		if (typeof value.timestamp !== "number" || (value.path !== null && typeof value.path !== "string")) return null;
		return { sessionId, timestamp: value.timestamp, path: value.path };
	} catch {
		return null;
	}
}

export const useDeliveryReview = create<DeliveryReviewState>((set) => ({
	reviews: {},
	open: (target, data) => {
		remember(target);
		set((state) => ({
			reviews: { ...state.reviews, [target.sessionId]: { target, data: data ?? null } },
		}));
	},
	adopt: (target) =>
		set((state) => ({
			reviews: { ...state.reviews, [target.sessionId]: { target, data: null } },
		})),
	setData: (sessionId, data) =>
		set((state) => {
			const review = state.reviews[sessionId];
			return review ? { reviews: { ...state.reviews, [sessionId]: { ...review, data } } } : {};
		}),
	close: (sessionId) => {
		forget(sessionId);
		set((state) => {
			if (!state.reviews[sessionId]) return {};
			const reviews = { ...state.reviews };
			delete reviews[sessionId];
			return { reviews };
		});
	},
}));

/**
 * Keep this window's review of a conversation in step with the shared record.
 *
 * A window with no review of its own — a popped-out pane on its first frame — takes the one on
 * record. After that it follows: a file row clicked in the main window while the pane is popped out
 * moves the record, and the `storage` event, which fires in every window but the one that wrote, is
 * how the pane hears about it.
 */
export function useSharedDeliveryTarget(owner: string | null): void {
	useEffect(() => {
		if (!owner) return;
		const follow = () => {
			const remembered = rememberedTarget(owner);
			if (!remembered) return;
			const current = useDeliveryReview.getState().reviews[owner]?.target;
			if (current?.timestamp === remembered.timestamp && current.path === remembered.path) return;
			useDeliveryReview.getState().adopt(remembered);
		};
		if (!useDeliveryReview.getState().reviews[owner]) follow();
		const onStorage = (event: StorageEvent) => {
			if (event.key === storageKey(owner)) follow();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [owner]);
}
