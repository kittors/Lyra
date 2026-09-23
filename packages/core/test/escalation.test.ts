/**
 * Asking for more room after being refused.
 *
 * The shape being pinned down here is an ordering: nothing runs before the request is judged, a
 * request that grants nothing never reaches a person, and every refusal is distinguishable from
 * every other so the model can tell "you asked wrong" from "the user said no".
 *
 * The end-to-end half runs the real tool against the real sandbox, because the property that
 * matters — the same command failing, then succeeding once approved — cannot be observed in the
 * pieces.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { selectRunner } from "../src/sandbox/backend.ts";
import { bashTool } from "../src/tools/bash.ts";
import {
	approveEscalation,
	EscalationError,
	escalationHint,
	sandboxDenialMarker,
	validateEscalationArgs,
} from "../src/tools/escalation.ts";
import type { ApprovalRequest, ToolContext, ToolResult } from "../src/types.ts";
import { shellFor } from "./shell-for.ts";

const skip = selectRunner() === "none" ? "this host has no sandbox backend" : false;
/** Read-only and workspace-write are both confined, so every command below is spelled for the same shell. */
const sh = shellFor("read-only");

// ---------------------------------------------------------------------------
// The pairing a schema cannot express
// ---------------------------------------------------------------------------

test("the two arguments travel together or not at all", () => {
	// An escalation with no reason is a prompt with nothing to show; a reason with nothing to
	// justify is a model saying "I need write access" while asking for nothing.
	assert.throws(() => validateEscalationArgs("workspace-write", undefined), EscalationError);
	assert.throws(() => validateEscalationArgs(undefined, "because"), EscalationError);
	assert.throws(() => validateEscalationArgs("workspace-write", "   "), EscalationError);
	assert.doesNotThrow(() => validateEscalationArgs(undefined, undefined));
	assert.doesNotThrow(() => validateEscalationArgs("workspace-write", "需要写构建产物"));
});

// ---------------------------------------------------------------------------
// Strictly wider, or nothing
// ---------------------------------------------------------------------------

test("a request that is not strictly wider never reaches a person", async () => {
	let asked = false;
	await assert.rejects(
		approveEscalation(
			{ requested: "workspace-write", justification: "x", current: "workspace-write", subject: "命令" },
			async () => {
				asked = true;
				return "once";
			},
		),
		EscalationError,
	);
	assert.equal(asked, false, "there is nothing to decide — it grants nothing");
});

test("narrowing disguised as an escalation is refused", async () => {
	await assert.rejects(
		approveEscalation(
			{ requested: "read-only", justification: "x", current: "workspace-write", subject: "命令" },
			async () => "once",
		),
		EscalationError,
	);
});

