import { useEffect, useState } from "react";
import type { Message } from "@lyra/core";
import { proseLength, STALL_MS } from "./answering.ts";

/**
 * True only while the answer is genuinely arriving; see `answering.ts` for why that is not the same
 * question as "does this reply contain text".
 *
 * The clock is the half that cannot be derived from the messages alone. Text that has stopped
 * growing looks exactly like text that grew a moment ago — the difference is how long ago, and
 * nothing re-renders to mark the passing of time on its own. So the length is watched, and a timer
 * is set each time it changes: another chunk cancels and restarts it, silence lets it fire.
 *
 * One timer, restarted, rather than a tick that runs for the whole reply. A quarter-second interval
 * through a long answer is a wake-up several hundred times per turn to recompute a boolean that is
 * almost always the same; this fires once per stall.
 */
export function useAnswering(messages: Message[]): boolean {
	const prose = proseLength(messages);
	/*
	 * Keyed on the length *and* the count, so the timer restarts when a new reply begins.
	 *
	 * A fresh message whose first chunk happens to be as long as the last one's final text would
	 * otherwise leave the previous message's timer running — and the stall it is measuring would be
	 * counted from words that belong to a different reply.
	 */
	const key = prose === null ? null : `${messages.length}:${prose}`;
	const [stalled, setStalled] = useState(false);

	useEffect(() => {
		setStalled(false);
		if (key === null) return;
		const timer = setTimeout(() => setStalled(true), STALL_MS);
		return () => clearTimeout(timer);
	}, [key]);

	return key !== null && !stalled;
}
