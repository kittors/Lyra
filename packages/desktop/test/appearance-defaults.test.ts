/**
 * That the settings page's idea of "default" is the real one.
 *
 * 恢复默认 restates the code-appearance defaults instead of importing them, because importing a
 * value from `@lyra/core` into the renderer pulls the whole package — native modules and all — into
 * that bundle, and the build refuses. The copy is safe only while something checks it, which is
 * this: a default changed in core and not here would leave the button putting back numbers that
 * stopped being the defaults, silently and only for the people who pressed it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE } from "@lyra/core";
import { CODE_DEFAULTS } from "../src/features/settings/code-defaults.ts";

test("恢复默认 restores what the app actually defaults to", () => {
	for (const [key, value] of Object.entries(CODE_DEFAULTS)) {
		assert.equal(
			value,
			DEFAULT_APPEARANCE[key as keyof typeof DEFAULT_APPEARANCE],
			`${key} 和 core 里的默认值对不上——按下「恢复默认」会得到一个早就不是默认的值`,
		);
	}
});

test("it covers every code-appearance key, so nothing is left at whatever it was", () => {
	const covered = Object.keys(CODE_DEFAULTS);
	for (const key of Object.keys(DEFAULT_APPEARANCE)) {
		if (!key.startsWith("code")) continue;
		assert.ok(covered.includes(key), `${key} 是代码外观的设置，却不在「恢复默认」的范围里`);
	}
});
