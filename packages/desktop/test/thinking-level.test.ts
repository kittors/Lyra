/**
 * Which level the composer's label and the effort menu both read.
 *
 * Two stored values, one displayed answer. The order is the point: a conversation that has chosen
 * keeps its choice while the app default moves under it, and one that has not follows the default
 * rather than being pinned to whatever it happened to be at when the session was made.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionThinking } from "../src/components/thinking-level.ts";

test("the conversation's own level wins", () => {
	assert.equal(sessionThinking({ thinking: "high" }, { thinking: "low" }), "high");
});

test("a conversation that never chose follows the app default", () => {
	assert.equal(sessionThinking({ thinking: undefined }, { thinking: "low" }), "low");
});

test("off is a choice, not an absence", () => {
	// The bug this guards: `||` here reads "off" as unset and quietly runs the turn at the default,
	// which is the one direction where being wrong also costs money.
	assert.equal(sessionThinking({ thinking: "off" }, { thinking: "high" }), "off");
});

test("with nothing stored anywhere, the shared default", () => {
	// Matches `DEFAULT_SETTINGS.thinking`, so a window that renders before settings arrive does not
	// flash a level the session is not running at.
	assert.equal(sessionThinking(null, null), "medium");
	assert.equal(sessionThinking(undefined, undefined), "medium");
});

test("no session open yet still shows what the next one will start at", () => {
	assert.equal(sessionThinking(null, { thinking: "high" }), "high");
});