test("each widening step is allowed", async () => {
	assert.equal(
		await approveEscalation(
			{ requested: "workspace-write", justification: "x", current: "read-only", subject: "命令" },
			async () => "once",
		),
		"workspace-write",
	);
	assert.equal(
		await approveEscalation(
			{ requested: "danger-full-access", justification: "x", current: "workspace-write", subject: "命令" },
			async () => "once",
		),
		"danger-full-access",
	);
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test("no approval channel is a refusal, not a grant", async () => {
	await assert.rejects(
		approveEscalation(
			{ requested: "danger-full-access", justification: "x", current: "read-only", subject: "命令" },
			undefined,
		),
		/没有可用的批准通道/,
	);
});

test("a rejection says so in its own words", async () => {
	await assert.rejects(
		approveEscalation(
			{ requested: "workspace-write", justification: "x", current: "read-only", subject: "命令" },
			async () => "reject",
		),
		/用户拒绝/,
	);
});

test("the model's sentence is what the asker is handed", async () => {
	let seen = "";
	await approveEscalation(
		{ requested: "workspace-write", justification: "要把编译产物写进 dist/", current: "read-only", subject: "命令" },
		async (reason) => {
			seen = reason;
			return "once";
		},
	);
	assert.equal(seen, "要把编译产物写进 dist/", "shown verbatim — a paraphrase would be our words, not its");
});

// ---------------------------------------------------------------------------
// What the model reads
// ---------------------------------------------------------------------------

test("a denial says it was policy, not a broken command", () => {
	const marker = sandboxDenialMarker("workspace-write");
	assert.match(marker, /策略拒绝/);
	assert.match(marker, /换个写法重试没有用/);
});

test("the hint arrives with the denial, where it cannot be missed", () => {
	// In the result rather than the tool description: a model that has just been refused is reading
	// this, not re-reading a schema from a hundred messages ago.
	assert.match(escalationHint("命令"), /escalate/);
	assert.match(escalationHint("命令"), /justification/);
	assert.match(escalationHint("命令"), /弹窗问用户/);
});

// ---------------------------------------------------------------------------
// End to end: denied, then asked for, then allowed — once
// ---------------------------------------------------------------------------

function context(cwd: string, mode: "read-only" | "workspace-write", onAsk?: (r: ApprovalRequest) => "once" | "reject"): ToolContext {
	return {
		cwd,
		sessionId: "t",
		state: new Map(),
		sandboxMode: mode,
		requestApproval: onAsk ? async (request) => onAsk(request) : undefined,
	};
}

const textOf = (result: ToolResult) => result.content.map((b) => (b.type === "text" ? b.text : "")).join("");

test("denied, and told how to ask", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const result = (await bashTool.execute({ command: sh.write(join(ws, "f.txt"), "x") }, context(ws, "read-only"))) as ToolResult;
	assert.match(textOf(result), /策略拒绝/);
	assert.match(textOf(result), /escalate/);
	assert.equal(existsSync(join(ws, "f.txt")), false);
});

test("the same command, escalated with a reason, is approved and runs", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	let prompt: ApprovalRequest | undefined;
	const result = (await bashTool.execute(
		{ command: sh.thenDone(sh.write(join(ws, "f.txt"), "x")), escalate: "workspace-write", justification: "要写测试用的文件" },
		context(ws, "read-only", (request) => {
			prompt = request;
			return "once";
		}),
	)) as ToolResult;

	assert.match(textOf(result), /DONE/, textOf(result));
	assert.ok(existsSync(join(ws, "f.txt")));
	// And the user saw why, in the model's words.
	assert.equal(prompt?.reason, "要写测试用的文件");
});

test("a rejected escalation runs nothing at all", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const result = (await bashTool.execute(
		{ command: sh.write(join(ws, "f.txt"), "x"), escalate: "workspace-write", justification: "要写文件" },
		context(ws, "read-only", () => "reject"),
	)) as ToolResult;

	assert.ok(result.isError);
	assert.equal(existsSync(join(ws, "f.txt")), false, "nothing ran");
});

test("a grant is spent on the call that asked for it", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	let asks = 0;
	const ctx = context(ws, "read-only", () => {
		asks += 1;
		return "once";
	});

	await bashTool.execute({ command: sh.write(join(ws, "a.txt"), "a"), escalate: "workspace-write", justification: "第一次" }, ctx);
	// The next command carries no escalation, so it runs under the session's own mode again.
	const after = (await bashTool.execute({ command: sh.write(join(ws, "b.txt"), "b") }, ctx)) as ToolResult;

	assert.ok(existsSync(join(ws, "a.txt")));
	assert.equal(existsSync(join(ws, "b.txt")), false, "the widening did not outlive its call");
	assert.match(textOf(after), /策略拒绝/);
	/*
	 * Two prompts, not one: the escalation, and then the ordinary "this command writes something"
	 * approval the second call still goes through. That second layer predates the sandbox and
	 * still guesses at risk from the command text — now that there is a real boundary underneath
	 * it, whether it still earns its interruptions is a separate question, recorded in
	 * docs/hardening-plan.md rather than answered here.
	 */
	assert.equal(asks, 2);
});

test("escalating outside the sandbox's reach still cannot write outside the workspace", { skip }, async (t) => {
	// workspace-write is the workspace and the temp areas — not everywhere. An escalation to it
	// grants exactly that, and the home directory is still refused.
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-"));
	const outside = join(homedir(), ".lyra-escalation-probe");
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	await bashTool.execute(
		{ command: sh.write(outside, "x"), escalate: "workspace-write", justification: "试试" },
		context(ws, "read-only", () => "once"),
	);
	assert.equal(existsSync(outside), false);
});
