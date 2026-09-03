/**
 * Which settings pages a phone gets, and which page it lands on.
 *
 * Two failures worth a test rather than a bug report. One: a group whose every item was hidden
 * renders as a heading with nothing under it, which reads as a section that failed to load. Two:
 * the desktop remembers which settings page it was last on and the phone shares that memory — so
 * arriving directly at a hidden page is not a hypothetical, and the result would be a blank pane
 * with no row selected and nothing saying why.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { groupsFor, sectionFor, HIDDEN_ON_MOBILE } from "../src/features/settings/sections-for.ts";
import type { SettingsSection } from "../src/store/index.ts";

const item = (id: SettingsSection) => ({ id });

const GROUPS = [
	{ label: "基础设置", items: [item("general"), item("appearance"), item("models"), item("browser")] },
	{ label: "Agent 能力", items: [item("plugins"), item("commands"), item("hooks")] },
	{ label: "数据与统计", items: [item("index"), item("sync"), item("usage")] },
	{ label: "代码与版本控制", items: [item("worktrees")] },
];

const ids = (groups: { items: { id: SettingsSection }[] }[]) => groups.flatMap((g) => g.items.map((i) => i.id));

test("the desktop sees everything, unchanged", () => {
	assert.deepEqual(ids(groupsFor(GROUPS, false)), ids(GROUPS));
});

test("the phone loses the pages about a machine it is not holding", () => {
	const shown = ids(groupsFor(GROUPS, true));
	for (const hidden of ["browser", "commands", "hooks", "index", "sync", "worktrees"] as SettingsSection[]) {
		assert.ok(!shown.includes(hidden), `${hidden} 不该出现在手机上`);
	}
});

test("and keeps the ones that are about the app rather than the machine", () => {
	const shown = ids(groupsFor(GROUPS, true));
	for (const kept of ["general", "appearance", "models", "plugins", "usage"] as SettingsSection[]) {
		assert.ok(shown.includes(kept), `${kept} 应该留在手机上`);
	}
});

test("a group with nothing left in it is dropped, not left as a bare heading", () => {
	// 代码与版本控制 holds only worktrees, which is hidden — the heading alone would read as a
	// section that failed to load.
	const labels = new Set(groupsFor(GROUPS, true).map((group) => group.label));
	assert.ok(!labels.has("代码与版本控制"));
	assert.ok(labels.has("基础设置"));
});

test("arriving at a hidden page lands somewhere real instead of blank", () => {
	// The desktop remembers where it was and the phone shares that memory, so this is how someone
	// actually gets here.
	assert.equal(sectionFor(GROUPS, "sync", true), "general");
	assert.equal(sectionFor(GROUPS, "worktrees", true), "general");
});

test("a page that is fine stays where it is", () => {
	assert.equal(sectionFor(GROUPS, "models", true), "models");
	assert.equal(sectionFor(GROUPS, "usage", true), "usage");
});

test("the desktop is never redirected, even to a page the phone hides", () => {
	assert.equal(sectionFor(GROUPS, "sync", false), "sync");
	assert.equal(sectionFor(GROUPS, "worktrees", false), "worktrees");
});

test("the hidden list is about capability, not taste", () => {
	/*
	 * Each of these is hidden because the phone cannot carry it out, not because it would be
	 * cluttered — the test states the reason so a later change has to disagree with it out loud.
	 */
	for (const id of ["screenshot", "browser", "worktrees", "index", "formatting", "commands", "hooks", "sync"]) {
		assert.ok(HIDDEN_ON_MOBILE.has(id as SettingsSection), `${id} 应在隐藏列表里`);
	}
	// And things that merely look advanced are not hidden: an agent's permissions matter more on a
	// phone, not less, because that is where you approve things away from the keyboard.
	for (const id of ["access", "agents", "personalization", "forges"]) {
		assert.ok(!HIDDEN_ON_MOBILE.has(id as SettingsSection), `${id} 不该被隐藏`);
	}
});
