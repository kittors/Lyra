/**
 * An undo, reaching every surface that shows the turn it changed.
 *
 * Undo writes a file back and leaves the turn's record alone, so the rows and their +N −M stay what
 * they were; what changes is whether each file can still be undone. The card read that once, when it
 * mounted — so an undo made in the pane beside it left the card offering 「撤销」 for the whole turn
 * and an enabled undo in the file's preview, and the main process refused both with an error. A
 * popped-out pane is a second renderer, and it heard nothing of an undo made on the card.
 *
 * Whoever undoes hands the turn's new state on. Surfaces in this window take it as it is, with no
 * read of their own. Other windows hear of it through localStorage, per conversation like the
 * review's target, and read the turn themselves: only if something there shows it, once however many
 * surfaces do, and once more at most for any number of undos heard while that read was out.
 */

import { useEffect } from "react";
import type { TurnDelivery } from "../../../electron/turn-delivery.ts";
import { bridge } from "../../services/index.ts";
import { rememberDelivery } from "./delivery-cache.ts";
import { useDeliveryReview } from "./delivery-review.ts";

const PREFIX = "ly:delivery-undone:";

type Take = (value: TurnDelivery) => void;

/** What in this window shows a turn, by conversation and turn. */
const showing = new Map<string, Set<Take>>();
/** The read out for a turn; `stale` once an undo is heard that it may have gone out before. */
const reading = new Map<string, { stale: boolean }>();

const turnOf = (sessionId: string, timestamp: number) => `${sessionId}:${timestamp}`;

/** The turn's new state, to everything in this window that keeps a copy of it. */
function deliver(sessionId: string, timestamp: number, value: TurnDelivery): void {
	rememberDelivery(sessionId, timestamp, value);
	// The review keeps one whether or not its pane is open: a pane opened on it later paints this first.
	const review = useDeliveryReview.getState();
	if (review.reviews[sessionId]?.target.timestamp === timestamp) review.setData(sessionId, value);
	for (const take of showing.get(turnOf(sessionId, timestamp)) ?? []) take(value);
}

/**
 * An undo just made in this window, with the turn's state as read after it.
 *
 * The surface that made it is handed that state like every other one, so it sets nothing itself.
 */
export function announceUndo(sessionId: string, timestamp: number, value: TurnDelivery): void {
	const out = reading.get(turnOf(sessionId, timestamp));
	if (out) out.stale = true;
	deliver(sessionId, timestamp, value);
	try {
		/*
		 * Set and gone at once: the event is the message, and a record left behind would tell a window
		 * opened later of an undo it never showed — that one reads the turn itself. The nonce keeps two
		 * windows' writes of the same turn from being one unchanged value, which raises no event.
		 */
		localStorage.setItem(PREFIX + sessionId, JSON.stringify({ timestamp, nonce: Math.random() }));
		localStorage.removeItem(PREFIX + sessionId);
	} catch {
		// Storage unavailable: this window is in step, and another one reads the turn when it next mounts it.
	}
}

/** Read a turn another window changed, for what shows it here. */
async function reread(sessionId: string, timestamp: number): Promise<void> {
	const turn = turnOf(sessionId, timestamp);
	const out = reading.get(turn);
	if (out) {
		out.stale = true;
		return;
	}
	const read = { stale: false };
	reading.set(turn, read);
	try {
		while (showing.has(turn)) {
			read.stale = false;
			const value = await bridge.delivery.get(sessionId, timestamp);
			// Painting it and then the next read's answer would show a file coming back for a moment.
			if (read.stale) continue;
			deliver(sessionId, timestamp, value);
			return;
		}
	} catch {
		// What shows the turn keeps what it had. A turn that can no longer be read — its conversation
		// or its answer gone — is one they are about to stop showing.
	} finally {
		reading.delete(turn);
	}
}

function onStorage(event: StorageEvent): void {
	if (!event.key?.startsWith(PREFIX) || !event.newValue) return;
	let timestamp: unknown;
	try {
		timestamp = (JSON.parse(event.newValue) as { timestamp?: unknown }).timestamp;
	} catch {
		return;
	}
	const sessionId = event.key.slice(PREFIX.length);
	// Another conversation's turn, or one nothing here shows: nothing to read.
	if (typeof timestamp === "number" && showing.has(turnOf(sessionId, timestamp))) void reread(sessionId, timestamp);
}

/**
 * Take the turn's new state whenever an undo changes it, made here or in another window.
 *
 * `take` is held by identity while the turn is shown, so it has to be stable — a state setter is.
 */
export function useDeliveryUndos(sessionId: string | null, timestamp: number | null, take: Take): void {
	useEffect(() => {
		if (!sessionId || timestamp === null) return;
		const turn = turnOf(sessionId, timestamp);
		if (!showing.size) window.addEventListener("storage", onStorage);
		const takers = showing.get(turn) ?? new Set<Take>();
		takers.add(take);
		showing.set(turn, takers);
		return () => {
			takers.delete(take);
			if (!takers.size && showing.get(turn) === takers) showing.delete(turn);
			if (!showing.size) window.removeEventListener("storage", onStorage);
		};
	}, [sessionId, timestamp, take]);
}
