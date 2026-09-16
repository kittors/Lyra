import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { ChoiceMark } from "../../src/ui/primitives/ChoiceMark.tsx";
import { QuestionChoices } from "../../src/features/conversation/QuestionChoices.tsx";
import { click, mount } from "../helpers/mount.ts";

test("a checkbox mark fills and a radio mark stays a circle", async () => {
	const box = await mount(h(ChoiceMark, { kind: "checkbox", checked: true }));
	const radio = await mount(h(ChoiceMark, { kind: "radio", checked: true }));
	try {
		assert.equal(box.find("[data-ly-choice-kind=checkbox]").getAttribute("data-ly-choice"), "on");
		assert.equal(radio.find("[data-ly-choice-kind=radio]").getAttribute("data-ly-choice"), "on");
		assert.match(radio.find("[data-ly-choice-kind=radio]").className, /rounded-full/);
		assert.doesNotMatch(box.find("[data-ly-choice-kind=checkbox]").className, /rounded-full/);
	} finally {
		await box.unmount();
		await radio.unmount();
	}
});

test("question choices keep a hidden native input and paint the shared mark", async () => {
	const view = await mount(h(QuestionChoices, { options: ["继续", "停"], answer: async () => {} }));
	try {
		const input = view.find<HTMLInputElement>('input[type="radio"]');
		assert.match(input.className, /sr-only/);
		assert.equal(view.all("[data-ly-choice-kind=radio]").length, 2);
		assert.equal(view.all("[data-ly-choice=on]").length, 0);
		await click(view.all("label")[0]);
		assert.equal(view.find<HTMLInputElement>('input[type="radio"]').checked, true);
		assert.equal(view.all("[data-ly-choice=on]").length, 1);
	} finally {
		await view.unmount();
	}
});
