/**
 * Files on their way from a phone to the desktop, for the composer to show while they travel.
 *
 * An upload is awaited before its attachment appears (a prompt must not name a file the desktop
 * does not have yet), and a large one takes long enough on mobile data that a composer showing
 * nothing in the meantime reads as a picker that did not work. So each one is listed here from its
 * first byte to its last, with what the composer needs to draw it: how far along it is, a way to
 * stop it, and — when the link drops — a way to try again instead of picking the file a second time.
 *
 * Module state with a subscription rather than the app store: it is a handful of short-lived rows
 * that only the composer that started them draws, and it changes on every progress tick.
 */

import { useSyncExternalStore } from "react";

import type { FileKind } from "./file-kind.ts";

export interface PendingUpload {
	key: string;
	/** Which composer started it — each draws only its own. */
	owner: string;
	name: string;
	kind: FileKind;
	/** Bytes the desktop has acknowledged, out of `total`. */
	done: number;
	total: number;
	state: "uploading" | "failed";
	/** Already worded for a person, when it failed. */
	error?: string;
	/** Stop it, or — once it has failed — give up on it. Either way the attachment is not added. */
	cancel(): void;
	/** Only once it has failed: send it again from the start. */
	retry?(): void;
}

let rows: PendingUpload[] = [];
const listeners = new Set<() => void>();
let serial = 0;

function publish(next: PendingUpload[]): void {
	rows = next;
	for (const listener of listeners) listener();
}

export function pendingUploads(): PendingUpload[] {
	return rows;
}

/** Start listing one; returns its key. */
export function addUpload(row: Omit<PendingUpload, "key">): string {
	const key = `upload-${++serial}`;
	publish([...rows, { ...row, key }]);
	return key;
}

export function updateUpload(key: string, change: Partial<Omit<PendingUpload, "key" | "owner">>): void {
	if (!rows.some((row) => row.key === key)) return;
	publish(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
}

export function removeUpload(key: string): void {
	if (!rows.some((row) => row.key === key)) return;
	publish(rows.filter((row) => row.key !== key));
}

/** A file that arrived after its composer had stopped waiting — sent again from a failed card. */
export interface ArrivedUpload {
	name: string;
	kind: FileKind;
	upload: string;
	path: string;
	mimeType: string;
}

const receivers = new Map<string, (arrived: ArrivedUpload) => void>();

/**
 * Where a retried upload goes when it lands. The composer that started it registers itself, and
 * the file is attached there the same way as one that arrived on the first try.
 */
export function receiveLateUploads(owner: string, receiver: (arrived: ArrivedUpload) => void): () => void {
	receivers.set(owner, receiver);
	return () => {
		if (receivers.get(owner) === receiver) receivers.delete(owner);
	};
}

/** Hand a late arrival to its composer; false when that composer is gone. */
export function deliverLate(owner: string, arrived: ArrivedUpload): boolean {
	const receiver = receivers.get(owner);
	if (!receiver) return false;
	receiver(arrived);
	return true;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The uploads one composer started, as they move. */
export function usePendingUploads(owner: string): PendingUpload[] {
	const all = useSyncExternalStore(subscribe, pendingUploads, pendingUploads);
	return all.filter((row) => row.owner === owner);
}
