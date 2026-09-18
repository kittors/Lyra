/**
 * Which turn's diffs the delivery pane is showing.
 *
 * The card and the pane are two surfaces of one review. Git's pane is the
 * worktree; this is only what this turn recorded. The store stays here so
 * the dock panel can read it without the card holding pane state.
 */

import { create } from "zustand";
import type { TurnDelivery } from "../../../electron/turn-delivery.ts";

export interface DeliveryTarget {
	sessionId: string;
	timestamp: number;
	/** Null shows every file from the turn. */
	path: string | null;
}

interface DeliveryReviewState {
	target: DeliveryTarget | null;
	data: TurnDelivery | null;
	/** Bumped after an undo so the pane re-reads the same turn. */
	revision: number;
	open(target: DeliveryTarget, data?: TurnDelivery | null): void;
	setData(data: TurnDelivery | null): void;
	touch(): void;
	close(): void;
}

export const useDeliveryReview = create<DeliveryReviewState>((set) => ({
	target: null,
	data: null,
	revision: 0,
	open: (target, data) => set({ target, data: data ?? null }),
	setData: (data) => set({ data }),
	touch: () => set((state) => ({ revision: state.revision + 1 })),
	close: () => set({ target: null, data: null }),
}));
