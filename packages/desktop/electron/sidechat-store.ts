/** Atomic, ordered side-chat snapshots, separate from the main transcript. */

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, writeFileAtomic, type Message } from "@lyra/core";

const writes = new Map<string, Promise<void>>();

function enqueue(path: string, write: () => Promise<void>): Promise<void> {
	const previous = writes.get(path) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(write);
	writes.set(path, next);
	void next.finally(() => { if (writes.get(path) === next) writes.delete(path); }).catch(() => {});
	return next;
}

function dir(): string {
	return join(lyraHome(), "sidechats");
}

function fileFor(sessionId: string): string {
	// Snapshot reads are reachable over IPC before a live session is resolved.
	if (!sessionId || /[\\/\0:]/.test(sessionId)) throw new Error("Invalid side-chat session id");
	return join(dir(), `${sessionId}.json`);
}

export interface SideChatArchive { messages: Message[]; modelId?: string | null }

export async function loadSideChatSnapshot(sessionId: string): Promise<SideChatArchive> {
	const path = fileFor(sessionId);
	await writes.get(path);
	return readSnapshot(path);
}

async function readSnapshot(path: string): Promise<SideChatArchive> {
	const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
	if (!raw) return { messages: [] };
	try {
		const parsed: SideChatArchive = JSON.parse(raw);
		return { messages: Array.isArray(parsed.messages) ? parsed.messages : [],
			...(parsed.modelId === null || typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}) };
	} catch { return { messages: [] }; }
}

export async function loadSideChat(sessionId: string): Promise<Message[]> {
	return (await loadSideChatSnapshot(sessionId)).messages;
}

/**
 * Write it out.
 *
 * Write-then-rename, so a crash midway leaves the previous version rather than half of this one —
 * through the shared helper, not a copy of its three lines. The copy renamed once: on Windows,
 * where antivirus opens every file that has just been written, the save after each message could
 * be refused for that moment and was reported as failed, and a failed write left its temporary
 * file behind. See `utils/atomic-write.ts` in core.
 */
export function saveSideChat(sessionId: string, messages: Message[], modelId?: string | null): Promise<void> {
	const path = fileFor(sessionId);
	// Serialize now, before the next message can mutate this array or any content blocks.
	const snapshot = messages.length > 0 || modelId !== undefined ? JSON.stringify({ messages, modelId }) : null;
	return enqueue(path, () => writeSnapshot(path, snapshot));
}

/** Transcript events preserve a model selection committed earlier in the same write queue. */
export function saveSideChatTranscript(sessionId: string, messages: Message[], defaultModelId: string | null): Promise<void> {
	const path = fileFor(sessionId);
	const serialized = JSON.stringify(messages);
	return enqueue(path, async () => {
		const previous = await readSnapshot(path);
		const modelId = previous.modelId === undefined ? defaultModelId : previous.modelId;
		await writeSnapshot(path, `{"messages":${serialized},"modelId":${JSON.stringify(modelId)}}`);
	});
}

async function writeSnapshot(path: string, snapshot: string | null): Promise<void> {
	if (snapshot === null) { await rm(path, { force: true }); return; }
	await mkdir(dir(), { recursive: true });
	await writeFileAtomic(path, snapshot);
}

/** Reset joins the same queue so an earlier save cannot resurrect the conversation. */
export function clearSideChat(sessionId: string): Promise<void> {
	return saveSideChat(sessionId, []);
}
