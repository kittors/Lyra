/**
 * Blanking tool results that a later observation has already replaced.
 *
 * Size-pruning cuts a result because it is large. This cuts one because it is *dead*: the same
 * file was read again, the file was edited, or the same tool ran with the same arguments. The
 * later result is the current observation; the earlier one is a snapshot the model will not
 * need unless it asks (`recall`).
 *
 * oh-my-pi (`pruneSupersededToolResults`) and pi-dcp do the same two cuts, and both still go
 * through a prompt-cache gate — rewriting a warm prefix to save a few hundred characters is
 * how their #3406 happened. We reuse `worthPruning`, including the net-benefit path: a large
 * superseded read under a shorter tail is worth the one-time rewrite.
 *
 * Emptied in place, never removed. An unpaired `tool_use` poisons every later request.
 */

import type { Message, ToolResultMessage } from "../types.ts";
import { MAX_LINE_CHARS } from "../tools/long-line.ts";
import { firstAffordableCut, PRUNE_FLOOR_CHARS, type PruneTiming } from "./prune.ts";

const PROTECTED = new Set(["skill"]);

export interface StaleCut {
	index: number;
	saving: number;
	notice: string;
}

export function staleCuts(messages: Message[]): StaleCut[] {
	const calls = callsById(messages);
	const latestReads = new Map<string, Window[]>();
	const mutated = new Set<string>();
	const seenExact = new Set<string>();
	const cuts: StaleCut[] = [];

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "toolResult") continue;
		const call = calls.get(message.toolCallId);
		if (!call || PROTECTED.has(call.name) || PROTECTED.has(message.toolName)) continue;

		const path = pathOf(call.arguments);
		const key = path ? intern(latestReads, mutated, path) : "";
		const fingerprint = `${call.name} ${stable(call.arguments)}`;
		const window = call.name === "read" ? readWindow(call.arguments) : undefined;
		const duplicate = seenExact.has(fingerprint);
		const superseded =
			!message.isError &&
			call.name === "read" &&
			key !== "" &&
			(inSet(mutated, key) || coversAny(latestReads.get(key), window));

		if (duplicate || superseded) {
			const notice = superseded ? supersededNotice(path) : duplicateNotice(call.name);
			const size = textChars(message);
			const saving = size - notice.length;
			if (size > Math.max(PRUNE_FLOOR_CHARS, notice.length) && saving > 0) cuts.push({ index, saving, notice });
		}

		seenExact.add(fingerprint);
		if (key && (call.name === "write" || call.name === "edit") && !message.isError) mutated.add(key);
		if (key && window) {
			const list = latestReads.get(key) ?? [];
			list.push(window);
			latestReads.set(key, list);
		}
	}

	return cuts;
}

export function dropStaleResults(messages: Message[], timing: PruneTiming = {}): Message[] {
	const cuts = staleCuts(messages);
	const from = firstAffordableCut(messages, cuts, timing);
	if (from === undefined) return messages;
	return applyStaleCuts(messages, cuts.filter((cut) => cut.index >= from));
}

export function applyStaleCuts(messages: Message[], cuts: readonly StaleCut[]): Message[] {
	if (cuts.length === 0) return messages;
	const byIndex = new Map(cuts.map((cut) => [cut.index, cut.notice]));
	return messages.map((message, index) => {
		const notice = byIndex.get(index);
		if (!notice || message.role !== "toolResult") return message;
		return { ...message, content: [{ type: "text" as const, text: notice }] } as ToolResultMessage;
	});
}

function callsById(messages: Message[]): Map<string, { name: string; arguments: Record<string, unknown> }> {
	const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type !== "toolCall") continue;
			calls.set(part.id, { name: part.name, arguments: part.arguments ?? {} });
		}
	}
	return calls;
}

interface Window {
	from: number;
	to: number;
	/** No line window was asked for — this read named the whole file. */
	lineFull: boolean;
	charFrom: number;
	charTo: number;
}

function readWindow(args: Record<string, unknown>): Window {
	const offset = numberOf(args.offset);
	const limit = numberOf(args.limit);
	const charOffset = numberOf(args.char_offset) ?? numberOf(args.charOffset) ?? 1;
	const from = offset ?? 1;
	const lineFull = offset === undefined && limit === undefined;
	return {
		from,
		to: lineFull || limit === undefined ? Number.POSITIVE_INFINITY : from + limit - 1,
		lineFull,
		charFrom: charOffset,
		charTo: charOffset + MAX_LINE_CHARS - 1,
	};
}

function coversAny(laters: Window[] | undefined, earlier: Window | undefined): boolean {
	if (!laters || !earlier) return false;
	return laters.some((later) => {
		const lines = later.lineFull || (!earlier.lineFull && later.from <= earlier.from && later.to >= earlier.to);
		const chars = later.charFrom <= earlier.charFrom && later.charTo >= earlier.charTo;
		return lines && chars;
	});
}

function pathOf(args: Record<string, unknown>): string {
	for (const key of ["path", "file", "filePath", "file_path"] as const) {
		const value = args[key];
		if (typeof value === "string" && value) return value;
	}
	return "";
}

function pathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
	return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function intern(reads: Map<string, Window[]>, mutated: Set<string>, path: string): string {
	const key = pathKey(path);
	if (reads.has(key) || mutated.has(key)) return key;
	for (const existing of [...reads.keys(), ...mutated]) {
		if (samePath(existing, key)) return existing;
	}
	return key;
}

function inSet(set: Set<string>, key: string): boolean {
	if (set.has(key)) return true;
	for (const existing of set) {
		if (samePath(existing, key)) return true;
	}
	return false;
}

function stable(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([k, v]) => `${k}:${stable(v)}`).join(",")}}`;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textChars(message: ToolResultMessage): number {
	return message.content.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0);
}

function supersededNotice(path: string): string {
	return `[Earlier read of \`${path}\` superseded by a later observation. The latest read, or the edit that replaced it, is below. Full text stays in the session — recall or read again if you need that snapshot.]`;
}

function duplicateNotice(tool: string): string {
	return `[Duplicate ${tool} result omitted; a later call used the same arguments. Full text stays in the session.]`;
}
