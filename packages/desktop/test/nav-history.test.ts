/**
 * Back and forward as rules: what a visit records, what a step passes over.
 *
 * The failure modes are quiet ones — a press that does nothing because the place behind is the same
 * place, a forward that can never happen because landing on the way back recorded a new visit — so
 * each is spelled out here rather than left to the buttons' enabled state.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_HISTORY, NAV_LIMIT, record, sameEntry, step, usable, type NavEntry, type NavSnapshot } from "../src/lib/nav-history.ts";

const chat = (sessionId: string | null): NavEntry => ({ view: "chat", sessionId });
const view = (name: NavEntry["view"]): NavEntry => ({ view: name, sessionId: "whatever" });
const snap = (active: string | null, existing: string[] = ["a", "b", "c"]): NavSnapshot => ({ activeSessionId: active, exists: (id) => existing.includes(id) });

test("the same place twice is one visit; other views ignore which conversation is open", () => {
	let history = record(EMPTY_HISTORY, chat("a"));
	history = record(history, chat("a"));
	assert.equal(history.entries.length, 1);
	assert.ok(sameEntry({ view: "plugins", sessionId: "a" }, { view: "plugins", sessionId: "b" }));
	assert.ok(!sameEntry(chat("a"), chat("b")));
});

test("a new visit after going back drops what was ahead, as in a browser", () => {
	let history = [chat("a"), chat("b"), view("plugins")].reduce(record, EMPTY_HISTORY);
	const back = step(history, -1, snap("b"))!;
	assert.deepEqual(back.entry, chat("b"));
	history = record(back.history, chat("c"));
	assert.deepEqual(history.entries, [chat("a"), chat("b"), chat("c")]);
	assert.equal(step(history, 1, snap("c")), null);
});

test("a deleted conversation is passed over, in both directions", () => {
	const history = [chat("a"), chat("gone"), chat("b")].reduce(record, EMPTY_HISTORY);
	const back = step(history, -1, snap("b"))!;
	assert.deepEqual(back.entry, chat("a"));
	const forward = step(back.history, 1, snap("a"))!;
	assert.deepEqual(forward.entry, chat("b"));
});

test("a blank conversation is returned to only while the window is still on the blank one", () => {
	assert.ok(usable(chat(null), snap(null)));
	assert.ok(!usable(chat(null), snap("a")));
	// Blank, then plugins: back returns to the blank page rather than skipping it.
	const blankThenPlugins = [chat(null), view("plugins")].reduce(record, EMPTY_HISTORY);
	assert.deepEqual(step(blankThenPlugins, -1, snap(null))?.entry, chat(null));
	// Blank, then a conversation: back skips the blank one, which no longer exists to return to.
	const blankThenChat = [chat("a"), chat(null), chat("b")].reduce(record, EMPTY_HISTORY);
	assert.deepEqual(step(blankThenChat, -1, snap("b"))?.entry, chat("a"));
});

test("a step never lands on the place the window is already on", () => {
	// a → plugins → a → (back) would be plugins; then back again must reach past the duplicate a.
	const history = [chat("a"), view("plugins"), chat("a")].reduce(record, EMPTY_HISTORY);
	const back = step(history, -1, snap("a"))!;
	assert.deepEqual(back.entry, view("plugins"));
	const pastDuplicate = step({ ...history, index: 2 }, -1, snap("a"));
	assert.notDeepEqual(pastDuplicate?.entry, chat("a"));
});

test("the list is capped and still steps", () => {
	let history = EMPTY_HISTORY;
	for (let i = 0; i < NAV_LIMIT + 20; i++) history = record(history, chat(`s${i}`));
	assert.equal(history.entries.length, NAV_LIMIT);
	assert.equal(history.index, NAV_LIMIT - 1);
	const exists = () => true;
	assert.deepEqual(step(history, -1, { activeSessionId: `s${NAV_LIMIT + 19}`, exists })?.entry, chat(`s${NAV_LIMIT + 18}`));
});
