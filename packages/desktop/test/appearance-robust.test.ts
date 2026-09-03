/**
 * Applying a theme that arrived with pieces missing.
 *
 * Settings used to reach the renderer one way — read off disk, where they are merged with the
 * defaults on the way in. Now a phone receives them over a socket instead, and that path has no
 * such merge: whatever the desktop broadcasts is applied as it stands.
 *
 * So one absent field became a blank screen. `parseHex(undefined)` throws, the throw happens inside
 * a render, and the error boundary replaces the entire interface with a message about the renderer
 * — found on a real phone, which showed 「这个界面崩了」 and `hex.trim` where a light theme should
 * have been. Losing the app over a colour is the wrong trade at any time; over a colour that
 * arrived across a network, it is one a version mismatch could cause on its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "@lyra/core";
import { parseHex } from "../src/lib/theme.ts";

test("a colour that is not there reads as no colour, rather than throwing", () => {
	// Every caller already handles null — they all carry a fallback — and none of them are wrapped
	// in anything that would catch an exception.
	assert.equal(parseHex(undefined), null);
	assert.equal(parseHex(null), null);
	assert.equal(parseHex(""), null);
	assert.equal(parseHex("not a colour"), null);
	assert.equal(parseHex(12 as unknown as string), null);
});

test("a colour that is there still parses, in every form", () => {
	assert.deepEqual(parseHex("#171717"), { r: 23, g: 23, b: 23 });
	assert.deepEqual(parseHex("171717"), { r: 23, g: 23, b: 23 });
	assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseHex("  #FFF  "), { r: 255, g: 255, b: 255 });
});

test("the defaults cover every field the renderer reads", () => {
	/*
	 * `applyAppearance` fills in from `DEFAULT_APPEARANCE` before touching anything, so this is what
	 * makes that merge sufficient rather than merely helpful: if a field it reads has no default,
	 * the merge produces `undefined` again and the guard above is the only thing left.
	 */
	for (const field of [
		"theme",
		"darkBackground",
		"lightBackground",
		"darkForeground",
		"lightForeground",
		"accent",
		"contrast",
	] as (keyof AppearanceSettings)[]) {
		assert.notEqual(DEFAULT_APPEARANCE[field], undefined, `DEFAULT_APPEARANCE 缺少 ${field}`);
	}
});

test("the defaults are themselves parseable colours", () => {
	// A default that does not parse would send every one of them through the hardcoded fallback
	// inside `applyAppearance`, quietly, and the theme would be near-black whatever it said.
	for (const field of ["darkBackground", "lightBackground", "darkForeground", "lightForeground"] as const) {
		assert.notEqual(parseHex(DEFAULT_APPEARANCE[field]), null, `${field} 应当是能解析的颜色`);
	}
});

test("a theme sent with nothing but a mode still resolves to a full one", () => {
	/*
	 * This is the shape that actually broke it: a settings object carrying `{ theme: "light" }` and
	 * nothing else, which is what a hand-edited settings.json or an older desktop sends.
	 */
	const partial = { theme: "light" } as AppearanceSettings;
	const merged = { ...DEFAULT_APPEARANCE, ...partial };
	assert.equal(merged.theme, "light", "指定的那一项要保留");
	assert.notEqual(parseHex(merged.lightBackground), null, "其余的从默认值补齐");
	assert.equal(typeof merged.contrast, "number", "对比度不能是 NaN 的来源");
});
