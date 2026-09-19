import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFilePanelChanges, readFilePanelState, requestFilePanel, type FilePanelState } from "../shared/file-panel-state.ts";

const a = { path: "/project/alpha.ts", name: "alpha.ts" };
const b = { path: "/project/beta.ts", name: "beta.ts" };
const c = { path: "/other/gamma.ts", name: "gamma.ts" };
const initial: FilePanelState = { path: b.path, tabs: [a, b], drafts: { [a.path]: "alpha draft", [b.path]: "beta draft" }, wrap: true, showSource: true };

test("the IPC snapshot accepts tabs and drafts but rejects malformed or dangling state", () => {
	assert.deepEqual(readFilePanelState(initial), initial);
	for (const input of [null, [], {}, { ...initial, path: 4 }, { ...initial, path: c.path }, { ...initial, tabs: [a, a] }, { ...initial, tabs: [{ ...a, path: "bad\0path" }] }, { ...initial, drafts: { [c.path]: "orphan" } }, { ...initial, drafts: { [a.path]: 4 } }, { ...initial, wrap: "true" }]) {
		assert.equal(readFilePanelState(input), null, JSON.stringify(input));
	}
});

test("opening another source file keeps newer detached edits and never resurrects a saved draft", () => {
	const detached = { ...initial, drafts: { [b.path]: "newer detached draft" } };
	const requested = { ...initial, path: c.path, tabs: [...initial.tabs, c], drafts: { ...initial.drafts, [c.path]: "gamma draft" } };
	const next = requestFilePanel(detached, requested);
	assert.equal(next.path, c.path);
	assert.deepEqual(next.tabs, [a, b, c]);
	assert.deepEqual(next.drafts, { [b.path]: "newer detached draft", [c.path]: "gamma draft" });
});

test("returned edits preserve another project's active tab and unsaved work", () => {
	const source = { ...initial, path: c.path, tabs: [...initial.tabs, c], drafts: { ...initial.drafts, [c.path]: "other project draft" } };
	const edited = { ...initial, drafts: { [a.path]: "alpha draft", [b.path]: "edited in window" } };
	const returned = mergeFilePanelChanges(initial, edited, source);
	assert.equal(returned.path, c.path);
	assert.deepEqual(returned.tabs, [a, b, c]);
	assert.deepEqual(returned.drafts, { [a.path]: "alpha draft", [b.path]: "edited in window", [c.path]: "other project draft" });
});

test("a detached save and tab close clear only their own old drafts", () => {
	const source = { ...initial, tabs: [...initial.tabs, c], drafts: { ...initial.drafts, [c.path]: "unrelated" } };
	const edited = { ...initial, tabs: [b], drafts: {} };
	const returned = mergeFilePanelChanges(initial, edited, source);
	assert.deepEqual(returned.tabs, [b, c]);
	assert.deepEqual(returned.drafts, { [c.path]: "unrelated" });
	assert.equal(returned.path, b.path);
});

test("a stale edit acknowledgement rebases onto the new file requested meanwhile", () => {
	const remote = requestFilePanel(initial, { ...initial, path: c.path, tabs: [...initial.tabs, c] });
	const local = { ...initial, drafts: { ...initial.drafts, [b.path]: "last keystroke" } };
	const rebased = mergeFilePanelChanges(initial, local, remote);
	assert.equal(rebased.path, c.path);
	assert.deepEqual(rebased.tabs, [a, b, c]);
	assert.equal(rebased.drafts[b.path], "last keystroke");
});
