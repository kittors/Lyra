/**
 * Delivery cards are fetched after the transcript paints.
 *
 * Without a memory, every session click starts from `null` and the card appears one IPC later —
 * a 200px insert in a list you were already reading. The cache is the last successful payload
 * for that turn, so coming back paints the card at its real height on the first frame.
 */
import type { TurnDelivery } from "../../../electron/turn-delivery.ts";

const MAX = 32;
const cache = new Map<string, TurnDelivery>();

export function deliveryKey(sessionId: string, timestamp: number): string {
	return `${sessionId}:${timestamp}`;
}

export function peekDelivery(sessionId: string, timestamp: number): TurnDelivery | undefined {
	const key = deliveryKey(sessionId, timestamp);
	const value = cache.get(key);
	if (value === undefined) return undefined;
	cache.delete(key);
	cache.set(key, value);
	return value;
}

export function rememberDelivery(sessionId: string, timestamp: number, value: TurnDelivery): TurnDelivery {
	const key = deliveryKey(sessionId, timestamp);
	cache.delete(key);
	cache.set(key, value);
	while (cache.size > MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
	return value;
}

/** Tests only — production never needs to forget on purpose. */
export function clearDeliveryCache(): void {
	cache.clear();
}
