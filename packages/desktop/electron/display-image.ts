/**
 * One user-message image, read when a thumbnail actually asks for it.
 *
 * The display transcript strips the pixels so a click does not clone them. This
 * file is the other half: find the nth image of that message, and only then
 * decode it. Live sessions already have the bytes in memory; stored ones are
 * streamed from the log and keep only this message's images.
 */

import type { Message, SessionStorage, UserContent } from "@lyra/core";

export type DisplayImage = Extract<UserContent, { type: "image" }>;

const RECENT = 3;
const recent = new Map<string, DisplayImage[]>();
const inflight = new Map<string, Promise<DisplayImage[]>>();

export function findUserImagesAt(messages: Message[], timestamp: number): DisplayImage[] {
	let found: DisplayImage[] = [];
	for (const message of messages) {
		if (message.role !== "user" || message.timestamp !== timestamp) continue;
		const images = imagesOf(message.content);
		if (images.length) found = images;
	}
	return found;
}

export async function readUserImagesAt(
	read: SessionStorage["read"],
	projectId: string,
	sessionId: string,
	timestamp: number,
): Promise<DisplayImage[]> {
	let entries: { seq: number; timestamp: number; images: DisplayImage[] }[] = [];
	for await (const record of read(projectId, sessionId)) {
		if (record.type === "message" && record.message?.role === "user") {
			const match = record.message.timestamp === timestamp;
			entries.push({
				seq: record.seq,
				timestamp: record.message.timestamp,
				images: match ? imagesOf(record.message.content) : [],
			});
		} else if (record.type === "truncate") {
			entries = entries.filter((entry) => entry.seq <= record.afterSeq);
		}
	}
	let found: DisplayImage[] = [];
	for (const entry of entries) {
		if (entry.timestamp === timestamp && entry.images.length) found = entry.images;
	}
	return found;
}

export function loadUserImagesAt(
	lookup: {
		liveMessages(sessionId: string): Message[] | undefined;
		read: SessionStorage["read"];
	},
	projectId: string,
	sessionId: string,
	timestamp: number,
): Promise<DisplayImage[]> {
	const key = `${projectId}/${sessionId}/${timestamp}`;
	const cached = recent.get(key);
	if (cached) return Promise.resolve(cached);
	const pending = inflight.get(key);
	if (pending) return pending;
	const next = (async () => {
		const live = lookup.liveMessages(sessionId);
		const images = live
			? findUserImagesAt(live, timestamp)
			: await readUserImagesAt(lookup.read, projectId, sessionId, timestamp);
		recent.delete(key);
		recent.set(key, images);
		while (recent.size > RECENT) {
			const oldest = recent.keys().next().value;
			if (oldest === undefined) break;
			recent.delete(oldest);
		}
		return images;
	})();
	inflight.set(key, next);
	const release = () => {
		if (inflight.get(key) === next) inflight.delete(key);
	};
	// An ignored finally promise rejects again even when the protocol caller handles the failure.
	void next.then(release, release);
	return next;
}

function imagesOf(content: UserContent[]): DisplayImage[] {
	return content.filter((part): part is DisplayImage => part.type === "image" && part.data.length > 0);
}
