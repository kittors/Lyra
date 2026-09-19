import { create } from "zustand";
import { openScopedPanel } from "../../dock/index.ts";

export const useTraceFocus = create<{ sessionId: string; correlationId: string; nonce: number }>(() => ({ sessionId: "", correlationId: "", nonce: 0 }));

export function showTrace(sessionId: string, correlationId: string): void {
	useTraceFocus.setState(state => ({ sessionId, correlationId, nonce: state.nonce + 1 }));
	openScopedPanel("trajectory");
}

export function consumeTraceFocus(nonce: number): void {
	// A late consumer must not discard a newer navigation request.
	useTraceFocus.setState(state => state.nonce === nonce ? { ...state, sessionId: "", correlationId: "" } : state);
}
