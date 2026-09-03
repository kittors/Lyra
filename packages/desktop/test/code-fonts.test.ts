/**
 * The code font menu: that every preset is a usable stack, and that a stored value maps back to
 * the entry it came from.
 *
 * The setting has always been a CSS font stack and has to stay one — the first choice may not be
 * installed and something must catch that. What the menu removes is having to type one by hand.
 * These hold the two things that would break it quietly: a preset that is not a valid stack, and a
 * round trip that fails to recognise its own value so the menu shows 「自定义」 for a font the user
 * picked from the list.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_FONTS, matchCodeFont } from "../src/components/settings/code-fonts.ts";

test("every preset ends in a generic family", () => {
	for (const font of CODE_FONTS) {
		assert.match(
			font.stack,
			/monospace$/,
			`${font.label} 的字体栈最后必须落到 monospace——装不上时得有退路`,
		);
	}
});

test("every preset leads with the face it is named after", () => {
	for (const font of CODE_FONTS) {
		const first = font.stack.split(",")[0]!.trim().replace(/^"|"$/g, "");
		assert.equal(first, font.family, `${font.label} 的首选族要和菜单显示的一致`);
	}
});

test("a stored stack maps back to the entry it came from", () => {
	for (const font of CODE_FONTS) {
		assert.equal(matchCodeFont(font.stack)?.label, font.label);
	}
	// Whitespace from a hand-edited settings file should not lose the match.
	assert.equal(matchCodeFont(`  ${CODE_FONTS[0]!.stack}  `)?.label, CODE_FONTS[0]!.label);
});

test("a hand-written stack is reported as custom rather than mis-matched", () => {
	assert.equal(matchCodeFont('"Comic Mono", monospace'), null);
});

test("names are unique, or the menu would have two rows that look the same", () => {
	const labels = CODE_FONTS.map((f) => f.label);
	assert.equal(new Set(labels).size, labels.length);
});

/*
 * The app's own default must never be labelled missing.
 *
 * `document.fonts.check` answers for faces the page has used, so a bundled `@font-face` that
 * nothing has rendered yet reports as absent — and the menu said 「JetBrains Mono（未安装）」 about
 * the font it was rendering with at that moment.
 */
test("the bundled face is treated as present without asking the browser", async () => {
	const { CODE_FONTS: fonts, fontAvailable } = await import("../src/components/settings/code-fonts.ts");
	const bundled = fonts.find((f) => f.bundled);
	assert.ok(bundled, "至少要有一个随应用打包的字体");
	// No `document` in this runtime at all; a check that reached for one would throw.
	assert.equal(fontAvailable(bundled!), true);
});

/*
 * The faces the app ships with, which the menu must never mark as missing.
 *
 * Four now rather than one: JetBrains Mono is the default, and Fira Code, Source Code Pro and IBM
 * Plex Mono are bundled because they are the ones asked for by name often enough to be worth the
 * 400KB. Everything else in the list is offered on the chance you have it, and labelled when you
 * do not.
 */
test("the bundled set is what the stylesheet actually ships", async () => {
	const { readFile } = await import("node:fs/promises");
	const { CODE_FONTS: fonts } = await import("../src/components/settings/code-fonts.ts");
	// `styles/fonts.css`, not `styles.css`: the stylesheet was split by subject and the `@font-face`
	// rules went with the faces. The entry point is imports now, and matching against it would pass
	// vacuously — the regex would find nothing and the assertion would be about the wrong file.
	const css = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");

	for (const font of fonts.filter((f) => f.bundled)) {
		assert.match(
			css,
			new RegExp(`font-family:\\s*"${font.family}"`),
			`${font.label} 标了 bundled，样式表里就必须有对应的 @font-face——否则菜单说它在，实际却回退到别的字体`,
		);
	}
});
