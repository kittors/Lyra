/**
 * The built-in formatter, on a file longer than the first screen of an editor.
 *
 * `EditorState.create` parses only the first 3,000 characters, and for at most 20ms — what an editor
 * needs to paint its first screen, the rest parsed later in the background by the view. There is no
 * view here, and `indentRange` skips every line the syntax tree does not reach: a longer file had
 * its top reindented and the rest left as it was. On a machine busy enough to spend the 20ms before
 * the parse was done, even a short one came out differently each time — which CI saw as a formatter
 * changing its own output on the second pass.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatWithBuiltin } from "../src/features/editor/builtin-format.ts";

const OPTS = {
	tabWidth: 4,
	useTabs: false,
	printWidth: 120,
	singleQuote: false,
	semi: true,
	trailingComma: "all" as const,
	bracketSpacing: true,
	arrowParens: "always" as const,
};

const indentOf = (line: string | undefined) => line?.match(/^ */)?.[0].length;

test("a file past the first screen is reindented to its last line", async () => {
	// Two hundred functions with every line pushed to the margin: about 7,000 characters.
	const block = (i: number) => `fn f${i}() {\nif true {\nlet x = ${i};\n}\n}\n`;
	const source = Array.from({ length: 200 }, (_, i) => block(i)).join("");
	assert.ok(source.length > 3_000, "the point is a file longer than the first parse");

	const out = await formatWithBuiltin("rs", source, OPTS);
	const lines = out.split("\n");
	const first = lines.find((line) => line.includes("let x = 0;"));
	const last = lines.find((line) => line.includes("let x = 199;"));
	assert.equal(indentOf(first), 8, `the top is indented: ${JSON.stringify(first)}`);
	assert.equal(indentOf(last), indentOf(first), `and so is the bottom: ${JSON.stringify(last)}`);
	// And a second pass has nothing left to do.
	assert.equal(await formatWithBuiltin("rs", out, OPTS), out);
});
