import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, createRef } from "react";
import { QuestionNav } from "../../src/features/conversation/QuestionNav.tsx";
import { questionsIn } from "../../src/features/conversation/question-navigation.ts";
import { useTranscriptWindow } from "../../src/features/conversation/view-state.ts";
import { mount, click, fire, press } from "../helpers/mount.ts";

test("click preserves the hovered rail targets, closes preview, and keyboard navigation reaches both ends", async () => {
	const questions = Array.from({ length: 120 }, (_, index) => ({ index, text: `Question ${index}`, answer: "**Formatted**\n\n### Heading\n\n- `code`" }));
	let selected = -1;
	const view = await mount(h(QuestionNav, { questions, viewport: createRef<HTMLDivElement>(), onSelect: (index) => { selected = index; } }));
	try {
		const button = view.all<HTMLButtonElement>(".ly-question-mark")[0];
		await fire(button, new MouseEvent("mouseover", { bubbles: true }));
		const geometry = () => view.all<HTMLElement>(".ly-question-mark").map((el) => el.dataset.position);
		const before = geometry();
		assert.equal(view.find('[role="tooltip"] .ly-question-excerpt').textContent, "Formatted Heading code");
		assert.equal(view.host.querySelector('[role="tooltip"] hr, [role="tooltip"] h3'), null);
		await click(button);
		assert.equal(selected, Number(button.dataset.position));
		assert.deepEqual(geometry(), before);
		assert.equal(view.find('[role="tooltip"]').getAttribute("aria-hidden"), "true");
		await press(button, "Home");
		assert.equal(selected, 0);
		assert.equal(view.all(".ly-question-mark").length, 15);
		await press(view.find('[data-position="0"]'), "End");
		assert.equal(selected, 119);
		assert.ok(view.find('[data-position="119"]'));
	} finally { await view.unmount(); }
});

test("identical questions have separate targets; synthetic prompts have none", () => {
	assert.deepEqual(questionsIn([
		{ role: "user", content: [{ type: "text", text: "same" }], timestamp: 1 },
		{ role: "user", content: [{ type: "text", text: "same" }], timestamp: 2 },
		{ role: "user", synthetic: true, content: [{ type: "text", text: "continue" }], timestamp: 3 },
		{ role: "user", content: [{ type: "image", data: "", mimeType: "image/png" }], timestamp: 4 },
	]), [{ index: 0, text: "same", answer: "" }, { index: 1, text: "same", answer: "" }, { index: 3, text: "图片消息", answer: "" }]);
});

test("jumping through 10,000 runs mounts one window and preserves each session's range", async () => {
	function Window({ id }: { id: string }) {
		const range = useTranscriptWindow(id, 60, 10_000);
		return h("div", null,
			h("output", null, `${range.start}:${range.end}`),
			h("button", { id: "old", onClick: () => range.reveal(10) }, "old"),
			h("button", { id: "latest", onClick: range.latest }, "latest"));
	}
	const view = await mount(h(Window, { id: "nav-a" }));
	try {
		await click(view.find("#old"));
		assert.equal(view.find("output").textContent, "5:65");
		await view.rerender(h(Window, { id: "nav-b" }));
		assert.equal(view.find("output").textContent, "9940:10000");
		await view.rerender(h(Window, { id: "nav-a" }));
		assert.equal(view.find("output").textContent, "5:65");
		await click(view.find("#latest"));
		assert.equal(view.find("output").textContent, "9940:10000");
	} finally { await view.unmount(); }
});

test("latest keeps a widened window instead of shrinking it back to the step", async () => {
	function Window({ id }: { id: string }) {
		const range = useTranscriptWindow(id, 20, 80);
		return h("div", null,
			h("output", null, `${range.start}:${range.end}`),
			h("button", { id: "more", onClick: range.earlier }, "more"),
			h("button", { id: "latest", onClick: range.latest }, "latest"));
	}
	const view = await mount(h(Window, { id: "wide" }));
	try {
		assert.equal(view.find("output").textContent, "60:80");
		await click(view.find("#more"));
		assert.equal(view.find("output").textContent, "40:80");
		await click(view.find("#latest"));
		assert.equal(view.find("output").textContent, "40:80", "sending must not unmount the extra turns");
	} finally { await view.unmount(); }
});
