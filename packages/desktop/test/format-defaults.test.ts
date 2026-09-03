/**
 * The renderer's copy of the formatting defaults, checked against the real ones.
 *
 * It is a copy because it has to be: importing a *value* from `@lyra/core` into this bundle drags
 * the native modules in with it and the build fails. Types are free, values are not — the same
 * constraint that produced `code-defaults.ts`. What a copy cannot do is notice when the original
 * changes, so this notices for it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FORMATTING } from "@lyra/core";
import { FORMAT_DEFAULTS } from "../src/features/editor/format.ts";

test("the renderer's defaults are the same as the settings file's", () => {
	// `onSave` is deliberately absent from the renderer's copy: it decides *whether* to format,
	// not how, and the formatter has no use for it.
	const { onSave, ...rest } = DEFAULT_FORMATTING;
	assert.equal(typeof onSave, "boolean");
	assert.deepEqual(FORMAT_DEFAULTS, rest);
});
