import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { ApprovalDecision } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { ApprovalOverlay } from "../../src/features/conversation/ApprovalOverlay.tsx";
import { PermissionChoices } from "../../src/features/conversation/PermissionChoices.tsx";
import { QuestionChoices } from "../../src/features/conversation/QuestionChoices.tsx";
import { RunningIndicator } from "../../src/features/conversation/RunningIndicator.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

test("approval bodies preserve full content once and omit whitespace-only reasons", async () => {
	const previous = useApp.getState();
	const detail = "第一段需要完整保留。\n" + "长问题与路径 /workspace/very-long-name 需要换行。\n".repeat(50);
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "question", kind: "interactive", title: "需要你的意见", reason: detail.replaceAll("\n", "  "), detail, options: ["继续"], allowCustomInput: true }] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		assert.equal(view.find("pre").textContent, detail);
		assert.equal(view.all(".ly-approval-scroll p").length, 0);
		for (const reason of ["  \n\t", "独立原因应当保留"]) {
			await act(async () => { useApp.setState({ approvals: [{ ...useApp.getState().approvals[0], reason }] }); });
			assert.equal(view.all(".ly-approval-scroll p").length, reason.trim() ? 1 : 0);
			assert.equal(view.find("pre").textContent, detail);
		}
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

/**
 * 一个会过期的问题，必须让人看见它在过期。
 *
 * 从前这个截止时刻只活在 gate 的 `setTimeout` 里：卡片看上去像会一直等下去，直到它悄悄地不等了。
 * 那一次是 941 个提交重写完、停下来问推不推，人离开六分钟，问题过期成了「拒绝」，而屏幕上从头到
 * 尾没有任何东西提过还剩多少时间。
 */
test("a question that can expire shows the time it has left, and one that cannot shows nothing", async (t) => {
	const previous = useApp.getState();
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "question", kind: "interactive", title: "需要你的意见", detail: "是否立即强制推送到远程？", options: ["确认推送"], expiresAt: 1_000_000 + 90_000 }] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		assert.match(view.host.textContent ?? "", /1:30/, "问题带着截止时刻进来，就该看得见还剩多少");
		await act(async () => { t.mock.timers.tick(31_000); });
		assert.match(view.host.textContent ?? "", /0:59/, "而且它要真的在走");

		// 早就过去的那个（崩在半路、没有 agent_end 收尾的一轮重放出来）不说「0:00 后失效」。
		await act(async () => { t.mock.timers.tick(60_000); });
		assert.doesNotMatch(view.host.textContent ?? "", /\d:\d\d/);

		// 没有截止时刻的那种也一样，不该凭空画一个倒计时。
		await act(async () => { useApp.setState({ approvals: [{ ...useApp.getState().approvals[0], expiresAt: undefined }] }); });
		assert.doesNotMatch(view.host.textContent ?? "", /\d:\d\d/);
	} finally { t.mock.timers.reset(); await view.unmount(); useApp.setState(previous, true); }
});

for (const permission of [false, true]) {
	test(`${permission ? "permission" : "question"} failures retain actionable buttons and permit one retry`, async () => {
		const answers: ApprovalDecision[] = [];
		let reject!: (error: Error) => void;
		const answer = async (decision: ApprovalDecision) => { answers.push(decision); return new Promise<void>((_, fail) => { reject = fail; }); };
		const view = await mount(permission ? h(PermissionChoices, { answer }) : h(QuestionChoices, { answer, options: ["继续"], allowCustomInput: true }));
		try {
			if (!permission) await click(view.find('input[type="radio"]'));
			const buttons = view.all<HTMLButtonElement>("button");
			assert.ok(buttons.every(button => button.querySelector("svg")), "every action has an icon");
			const submit = buttons.at(-1)!;
			await click(submit); await click(submit);
			assert.equal(answers.length, 1);
			assert.ok(buttons.every(button => button.disabled));
			await act(async () => { reject(new Error("连接暂时中断")); });
			assert.equal(view.find('[role="alert"]').textContent, "连接暂时中断");
			assert.ok(buttons.every(button => !button.disabled));
			await click(submit);
			assert.equal(answers.length, 2);
			assert.equal(view.all('[role="alert"]').length, 0);
		} finally { await view.unmount(); }
	});
}

