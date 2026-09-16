import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalGate } from "../src/runtime/approvals.ts";
import { askUserTool } from "../src/tools/ask-user.ts";
import type { PermissionMode } from "../src/config/settings.ts";
import type { ToolContext } from "../src/types.ts";

for (const mode of ["ask", "auto", "full"] satisfies PermissionMode[]) {
	test(`ask_user waits for and returns its own answer in ${mode} mode`, async () => {
		const gate = new ApprovalGate({ mode: () => mode, cwd: () => "/test", ask: async () => {}, remember: () => {} }, ["ask_user"]);
		const ctx: ToolContext = { cwd: "/test", sessionId: "a", state: new Map(), requestApproval: (request) => gate.request(request) };
		const result = askUserTool.execute({ question: "选择实现", options: ["保留", "更新"] }, ctx);
		try {
			const [request] = gate.list();
			assert.ok(request, "permission policy must not answer a question");
			assert.equal(gate.resolve(request.id, "always"), false);
			assert.equal(gate.resolve(request.id, "once"), false);
			assert.equal(gate.resolve(request.id, { answer: "未知" }), false);
			assert.equal(gate.resolve("different-request", { answer: "保留" }), false);
			assert.equal(gate.resolve(request.id, { answer: "保留" }), true);
			assert.deepEqual((await result).content, [{ type: "text", text: "保留" }]);
		} finally { gate.rejectAll(); }
	});
}

test("free-form input is explicit; cancellation does not invent an answer", async () => {
	const gate = new ApprovalGate({ mode: () => "full", cwd: () => "/test", ask: async () => {}, remember: () => {} });
	const ctx: ToolContext = { cwd: "/test", sessionId: "a", state: new Map(), requestApproval: (request) => gate.request(request) };
	try {
		const pending = askUserTool.execute({ question: "其他方案？", options: [], allowCustomInput: true }, ctx);
		const [request] = gate.list();
		assert.equal(gate.resolve(request.id, { answer: " " }), false);
		assert.equal(gate.resolve(request.id, { answer: "  先评估  " }), true);
		assert.deepEqual((await pending).content, [{ type: "text", text: "先评估" }]);
		const cancelled = askUserTool.execute({ question: "继续？", options: ["继续"] }, ctx);
		gate.rejectAll();
		assert.equal((await cancelled).isError, true);
	} finally { gate.rejectAll(); }
});

test("an interactive answer cannot authorize a side effect", async () => {
	const gate = new ApprovalGate({ mode: () => "ask", cwd: () => "/test", ask: async () => {}, remember: () => {} });
	const pending = gate.request({ kind: "bash", title: "命令", detail: "run", subject: "run" });
	const [request] = gate.list();
	assert.equal(gate.resolve(request.id, { answer: "允许" }), false);
	assert.equal(gate.resolve(request.id, "skip"), false);
	gate.rejectAll();
	assert.equal(await pending, "reject");
});

test("multi-select validates every answer and skip only adopts an explicit default", async () => {
	const gate = new ApprovalGate({ mode: () => "full", cwd: () => "/test", ask: async () => {}, remember: () => {} });
	const ctx: ToolContext = { cwd: "/test", sessionId: "a", state: new Map(), requestApproval: request => gate.request(request) };
	try {
		const args = { question: "选择", options: [{ label: "A", description: "first", recommended: true }, "B"], selectionMode: "multi" as const };
		const pending = askUserTool.execute(args, ctx);
		let request = gate.list()[0];
		for (const answer of [[], ["A", "unknown"], ["A", "A"], [7]]) assert.equal(gate.resolve(request.id, { answer }), false);
		assert.equal(gate.resolve(request.id, { answer: ["A", "B"] }), true);
		assert.deepEqual((await pending).content, [{ type: "text", text: '["A","B"]' }]);
		const skipped = askUserTool.execute(args, ctx);
		request = gate.list()[0];
		assert.equal(gate.resolve(request.id, "skip"), true);
		assert.match((await skipped).content[0].text, /No answer or permission/);
		const defaulted = askUserTool.execute({ ...args, defaultOptionIndex: 1 }, ctx);
		assert.equal(gate.resolve(gate.list()[0].id, "skip"), true);
		assert.match((await defaulted).content[0].text, /explicit default: B/);
		const required = askUserTool.execute({ ...args, allowSkip: false }, ctx);
		assert.equal(gate.resolve(gate.list()[0].id, "skip"), false);
		gate.rejectAll();
		assert.equal((await required).isError, true);
	} finally { gate.rejectAll(); }
});

test("single-select rejects arrays and malformed defaults fail before opening a request", async () => {
	const gate = new ApprovalGate({ mode: () => "full", cwd: () => "/test", ask: async () => {}, remember: () => {} });
	const ctx: ToolContext = { cwd: "/test", sessionId: "a", state: new Map(), requestApproval: request => gate.request(request) };
	const pending = askUserTool.execute({ question: "选择", options: ["A", "B"] }, ctx);
	assert.equal(gate.resolve(gate.list()[0].id, { answer: ["A"] }), false);
	gate.rejectAll(); await pending;
	assert.equal((await askUserTool.execute({ question: "选择", options: ["A"], defaultOptionIndex: 2 }, ctx)).isError, true);
	assert.equal(gate.list().length, 0);
});
