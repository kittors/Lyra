/**
 * An escalation reaches a person in `auto` mode.
 *
 * `auto` runs commands confined to the project and lets the approval policy wave through the ones
 * it has nothing against — the sandbox is what makes that safe. An escalation asks to run outside
 * the sandbox, so the policy's opinion cannot be what answers it. It was: the gate handed
 * `assessCommand` the request's subject, `escalate:danger-full-access:<command>`, which found no
 * program it knew in the first word, and the command ran unconfined with nobody asked — `rm -rf`
 * included.
 *
 * Everything goes through the real `bash` tool and the real gate. Only the sandbox is swapped, for
 * one that records what it was handed and runs nothing, so no verdict here can execute anything.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { SandboxProcess } from "../src/kernel/services.ts";
import { useApprovalPolicy } from "../src/runtime/approval-policy.ts";
import { ApprovalGate, type PendingApproval } from "../src/runtime/approvals.ts";
import { sandboxModeFor, useSandbox } from "../src/sandbox/index.ts";
import type { SandboxMode } from "../src/sandbox/policy.ts";
import { bashTool } from "../src/tools/bash.ts";
import { assessCommand } from "../src/tools/risk.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";

/** Judged risky on its own, and harmless even if a broken fake ever let it reach a shell. */
const RECURSIVE_DELETE = "rm -rf /nonexistent-lyra-escalation-probe";

function immediateExit(): SandboxProcess {
	let exited: ((code: number | null) => void) | undefined;
	setImmediate(() => exited?.(0));
	return { onOutput() {}, onExit(listener) { exited = listener; }, onError() {}, kill() {} };
}

/** A session in `auto` mode, wired the way `Session` wires it, answering every prompt with `answer`. */
async function autoSession(t: TestContext, answer: "once" | "reject") {
	const ws = await mkdtemp(join(tmpdir(), "lyra-esc-gate-"));
	const ran: Array<{ command: string; mode?: SandboxMode }> = [];
	// oxlint-disable-next-line react-hooks/rules-of-hooks -- `useSandbox` binds the sandbox seam; it is not a React hook
	useSandbox({
		run(command, options) {
			ran.push({ command, mode: options.mode });
			return immediateExit();
		},
	});
	t.after(async () => {
		useSandbox(null);
		await rm(ws, { recursive: true, force: true });
	});

	const asked: PendingApproval[] = [];
	const gate: ApprovalGate = new ApprovalGate({
		mode: () => "auto",
		cwd: () => ws,
		ask: async (pending) => {
			asked.push(pending);
			gate.resolve(pending.id, answer);
		},
		remember: () => {},
		// A prompt that somehow goes unanswered fails the test in a second rather than in five minutes.
		unattendedTimeoutMs: 1_000,
	});
	const ctx: ToolContext = {
		cwd: ws,
		sessionId: "escalation-gate",
		state: new Map(),
		sandboxMode: sandboxModeFor("auto"),
		requestApproval: (request) => gate.request(request),
	};
	return { ws, ran, asked, ctx };
}

const textOf = (result: ToolResult) => result.content.map((b) => (b.type === "text" ? b.text : "")).join("");

for (const { label, command, risky } of [
	{ label: "a command the policy would stop on its own", command: RECURSIVE_DELETE, risky: true },
	// The case that tells "the gate asks" from "the policy judged the right string": correctly
	// judged, this one is fine — and escalating it is still not the policy's decision.
	{ label: "a command the policy has nothing against", command: "echo hi", risky: false },
]) {
	test(`in auto mode, escalating ${label} asks a person`, async (t) => {
		const { ws, ran, asked, ctx } = await autoSession(t, "reject");
		assert.equal(assessCommand(command, ws).risky, risky, "precondition: what the policy thinks of the bare command");

		const result = (await bashTool.execute(
			{ command, escalate: "danger-full-access", justification: "要在沙箱外面跑" },
			ctx,
		)) as ToolResult;

		assert.equal(asked.length, 1, "the policy answered in the user's place and nobody was asked");
		const [prompt] = asked;
		assert.equal(prompt?.request.escalation, "danger-full-access");
		assert.ok(prompt?.request.detail.includes(command), "the prompt shows the command it would let out");
		assert.equal(prompt?.request.reason, "要在沙箱外面跑", "what the user reads is the model's reason");
		assert.deepEqual(ran, [], "a refused escalation hands nothing to the sandbox");
		assert.ok(result.isError);
		assert.match(textOf(result), /用户拒绝/);
	});
}

test("an approved escalation runs once, under the mode it asked for", async (t) => {
	const { ran, asked, ctx } = await autoSession(t, "once");

	await bashTool.execute({ command: "echo hi", escalate: "danger-full-access", justification: "要写工作区外面" }, ctx);
	// The grant is spent on that call; the next one is back inside the sandbox.
	await bashTool.execute({ command: "echo hi" }, ctx);

	assert.equal(asked.length, 1, "asked once, for the escalation — `echo` never needs asking");
	assert.deepEqual(ran, [
		{ command: "echo hi", mode: "danger-full-access" },
		{ command: "echo hi", mode: "workspace-write" },
	]);
});

test("no approval policy can answer an escalation for the user", async (t) => {
	// A plugin can bind any policy; this one clears everything.
	useApprovalPolicy({ assess: () => ({ risky: false }) });
	t.after(() => useApprovalPolicy(null));
	const { ran, asked, ctx } = await autoSession(t, "reject");

	// It is in force: the same command, confined, goes through without a prompt.
	await bashTool.execute({ command: RECURSIVE_DELETE }, ctx);
	assert.equal(asked.length, 0);
	assert.deepEqual(ran, [{ command: RECURSIVE_DELETE, mode: "workspace-write" }]);

	// And it does not get to lift the confinement.
	const result = (await bashTool.execute(
		{ command: RECURSIVE_DELETE, escalate: "danger-full-access", justification: "要在沙箱外面跑" },
		ctx,
	)) as ToolResult;
	assert.equal(asked.length, 1);
	assert.equal(ran.length, 1, "the escalated run never started");
	assert.ok(result.isError);
});