test("custom answers sit on the last row, retain retry drafts and leave candidate keys native", async () => {
	const answers: ApprovalDecision[] = [];
	const view = await mount(h(QuestionChoices, { options: ["继续"], allowCustomInput: true, answer: async (decision) => { answers.push(decision); throw new Error("请重试"); } }));
	try {
		assert.equal(view.all('input[aria-label="自定义回答"]').length, 1);
		assert.equal(view.all("[data-ly-question-index]").length, 0);
		assert.equal(view.all("[data-ly-choice-kind]").length, 0);
		const input = view.find<HTMLInputElement>('input[aria-label="自定义回答"]');
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
		setValue.call(input, "保留中文草稿");
		await fire(input, new Event("input", { bubbles: true }));
		await fire(input, new Event("compositionstart", { bubbles: true }));
		for (const key of ["Enter", "ArrowDown", "Escape"]) {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, isComposing: true });
			await fire(input, event);
			assert.equal(event.defaultPrevented, false);
		}
		assert.equal(answers.length, 0);
		await fire(input, new Event("compositionend", { bubbles: true }));
		await fire(view.find("form"), new Event("submit", { bubbles: true, cancelable: true }));
		assert.deepEqual(answers, [{ answer: "保留中文草稿" }]);
		assert.equal(input.value, "保留中文草稿");
		await click(view.find("[data-ly-question-option]"));
		assert.equal(view.find<HTMLInputElement>("[data-ly-question-option] input").checked, true);
		await click(view.find("[data-ly-question-other]"));
		assert.equal(view.find<HTMLInputElement>('input[aria-label="自定义回答"]').value, "保留中文草稿");
	} finally { await view.unmount(); }
});

test("choice rows sit on a wash, not a hairline, and selection is only a fill", async () => {
	const single = await mount(h(QuestionChoices, { options: ["甲", "乙"], allowCustomInput: true, answer: async () => {} }));
	try {
		const row = single.find("[data-ly-question-option]");
		assert.match(row.className, /(?:^|\s)bg-card(?:\s|$)/);
		assert.doesNotMatch(row.className, /border-line/);
		assert.equal(single.find("[data-ly-question-footer]").className.includes("border-t"), false);
		assert.equal(single.all("[data-ly-choice-kind]").length, 0);
		assert.equal(single.all("[data-ly-question-index]").length, 0);
		await click(row);
		assert.match(single.find("[data-ly-question-option]").className, /bg-accent\/\[0\.08\]/);
	} finally { await single.unmount(); }
	const multi = await mount(h(QuestionChoices, { options: ["甲", "乙"], selectionMode: "multi", answer: async () => {} }));
	try {
		assert.equal(multi.find("form").getAttribute("data-ly-choice-mode"), "multi");
		assert.equal(multi.all("[data-ly-choice-kind]").length, 0);
	} finally { await multi.unmount(); }
});

test("digit keys pick numbered rows and 0 focuses the other field", async () => {
	const answers: ApprovalDecision[] = [];
	const view = await mount(h(QuestionChoices, { options: ["甲", "乙", "丙"], allowCustomInput: true, answer: async (decision) => { answers.push(decision); } }));
	try {
		assert.equal(view.all("[data-ly-question-index]").length, 0);
		await fire(view.find("form"), new KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true }));
		assert.equal(view.all<HTMLInputElement>("[data-ly-question-option] input")[1].checked, true);
		await fire(view.find("form"), new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
		assert.equal(view.find<HTMLInputElement>("[data-ly-question-other] input").checked, true);
		assert.equal(document.activeElement, view.find('input[aria-label="自定义回答"]'));
		await fire(view.find('input[aria-label="自定义回答"]'), new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }));
		assert.equal(view.find<HTMLInputElement>("[data-ly-question-other] input").checked, true);
		assert.equal(view.all<HTMLInputElement>("[data-ly-question-option] input")[0].checked, false);
	} finally { await view.unmount(); }
});

