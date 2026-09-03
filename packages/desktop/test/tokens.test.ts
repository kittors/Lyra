/**
 * What the detail panes colour, and what they leave alone.
 *
 * The rule worth defending is that only the first word of each command is a command: `cd x && npm
 * run build` has two programs in it and four other words, and colouring the four would say they
 * were something they are not.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenizeJson, tokenizeShell } from "../src/features/conversation/detail/tokens.ts";

const kinds = (text: string, of: "shell" | "json" = "shell") =>
	(of === "shell" ? tokenizeShell(text) : tokenizeJson(text))
		.filter((token) => token.text.trim())
		.map((token) => `${token.kind}:${token.text}`);

test("the program is coloured, and so is the one after every operator", () => {
	assert.deepEqual(kinds("cd /tmp && npm run build"), [
		"command:cd",
		"plain:/tmp",
		"operator:&&",
		"command:npm",
		"plain:run",
		"plain:build",
	]);
});

test("flags, strings and variables are each their own thing", () => {
	assert.deepEqual(kinds(`curl -s "http://x/y" -o $HOME/out`), [
		"command:curl",
		"flag:-s",
		'string:"http://x/y"',
		"flag:-o",
		"variable:$HOME",
		"plain:/out",
	]);
});

test("a pipe starts a new command", () => {
	assert.deepEqual(kinds("git log | head -3"), [
		"command:git",
		"plain:log",
		"operator:|",
		"command:head",
		"flag:-3",
	]);
});

test("a JSON key is a string followed by a colon, and nothing else is", () => {
	assert.deepEqual(kinds('{"path": "a.ts", "limit": 3}', "json"), [
		"operator:{",
		'key:"path"',
		"operator::",
		'string:"a.ts"',
		"operator:,",
		'key:"limit"',
		"operator::",
		"number:3",
		"operator:}",
	]);
});

test("an unterminated quote mid-stream is still a string, not a crash", () => {
	assert.deepEqual(kinds('echo "half'), ["command:echo", 'string:"half']);
	assert.deepEqual(kinds('{"a": "b', "json"), ["operator:{", 'key:"a"', "operator::", 'string:"b']);
});
