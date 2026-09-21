/**
 * A question nobody is there to answer.
 *
 * The gate exists so that a person decides the things a rule should not. When there is no person,
 * waiting forever is not deference — it is a run that never finishes. Refusing is the only safe
 * direction: it grants nothing, and the agent generally finds another way.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalGate } from "../src/runtime/approvals.ts";
import type { ApprovalRequest } from "../src/types.ts";

const request: ApprovalRequest = {
	kind: "bash",
	title: "Remove a directory outside the project",
	detail: "rm -rf /Users/me/elsewhere",
	subject: "rm -rf /Users/me/elsewhere",
};

function gate(options: Partial<Parameters<typeof ApprovalGate.prototype.request>> = {}, timeoutMs = 40) {
	const asked: string[] = [];
	const instance = new ApprovalGate({
		mode: () => "auto",
		cwd: () => "/Users/me/project",
		ask: async (pending) => {
			asked.push(pending.id);
		},
		remember: () => {},
		unattendedTimeoutMs: timeoutMs,
	});
	return { instance, asked };
}

test("an unanswered question becomes a refusal rather than a wait", async () => {
	const { instance, asked } = gate();
	const decision = await instance.request({ ...request });
	assert.equal(decision, "reject");
	assert.equal(asked.length, 1, "it did ask first");
	assert.deepEqual(instance.list(), [], "and stopped waiting for an answer");
});

test("an answer given in time still wins", async () => {
	const { instance } = gate(undefined, 5_000);
	const pending = instance.request({ ...request });
	// The person is there.
	await new Promise((r) => setTimeout(r, 10));
	const [entry] = instance.list();
	assert.ok(entry, "the question is waiting");
	instance.resolve(entry.id, "once");
	assert.equal(await pending, "once");
});

/**
 * 读取这一类要真的穿过这道门。
 *
 * `auto` 模式下 gate 不直接问人，而是先问审批策略（`approval-policy.ts`）：不 risky 就静默放行。
 * 这里锁的是结果而不是实现——策略今天靠「没见过的 kind 一律交给人」这条兜底答对，明天可能改成
 * 一张显式的表。两种写法都行，**答错的后果不是报错，是整条修复悄悄失效**：工具照常发问，gate
 * 自己答应了自己，一个窗口都不会弹，而没有任何测试是红的。
 *
 * 试过把 `approval-policy.ts` 里那行显式分支删掉：这两条依然绿，因为兜底接住了。那正是它们该有的
 * 样子——它们断言的是「读取会被送到人面前」，不是「用哪一行代码送」。
 */
const readRequest: ApprovalRequest = {
	kind: "read",
	title: "读取当前项目之外的位置：/Users/me/other-project/src/app.ts",
	detail: "/Users/me/other-project/src/app.ts",
	subject: "read:/Users/me/other-project",
	reason: "读取当前项目之外的位置",
};

test("在 auto 模式下，读取会被送到人面前而不是被策略放行", async () => {
	const { instance, asked } = gate();
	const decision = await instance.request({ ...readRequest });
	assert.equal(asked.length, 1, "策略若把读取判成不用问，这里就是 0，而且没有任何报错");
	assert.equal(decision, "reject", "没人回答仍然是拒绝");
});

test("批准过的授权范围不再问第二次", async () => {
	const { instance, asked } = gate(undefined, 5_000);
	instance.allow(readRequest.subject);
	assert.equal(await instance.request({ ...readRequest }), "once");
	assert.equal(asked.length, 0, "同一个授权范围内的下一个文件不该再打扰人");

	// 但别的范围仍然要问。
	const other = instance.request({ ...readRequest, subject: "read:/Users/me/third-project" });
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(asked.length, 1);
	const [entry] = instance.list();
	instance.resolve(entry.id, "reject");
	assert.equal(await other, "reject");
});

test("full 模式不问读取，和它从不问 bash 是同一件事", async () => {
	/*
	 * `full` 就是「没有沙箱」，这是它一直以来的意思。以前的不一致正是在这里最刺眼：同样在 full
	 * 模式下，`cat ~/.ssh/id_rsa` 一路放行，而 `read` 同一个路径被硬拒。统一之后两条路一起放行
	 * ——攻击面没有变大（shell 那条从来就是通的），变的是它们终于在说同一句话。
	 */
	const asked: string[] = [];
	const full = new ApprovalGate({
		mode: () => "full",
		cwd: () => "/Users/me/project",
		ask: async (pending) => void asked.push(pending.id),
		remember: () => {},
		unattendedTimeoutMs: 40,
	});
	assert.equal(await full.request({ ...readRequest }), "once");
	assert.equal(asked.length, 0);
});
