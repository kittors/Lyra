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
 */

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
	/** Bumped after an undo so the pane re-reads the same turn. */
	revision: number;
}

interface DeliveryReviewState {
	/** By conversation. */
	reviews: Readonly<Record<string, DeliveryReview>>;
	open(target: DeliveryTarget, data?: TurnDelivery | null): void;
	setData(sessionId: string, data: TurnDelivery | null): void;
	touch(sessionId: string): void;
	close(sessionId: string): void;
}

export const useDeliveryReview = create<DeliveryReviewState>((set) => ({
	reviews: {},
	open: (target, data) =>
		set((state) => ({
			reviews: { ...state.reviews, [target.sessionId]: { target, data: data ?? null, revision: state.reviews[target.sessionId]?.revision ?? 0 } },
		})),
	setData: (sessionId, data) =>
		set((state) => {
			const review = state.reviews[sessionId];
			return review ? { reviews: { ...state.reviews, [sessionId]: { ...review, data } } } : {};
		}),
	touch: (sessionId) =>
		set((state) => {
			const review = state.reviews[sessionId];
			return review ? { reviews: { ...state.reviews, [sessionId]: { ...review, revision: review.revision + 1 } } } : {};
		}),
	close: (sessionId) =>
		set((state) => {
			if (!state.reviews[sessionId]) return {};
			const reviews = { ...state.reviews };
			delete reviews[sessionId];
			return { reviews };
		}),
}));
