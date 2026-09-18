/**
 * How large inline payloads leave the session log.
 *
 * The log used to stringify the whole user message, pixels included. One WeChat
 * dump became a 20 MB jsonl line; opening that conversation for display had to
 * read and `JSON.parse` it even though the window only needed the text. Display
 * reads strip those fields from the raw line first. New writes park the bytes
 * next to the log and keep a pointer.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message, UserContent } from "../types.ts";

/** Inline icons stay in the record. Anything bigger is a file. */
export const INLINE_IMAGE_CHARS = 8_000;

export function sessionMediaHome(): string {
	return join(process.env.LYRA_HOME || join(homedir(), ".lyra"), "session-media");
}

export function sessionMediaPath(name: string): string {
	return join(sessionMediaHome(), name);
}

/**
 * Drop oversized `"data":"…"` values from a jsonl line without allocating them.
 *
 * Display reads use `materializeJsonlLine` instead: that writes the bytes to
 * `session-media` and leaves a pointer, so the window has a file URL. This
 * helper stays for tests that only care about the strip.
 */
export function slimJsonlLine(line: string, keep = INLINE_IMAGE_CHARS): string {
	if (line.length <= keep + 16) return line;
	const needle = '"data":"';
	const parts: string[] = [];
	let last = 0;
	let from = 0;
	let changed = false;
	while (true) {
		const start = line.indexOf(needle, from);
		if (start < 0) break;
		const valueStart = start + needle.length;
		const valueEnd = line.indexOf('"', valueStart);
		if (valueEnd < 0) break;
		if (valueEnd - valueStart > keep) {
			parts.push(line.slice(last, valueStart));
			last = valueEnd;
			changed = true;
		}
		from = valueEnd + 1;
	}
	if (!changed) return line;
	parts.push(line.slice(last));
	return parts.join("");
}

/**
 * First display read of an old fat line: write each oversized image to
 * `session-media` and put `media` on the line that `JSON.parse` sees.
 *
 * The log stays append-only. The window never receives empty `data` without a
 * file name — that is the blank tile after a warm switch.
 */
export function materializeJsonlLine(line: string, keep = INLINE_IMAGE_CHARS): string {
	if (line.length <= keep + 16) return line;
	const needle = '"data":"';
	let out = "";
	let last = 0;
	let from = 0;
	let changed = false;
	while (true) {
		const start = line.indexOf(needle, from);
		if (start < 0) break;
		const valueStart = start + needle.length;
		const valueEnd = line.indexOf('"', valueStart);
		if (valueEnd < 0) break;
		if (valueEnd - valueStart <= keep) {
			from = valueEnd + 1;
			continue;
		}
		const data = line.slice(valueStart, valueEnd);
		const around = nearby(line, start, valueEnd);
		const name = persistSessionImage(data, mimeOf(around));
		out += line.slice(last, valueStart);
		out += around.includes('"media":') ? '"' : `","media":"${name}"`;
		last = valueEnd + 1;
		changed = true;
		from = valueEnd + 1;
	}
	if (!changed) return line;
	return out + line.slice(last);
}

function nearby(line: string, start: number, valueEnd: number): string {
	return line.slice(Math.max(0, start - 96), start) + line.slice(valueEnd, Math.min(line.length, valueEnd + 96));
}

function mimeOf(around: string): string {
	const hit = /"mimeType":"([^"]+)"/.exec(around);
	return hit?.[1] ?? "image/png";
}

export function parkRecordPayload<T>(payload: T): T {
	const record = payload as { type?: string; message?: Message };
	if (record.type !== "message" || !record.message) return payload;
	const message = parkMessage(record.message);
	if (message === record.message) return payload;
	return { ...payload, message };
}

export function parkMessage(message: Message): Message {
	if (message.role !== "user" && message.role !== "toolResult") return message;
	const content = parkUserContent(message.content);
	if (content === message.content) return message;
	return { ...message, content };
}

export async function rehydrateMessages(messages: Message[]): Promise<Message[]> {
	let changed = false;
	const next = await Promise.all(
		messages.map(async (message) => {
			if (message.role !== "user" && message.role !== "toolResult") return message;
			const content = await Promise.all(message.content.map(rehydratePart));
			if (content.every((part, i) => part === message.content[i])) return message;
			changed = true;
			return { ...message, content };
		}),
	);
	return changed ? next : messages;
}

function parkUserContent(content: UserContent[]): UserContent[] {
	let changed = false;
	const next = content.map((part) => {
		if (part.type !== "image" || part.media || part.data.length <= INLINE_IMAGE_CHARS) return part;
		changed = true;
		return { ...part, data: "", media: persistSessionImage(part.data, part.mimeType) };
	});
	return changed ? next : content;
}

async function rehydratePart(part: UserContent): Promise<UserContent> {
	if (part.type !== "image" || part.data || !part.media) return part;
	const data = await readSessionImage(part.media);
	return data === null ? part : { ...part, data };
}

export function persistSessionImage(data: string, mimeType: string): string {
	const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
	const bytes = Buffer.from(data, "base64");
	const digest = createHash("sha1").update(bytes).digest("hex");
	const name = `${digest}.${ext}`;
	const dir = sessionMediaHome();
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	if (!existsSync(path)) writeFileSync(path, bytes);
	return name;
}

async function readSessionImage(name: string): Promise<string | null> {
	const safe = safeMediaName(name);
	if (!safe) return null;
	const bytes = await readFile(sessionMediaPath(safe)).catch(() => null);
	return bytes ? bytes.toString("base64") : null;
}

export function safeMediaName(name: string): string {
	const base = name.replace(/^.*[/\\]/, "");
	if (!/^[a-f0-9]{40}\.(png|jpg|webp)$/.test(base)) return "";
	return base;
}
