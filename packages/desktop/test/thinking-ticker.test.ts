/**
 * How the reasoning is cut into runs for the thinking line's ticker.
 *
 * A claim about what the reader sees, and one that goes wrong in ways that look plausible in
 * code — an italic rule that eats the underscores out of identifiers, a blank line that
 * becomes an empty run and a double gap.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { thinkingRuns } from "../src/features/conversation/thinking-ticker.ts";

test("every line is a run; blank lines are not", () => {
	assert.deepEqual(thinkingRuns("I need to:\n\n1. Read the diff\n2. Check the tests\n"), [
		"I need to:",
		"Read the diff",
		"Check the tests",
	]);
});

test("markdown marks come off and the words stay", () => {
	assert.deepEqual(
		thinkingRuns(
			"## Plan\n> quoted\n- **bold** and *it* and `code`\n[label](https://x) ![alt](a.png)\n```ts\nconst x = 1\n```",
		),
		["Plan", "quoted", "bold and it and code", "label alt", "const x = 1"],
	);
});

test("an underscore inside an identifier is not emphasis", () => {
	assert.deepEqual(thinkingRuns("call snake_case_name then other_thing"), ["call snake_case_name then other_thing"]);
});

test("runs of whitespace collapse to one space", () => {
	assert.deepEqual(thinkingRuns("a   b\t\tc  "), ["a b c"]);
});

test("consecutive duplicate runs are deduplicated", () => {
	assert.deepEqual(
		thinkingRuns(
			"### Verifying Tailwind Version Adoption\n### Verifying Tailwind Version Adoption\nChecking packages\n### Verifying Tailwind Version Adoption\n",
		),
		["Verifying Tailwind Version Adoption", "Checking packages", "Verifying Tailwind Version Adoption"],
	);
});
