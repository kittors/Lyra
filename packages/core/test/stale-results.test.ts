/**
 * A later observation replaces an earlier one. The pairing stays; only the body is blanked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_TTL_MS, CHEAP_SUFFIX_CHARS, sizePruneSaving, worthPruning } from "../src/runtime/prune.ts";
import { dropStaleResults } from "../src/runtime/stale-results.ts";
import { AgedToolPruner } from "../src/runtime/aged-prune.ts";
import { emptyUsage, type Message, type ToolResultMessage } from "../src/types.ts";

function assistant(id: string, name: string, args: Record<string, unknown>): Message {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "test",
		model: "test",
		stopReason: "toolUse",
		usage: emptyUsage(),
		content: [{ type: "toolCall", id, name, arguments: args, argumentsText: "{}" }],
		timestamp: 0,
	};
}

function result(id: string, name: string, text: string, extra: Partial<ToolResultMessage> = {}): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: 0, ...extra };
}

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

test("a later full read blanks the earlier one of the same file", () => {
	const first = result("a", "read", "first snapshot ".repeat(80));
	const messages = [assistant("a", "read", { path: "src/a.ts" }), first, assistant("b", "read", { path: "src/a.ts" }), result("b", "read", "current")];
	const after = dropStaleResults(messages);
	assert.equal(after.length, messages.length);
	assert.equal((after[1] as ToolResultMessage).toolCallId, "a");
	assert.match((after[1].content[0] as { text: string }).text, /superseded/);
	assert.equal(after[3], messages[3]);
	assert.equal(first.content[0].type === "text" && first.content[0].text.startsWith("first"), true, "the log is a view");
});

test("a later wider window covers a narrower earlier one; a slice does not cover a full read", () => {
	const covered = [
		assistant("a", "read", { path: "f.ts", offset: 1, limit: 50 }),
		result("a", "read", "page ".repeat(80)),
		assistant("b", "read", { path: "f.ts", offset: 1, limit: 200 }),
		result("b", "read", "wide"),
	];
	assert.match((dropStaleResults(covered)[1].content[0] as { text: string }).text, /superseded/);

	const full = [
		assistant("a", "read", { path: "f.ts" }),
		result("a", "read", "whole file ".repeat(80)),
		assistant("b", "read", { path: "f.ts", offset: 1, limit: 40 }),
		result("b", "read", "slice"),
	];
	assert.equal(dropStaleResults(full), full);
});

test("a later head window does not blank an earlier mid-line read of the same file", () => {
	const messages = [
		assistant("a", "read", { path: "catalog.json", char_offset: 80_000 }),
		result("a", "read", "mid-line window ".repeat(80)),
		assistant("b", "read", { path: "catalog.json" }),
		result("b", "read", "line head ".repeat(80)),
	];
	assert.equal(dropStaleResults(messages), messages);
});

test("an edit blanks earlier reads of that path; a failed edit does not", () => {
	const edited = [
		assistant("a", "read", { path: "f.ts" }),
		result("a", "read", "before ".repeat(80)),
		assistant("b", "edit", { path: "f.ts", old: "x", new: "y" }),
		result("b", "edit", "ok"),
	];
	assert.match((dropStaleResults(edited)[1].content[0] as { text: string }).text, /superseded/);

	const failed = [
		assistant("a", "read", { path: "f.ts" }),
		result("a", "read", "before ".repeat(80)),
		assistant("b", "edit", { path: "f.ts", old: "x", new: "y" }),
		result("b", "edit", "conflict", { isError: true }),
	];
	assert.equal(dropStaleResults(failed), failed);
});

test("the same tool with the same arguments keeps only the latest body", () => {
	const messages = [
		assistant("a", "bash", { command: "git status" }),
		result("a", "bash", "dirty ".repeat(80)),
		assistant("b", "bash", { command: "git status" }),
		result("b", "bash", "clean"),
	];
	const after = dropStaleResults(messages);
	assert.match((after[1].content[0] as { text: string }).text, /Duplicate bash/);
	assert.equal(after[3], messages[3]);
});

test("skill instructions, other files, and unpaired results stay", () => {
	const messages = [
		assistant("a", "skill", { name: "review" }),
		result("a", "skill", "rules ".repeat(80)),
		assistant("b", "skill", { name: "review" }),
		result("b", "skill", "again ".repeat(80)),
		assistant("c", "read", { path: "a.ts" }),
		result("c", "read", "A".repeat(400)),
		assistant("d", "read", { path: "b.ts" }),
		result("d", "read", "B".repeat(400)),
		result("orphan", "read", "no call ".repeat(80)),
	];
	assert.equal(dropStaleResults(messages), messages);
});

test("relative and absolute paths to the same file collide", () => {
	const messages = [
		assistant("a", "read", { path: "/Users/me/proj/src/a.ts" }),
		result("a", "read", "abs ".repeat(80)),
		assistant("b", "read", { path: "src/a.ts" }),
		result("b", "read", "rel"),
	];
	assert.match((dropStaleResults(messages)[1].content[0] as { text: string }).text, /superseded/);
});

test("a warm long suffix blocks a small stale cut; a saving larger than the suffix does not", () => {
	const small = [
		assistant("a", "read", { path: "f.ts" }),
		result("a", "read", "old ".repeat(80)),
		assistant("b", "read", { path: "f.ts" }),
		result("b", "read", "new"),
		user("y".repeat(CHEAP_SUFFIX_CHARS + 1)),
	];
	const now = Date.now();
	assert.equal(dropStaleResults(small, { lastRequestAt: now, now }), small);

	const huge = "x".repeat(CHEAP_SUFFIX_CHARS + 8_000);
	const net = [
		assistant("a", "read", { path: "f.ts" }),
		result("a", "read", huge),
		assistant("b", "read", { path: "f.ts" }),
		result("b", "read", "new"),
		user("y".repeat(CHEAP_SUFFIX_CHARS + 1)),
	];
	assert.notEqual(dropStaleResults(net, { lastRequestAt: now, now }), net);
	const cold = dropStaleResults(small, { lastRequestAt: now - CACHE_TTL_MS - 1, now });
	assert.match((cold[1].content[0] as { text: string }).text, /superseded|Duplicate/);
});

test("size-prune saving is zero under the threshold and positive above it", () => {
	assert.equal(sizePruneSaving(1000), 0);
	assert.ok(sizePruneSaving(20_000) > 10_000);
});

test("net-benefit worthPruning lets a large cut through a warm tail the old 32k cap would refuse", () => {
	const messages = [result("a", "grep", "x".repeat(80_000)), user("y".repeat(CHEAP_SUFFIX_CHARS + 1))];
	const now = Date.now();
	assert.equal(worthPruning(messages, 0, { lastRequestAt: now, now }), false);
	assert.equal(worthPruning(messages, 0, { lastRequestAt: now, now }, 90_000), true);
});

test("the live pruner blanks a superseded read without waiting twenty rounds", () => {
	const first = result("a", "read", "snapshot ".repeat(80));
	const history = [assistant("a", "read", { path: "a.ts" }), first, assistant("b", "read", { path: "a.ts" }), result("b", "read", "now")];
	const next = new AgedToolPruner().prepare(history);
	assert.notEqual(next, history);
	assert.match(JSON.stringify(next[1]), /superseded/);
	assert.equal(first.content[0].type === "text" && first.content[0].text.startsWith("snapshot"), true);
});
