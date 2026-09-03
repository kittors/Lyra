/**
 * The records a sub-agent panel draws its tool cards from.
 *
 * These exist because of a regression worth naming. The panel was changed to reuse the main
 * conversation's `ToolRun`, whose cards look their record up in the app store — and a sub-agent's
 * tool events never reach that store, because `runSubAgent` emits only the messages it produced.
 * Every card therefore found nothing, and a card that finds nothing after its turn has ended calls
 * itself an error: a panel full of successful work, drawn entirely in red crosses, with the raw
 * tool name where the summary should be.
 *
 * Nothing about that is visible to a typecheck — the props all match — so it is pinned here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@lyra/core";
import { subAgentRuns } from "../src/features/subagents/runs.ts";

const call = (id: string, name: string, args: Record<string, unknown>, at = 1000): Message => ({
	role: "assistant",
	content: [{ type: "toolCall", id, name, arguments: args }],
	stopReason: "toolUse",
	timestamp: at,
});

const result = (id: string, text: string, opts?: { isError?: boolean; details?: unknown; at?: number }): Message => ({
	role: "toolResult",
	toolCallId: id,
	content: [{ type: "text", text }],
	isError: opts?.isError,
	details: opts?.details,
	timestamp: opts?.at ?? 2000,
});

test("a finished call is done, not an error", () => {
	const runs = subAgentRuns([call("t1", "read", { path: "src/app.ts" }), result("t1", "…file…")]);

	assert.equal(runs.t1.status, "done", "the whole point: a call with a result did not fail");
	assert.equal(runs.t1.result?.isError, undefined);
	assert.equal(runs.t1.finishedAt, 2000);
});

test("a call still waiting on its result is running", () => {
	const runs = subAgentRuns([call("t1", "bash", { command: "pnpm test" })]);

	assert.equal(runs.t1.status, "running");
	assert.equal(runs.t1.startedAt, 1000);
	assert.equal(runs.t1.finishedAt, undefined);
});

test("a call that really did fail is an error", () => {
	const runs = subAgentRuns([call("t1", "read", { path: "nope.ts" }), result("t1", "ENOENT", { isError: true })]);

	assert.equal(runs.t1.status, "error");
	assert.equal(runs.t1.result?.isError, true);
});

test("the card gets the summary the main transcript would show, not the bare tool name", () => {
	const runs = subAgentRuns([call("t1", "read", { path: "src/app.ts" })]);

	assert.notEqual(runs.t1.summary, "read", "a raw tool name is what the broken version showed");
	assert.ok(runs.t1.summary.length > 0);
});

test("results carry their details through, which is where the diff counts live", () => {
	const runs = subAgentRuns([
		call("t1", "edit", { path: "src/app.ts" }),
		result("t1", "ok", { details: { added: 12, removed: 3 } }),
	]);

	assert.deepEqual(runs.t1.result?.details, { added: 12, removed: 3 });
});

test("several calls in one reply each get their own record", () => {
	const runs = subAgentRuns([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "a", name: "read", arguments: { path: "one.ts" } },
				{ type: "toolCall", id: "b", name: "read", arguments: { path: "two.ts" } },
			],
			stopReason: "toolUse",
			timestamp: 1000,
		},
		result("a", "…"),
		result("b", "…", { isError: true }),
	]);

	assert.equal(runs.a.status, "done");
	assert.equal(runs.b.status, "error");
});

test("a result with no call above it is ignored rather than invented", () => {
	const runs = subAgentRuns([result("ghost", "from a run that is not in this transcript")]);

	assert.deepEqual(Object.keys(runs), [], "a card with nothing to attach to is not a card");
});

test("the user's own message does not become a record", () => {
	const runs = subAgentRuns([
		{ role: "user", content: [{ type: "text", text: "去找一下" }], timestamp: 900 },
		call("t1", "grep", { pattern: "foo" }),
	]);

	assert.deepEqual(Object.keys(runs), ["t1"]);
});