test("multi-select submits an array only after confirmation and skip does not select a recommendation", async () => {
	const answers: ApprovalDecision[] = [];
	const props = { selectionMode: "multi" as const, allowSkip: true, options: [{ label: "A", recommended: true }, "B"], answer: async (decision: ApprovalDecision) => { answers.push(decision); } };
	const view = await mount(h(QuestionChoices, props));
	try {
		assert.equal(view.all("input:checked").length, 0);
		await click(view.all("input")[0]); await click(view.all("input")[1]);
		assert.equal(answers.length, 0);
		await fire(view.find("form"), new Event("submit", { bubbles: true, cancelable: true }));
		assert.deepEqual(answers, [{ answer: ["A", "B"] }]);
		await view.rerender(h(QuestionChoices, { ...props, key: "next" }));
		await fire(view.find("input"), new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		assert.deepEqual(answers.at(-1), "skip");
	} finally { await view.unmount(); }
});

test("a cancelled plan stays cleared in the active view, cached view and transcript derivation", async () => {
	const { todosFrom } = await import("../../src/store/derive.ts");
	const { cachedEvent } = await import("../../src/store/cached-event.ts");
	const prior = useApp.getState();
	const todos = [{ content: "old work", status: "in_progress" as const }];
	const old = { role: "toolResult" as const, toolCallId: "t", toolName: "todo_write", content: [], isError: false, timestamp: 1, details: { kind: "todo", todos } };
	const cleared = { role: "user" as const, synthetic: true, clearsTaskPlan: true, content: [], timestamp: 2 };
	assert.deepEqual(todosFrom([old]), todos);
	assert.deepEqual(todosFrom([old, cleared]), []);
	useApp.setState({ activeSessionId: "cancelled", messages: [old], todos });
	try {
		await act(async () => { useApp.getState().applyEvent("cancelled", { type: "message_end", message: cleared }); });
		assert.deepEqual(useApp.getState().todos, []);
		const cached = { messages: [old], toolRuns: {}, meta: { id: "cancelled", title: "fixture", cwd: "/test", projectId: "p", projectName: "p", createdAt: 1, updatedAt: 1, modelId: "", messageCount: 1, seq: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } };
		assert.deepEqual(cachedEvent(cached, { type: "message_end", message: cleared }).state?.todos, []);
	} finally { useApp.setState(prior, true); }
});

test("the recommended chip sits beside the whole copy stack", async () => {
	const view = await mount(h(QuestionChoices, {
		options: [{ label: "跨框架方案", description: "基于有限态机，一次开发同时输出 React 与 Vue 组件库。", recommended: true }, "纯 CSS"],
		answer: async () => {},
	}));
	try {
		const row = view.find("[data-ly-question-option]");
		assert.match(row.className, /items-center/);
		assert.equal(view.find("[data-ly-question-recommended]").textContent, "推荐");
		assert.equal(view.find("[data-ly-question-recommended]").previousElementSibling?.querySelector("[data-ly-question-label]")?.textContent, "跨框架方案");
	} finally { await view.unmount(); }
});

test("folding the card keeps the body mounted and drives the reveal grid", async () => {
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({
		activeSessionId: "fold",
		approvals: [{ id: "question", kind: "interactive", title: "需要你的意见", detail: "选一个", options: ["继续"], allowCustomInput: true }],
	});
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		const reveal = view.find(".ly-reveal");
		assert.equal(reveal.getAttribute("data-open"), "true");
		assert.equal(view.find("[data-ly-question-form]").hasAttribute("inert"), false);
		await click(view.find('button[aria-expanded="true"]'));
		assert.equal(view.find(".ly-reveal").getAttribute("data-open"), "false");
		assert.ok(view.find("[data-ly-question-form]"), "the form stays mounted so the fold can animate");
		assert.ok(view.find(".ly-reveal").hasAttribute("inert"));
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("a pending question replaces the thinking mutter with the dashed waiting line", async () => {
	const prior = useApp.getState();
	useApp.setState({
		activeSessionId: "wait",
		running: true,
		turnStartedAt: Date.now() - 50_000,
		turnTokens: 1200,
		approvals: [{ id: "q", kind: "interactive", title: "需要你的意见", detail: "选一个" }],
		messages: [],
		toolRuns: {},
		retrying: null,
		compactedAt: null,
	});
	const view = await mount(h(RunningIndicator));
	try {
		assert.equal(view.find("[data-ly-running]").getAttribute("data-ly-mood"), "waiting");
		assert.equal(view.find("[data-ly-running]").getAttribute("data-ly-waiting"), "question");
		assert.equal(view.all(".ly-dash").length, 1);
		assert.equal(view.all("canvas").length, 0);
		assert.match(view.text(), /等待你的回答/);
		assert.doesNotMatch(view.text(), /Wrestling/);
		await act(async () => { useApp.setState({ approvals: [{ id: "p", kind: "bash", title: "命令", detail: "ls" }] }); });
		assert.equal(view.find("[data-ly-waiting]").getAttribute("data-ly-waiting"), "approval");
		assert.match(view.text(), /等待你的批准/);
		assert.equal(view.all(".ly-dash").length, 1);
	} finally { await view.unmount(); useApp.setState(prior, true); }
});
