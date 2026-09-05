/**
 * An edit's result renders its hunks as a diff, not as the text the tool returned (16 §验收).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { ToolCard } from "../../src/features/conversation/ToolCard.tsx";
import { click, mount } from "../helpers/mount.ts";

const RESULT = {
	content: [{ type: "text" as const, text: "Edited src/a.ts: 1 replacement, +1 -1. New tag: abc" }],
	details: {
		path: "src/a.ts",
		added: 1,
		removed: 1,
		hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: "context", text: "const a = 1;" }, { type: "remove", text: "const b = 2;" }, { type: "add", text: "const b = 3;" }] }],
	},
};

test("an edit result opens into a diff with the changed lines, not the tool's sentence", async () => {
	const view = await mount(
		h(ToolCard, { toolName: "edit", summary: "编辑 src/a.ts", args: { path: "src/a.ts" }, status: "done", result: RESULT as never, stateKey: "t1" }),
	);
	await click(view.find("button"));
	const text = view.text();
	assert.match(text, /const b = 3;/, "the added line is drawn");
	assert.match(text, /const b = 2;/, "and the removed one");
	assert.ok(!text.includes("New tag: abc"), `the tool's own sentence is for the model: ${text}`);
	await view.unmount();
});
