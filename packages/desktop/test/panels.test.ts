/**
 * The panel registry.
 *
 * The claim: a panel can be added or replaced without editing the side panel component.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allPanels, registerPanels, type PanelDefinition } from "../src/features/dock/panels/registry.ts";

const stub = (kind: string, label: string): PanelDefinition =>
	({ kind, label, icon: (() => null) as never, shortcut: "⌘0", render: () => null }) as unknown as PanelDefinition;

test("a registered panel joins the list, and withdrawing removes it", () => {
	const before = allPanels().length;
	const remove = registerPanels([stub("notes", "笔记")]);
	assert.equal(allPanels().length, before + 1);
	assert.equal(allPanels().find((p) => p.kind === "notes")?.label, "笔记");
	remove();
	assert.equal(allPanels().length, before);
});

test("a later registration replaces one of the same kind", () => {
	const first = registerPanels([stub("notes", "笔记")]);
	const second = registerPanels([stub("notes", "更好的笔记")]);
	assert.equal(allPanels().filter((p) => p.kind === "notes").length, 1, "one panel per kind");
	assert.equal(allPanels().find((p) => p.kind === "notes")?.label, "更好的笔记");
	second();
	assert.equal(allPanels().find((p) => p.kind === "notes")?.label, "笔记", "and the displaced one comes back");
	first();
});

test("availability is decided against the current state, not at registration", () => {
	const remove = registerPanels([
		{
			...stub("notes", "笔记"),
			unavailable: (state) => (state.workspace ? undefined : "先打开一个项目"),
		},
	]);
	const panel = allPanels().find((p) => p.kind === "notes");
	assert.equal(panel?.unavailable?.({ workspace: false, session: false }), "先打开一个项目");
	assert.equal(panel?.unavailable?.({ workspace: true, session: false }), undefined);
	remove();
});
