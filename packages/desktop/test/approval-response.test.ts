import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest } from "@lyra/core";
import { ApprovalGate } from "../../core/src/runtime/approvals.ts";
import { resolveSessionApproval } from "../electron/approval-response.ts";

function fixture(request: ApprovalRequest = { kind: "bash", subject: "deploy", title: "Deploy", detail: "deploy" }) {
	const saved: string[] = [];
	const gate = new ApprovalGate({
		mode: () => "ask", cwd: () => process.cwd(),
		ask: async () => {}, remember: () => {},
	});
	const result = gate.request(request);
	const pending = gate.list()[0];
	assert.ok(pending);
	const session = {
		resolveApproval: gate.resolve.bind(gate),
		listPendingApprovals: gate.list.bind(gate),
	};
	return {
		gate, session, result, id: pending.id, saved,
		remember: async (subject: string) => { saved.push(subject); },
	};
}

test("always persists the runtime subject even though resolution removes the pending request", async () => {
	const f = fixture();
	await resolveSessionApproval(f.session, f.id, "always", f.remember);
	assert.equal(await f.result, "once");
	assert.deepEqual(f.gate.list(), []);
	assert.deepEqual(f.saved, ["deploy"]);
	await assert.rejects(resolveSessionApproval(f.session, f.id, "always", f.remember), /Invalid or expired/);
	assert.deepEqual(f.saved, ["deploy"]);
});

/*
 * The gate keeps nothing from an escalation, and neither may the host: a line written to the settings
 * would stand on the settings page as a grant, and one that grants nothing.
 */
test("always on an escalation resolves once and persists nothing", async () => {
	const f = fixture({
		kind: "bash", subject: "escalate:danger-full-access:rm -rf ../build", title: "提权运行", detail: "rm -rf ../build",
		escalation: "danger-full-access",
	});
	await resolveSessionApproval(f.session, f.id, "always", f.remember);
	assert.equal(await f.result, "once");
	assert.deepEqual(f.gate.list(), []);
	assert.deepEqual(f.saved, []);
});

for (const decision of ["once", "reject"] as const) {
	test(`${decision} resolves without persisting an allowance`, async () => {
		const f = fixture();
		await resolveSessionApproval(f.session, f.id, decision, f.remember);
		assert.equal(await f.result, decision);
		assert.deepEqual(f.saved, []);
	});
}

test("expired requests cannot persist a permission", async () => {
	const f = fixture();
	f.gate.rejectAll();
	await assert.rejects(resolveSessionApproval(f.session, f.id, "always", f.remember), /Invalid or expired/);
	assert.equal(await f.result, "reject");
	assert.deepEqual(f.saved, []);
});

test("interactive questions reject always and preserve the pending answer", async () => {
	const f = fixture({ kind: "interactive", subject: "choose", title: "Choose", detail: "Choose", options: ["A", "B"] });
	try {
		await assert.rejects(resolveSessionApproval(f.session, f.id, "always", f.remember), /Invalid or expired/);
		assert.equal(f.gate.list().length, 1);
		assert.deepEqual(f.saved, []);
		await resolveSessionApproval(f.session, f.id, { answer: "A" }, f.remember);
		assert.deepEqual(await f.result, { answer: "A" });
		assert.deepEqual(f.saved, []);
	} finally { f.gate.rejectAll(); }
});
