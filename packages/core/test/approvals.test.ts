/**
 * A question nobody is there to answer.
 *
 * The gate exists so that a person decides the things a rule should not. When there is no person,
 * waiting forever is not deference — it is a run that never finishes. Refusing is the only safe
 * direction: it grants nothing, and the agent generally finds another way.
 *
 * 但「没人」这件事，对两种等待的意思不一样：权限请求沉默五分钟，合理推断是键盘前没人，拒绝也不
 * 交出任何东西；而 `ask_user` 是模型在问人一个它自己答不了的问题，沉默五分钟只说明人去开会了。
 * 下面那两条锁的就是这个区别。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalGate, type PendingApproval } from "../src/runtime/approvals.ts";
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

const question: ApprovalRequest = {
	kind: "interactive",
	title: "需要你的意见",
	detail: "本地 Git 历史重写已完成，是否立即强制推送到远程？",
	subject: "ask_user",
	options: ["确认推送", "暂缓推送"],
};

/**
 * 真实的那一次：941 个提交重写完，它停下来问推不推，人离开了六分钟，问题过期成了「拒绝」。
 *
 * 权限请求那只五分钟的钟走完时，问题必须还在等——这条测试把两只钟设得差两个数量级，就是为了让
 * 「共用同一个超时」这种写法没法悄悄绿过去。
 */
test("一个问题等的是自己那只钟，比权限请求长得多", async () => {
	const asked: PendingApproval[] = [];
	const instance = new ApprovalGate({
		mode: () => "auto",
		cwd: () => "/Users/me/project",
		ask: async (pending) => void asked.push(pending),
		remember: () => {},
		unattendedTimeoutMs: 20,
		questionTimeoutMs: 5_000,
	});
	const pending = instance.request({ ...question });
	await new Promise((r) => setTimeout(r, 80));
	assert.equal(instance.list().length, 1, "权限请求那只钟不该管到问题头上");

	const [entry] = instance.list();
	assert.ok(entry);
	instance.resolve(entry.id, { answer: "确认推送" });
	assert.deepEqual(await pending, { answer: "确认推送" });
	assert.equal(asked.length, 1);
});

/** 截止时刻要跟着问题一起出门，否则窗口画不出还剩多少时间——而那正是上一次没人看见它的原因。 */
test("每个等待都带着自己的截止时刻交到窗口手上", async () => {
	const asked: PendingApproval[] = [];
	const instance = new ApprovalGate({
		mode: () => "auto",
		cwd: () => "/Users/me/project",
		ask: async (pending) => void asked.push(pending),
		remember: () => {},
		unattendedTimeoutMs: 40,
		questionTimeoutMs: 5_000,
	});
	const before = Date.now();
	const pending = instance.request({ ...question });
	const [entry] = asked;
	assert.ok(entry, "问题送到了窗口");
	assert.ok(entry.expiresAt >= before + 5_000, "截止时刻按问题自己那只钟算");
	assert.ok(entry.expiresAt <= Date.now() + 5_000);
	assert.equal(instance.list()[0]?.expiresAt, entry.expiresAt, "从快照恢复的那份也看得见同一个时刻");

	instance.resolve(entry.id, "reject");
	await pending;

	// 权限请求仍旧用它自己那只短钟，一分不多。
	const permission = Date.now();
	void instance.request({ ...request });
	const [, second] = asked;
	assert.ok(second);
	assert.ok(second.expiresAt <= permission + 40 + 50, "权限请求没有被一起放宽");
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
