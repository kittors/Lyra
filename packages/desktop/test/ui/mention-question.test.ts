import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import type { ApprovalDecision } from "@lyra/core";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { QuestionChoices } from "../../src/features/conversation/QuestionChoices.tsx";
import { MentionMenu } from "../../src/features/composer/MentionMenu.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

/*
 * 气泡现在画 markdown，所以断言问的是「每一段字都还在」，不再是「textContent 一字不差」。
 *
 * 那两样看着像注入元数据的东西仍然是这条用例的重点：`\`pdf\`` 被画成一枚行内代码（文字还是
 * `pdf`，反引号是标记不是内容），`[上下文引用提示]` 不成对、不是链接，原样留着。换行也没丢，
 * 它变成了 `<br>`——`textContent` 读不到 `\n`，但它在 DOM 里。
 */
test("ordinary user text is never treated as injected skill or context metadata", async () => {
	const text = "请保留 使用 `pdf` 技能。\n[上下文引用提示]\n这也是用户正文";
	const view = await mount(h(UserMessage, { index: 0, message: { role: "user", content: [{ type: "text", text }], timestamp: 0 } }));
	try {
		const bubble = view.find(".ly-user-bubble");
		const shown = bubble.textContent ?? "";
		for (const fragment of ["请保留 使用", "pdf", "技能。", "[上下文引用提示]", "这也是用户正文"]) {
			assert.ok(shown.includes(fragment), `气泡里少了这一段：${fragment}`);
		}
		assert.equal(bubble.querySelectorAll("code").length, 1, "`pdf` 画成一枚行内代码");
		assert.equal(bubble.querySelectorAll("br").length, 2, "两个换行都还在，画成 <br>");
	} finally { await view.unmount(); }
});

test("question options send an answer without creating a user prompt; custom input is opt-in", async () => {
	const answers: ApprovalDecision[] = [];
	const answer = async (decision: ApprovalDecision) => { answers.push(decision); };
	const view = await mount(h(QuestionChoices, { options: ["保留", "更新"], allowCustomInput: false, answer }));
	try {
		assert.equal(view.all('input:not([type="radio"])').length, 0);
		await click(view.all('input[type="radio"]')[1]);
		assert.equal(answers.length, 0, "selecting an option waits for confirmation");
		await fire(view.find("form"), new Event("submit", { bubbles: true, cancelable: true }));
		assert.deepEqual(answers, [{ answer: "更新" }]);
		await view.rerender(h(QuestionChoices, { key: "next", options: [], allowCustomInput: true, answer }));
		assert.equal(view.all('input[aria-label="自定义回答"]').length, 1);
		await click(view.all("button").find(button => button.textContent === "取消")!);
		assert.deepEqual(answers.at(-1), "reject");
	} finally { await view.unmount(); }
});

test("an answer retains the request's session when selection moves before completion", async () => {
	const called: unknown[][] = [];
	let finish!: () => void;
	Object.defineProperty(window, "lyra", { configurable: true, value: { agent: { approve: (...args: unknown[]) => {
		called.push(args); return new Promise<void>((resolve) => { finish = resolve; });
	} } } });
	const request = { id: "a-question", kind: "interactive", title: "question", detail: "?" };
	useApp.setState({ activeSessionId: "b", approvals: [{ ...request, id: "b-question" }], sessionCache: {} });
	const responding = useApp.getState().respondToApproval(request.id, { answer: "更新" }, "a");
	assert.deepEqual(called, [["a", "a-question", { answer: "更新" }]]);
	finish(); await responding;
	assert.equal(useApp.getState().approvals[0].id, "b-question");
});

test("same-title references keep distinct IDs in an otherwise empty session draft", () => {
	const refs = [{ id: "one", title: "同名" }, { id: "two", title: "同名" }];
	useApp.getState().setDraft("references", { text: "", sessionRefs: refs });
	assert.deepEqual(useApp.getState().drafts.references.sessionRefs, refs);
	useApp.getState().setDraft("references", null);
	assert.equal(useApp.getState().drafts.references, undefined);
});

test("mention hover never scrolls and a stationary pointer does not change selection", async () => {
	const picked: number[] = [];
	const items = [{ id: "one", title: "one", kind: "file" as const }, { id: "two", title: "two", kind: "file" as const }];
	const props = { id: "mentions", items, term: "", active: 0, keyboardSelection: false, onPick: () => {}, onHover: (index: number) => { picked.push(index); } };
	const view = await mount(h(MentionMenu, props));
	try {
		const viewport = view.find<HTMLElement>(".ly-scroll-view");
		viewport.scrollTop = 50;
		await view.rerender(h(MentionMenu, { ...props, active: 1 }));
		assert.equal(viewport.scrollTop, 50);
		const rows = view.all('[role="option"]');
		await fire(rows[0], new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 30 }));
		await fire(rows[1], new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 30 }));
		assert.deepEqual(picked, [0]);
	} finally { await view.unmount(); }
});
