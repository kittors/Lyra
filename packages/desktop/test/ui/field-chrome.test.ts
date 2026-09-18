/**
 * Settings fields and dropdowns share the dialog capsule, so a row of them does not look like
 * two toolkits glued together.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { InlineSelect, TextInput } from "../../src/features/settings/inputs.tsx";
import { SearchField } from "../../src/ui/inputs/SearchField.tsx";
import { mount } from "../helpers/mount.ts";

test("输入框、下拉和搜索共用 ly-field", async () => {
	const input = await mount(h(TextInput, { value: "命令名", onChange: () => {} }));
	assert.match(input.find("input").className, /\bly-field\b/);
	assert.equal(input.find("input").getAttribute("data-ly-field"), "");
	await input.unmount();

	const select = await mount(
		h(InlineSelect, { value: "a", onChange: () => {}, options: [{ value: "a", label: "每 6 小时" }] }),
	);
	const trigger = select.find("button");
	assert.match(trigger.className, /\bly-field\b/);
	assert.equal(trigger.getAttribute("data-ly-select"), "");
	await select.unmount();

	const search = await mount(h(SearchField, { value: "", onChange: () => {}, size: "comfortable" }));
	assert.match(search.find("[data-ly-field]").className, /\bly-field\b/);
	assert.equal(search.find("[data-ly-field]").className.includes("ly-field-compact"), false);
	await search.unmount();
});
