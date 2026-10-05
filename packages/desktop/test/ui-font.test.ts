/**
 * The default UI face is the platform's own stack, behind the two CJK aliases.
 *
 * Latin is SF Pro on a Mac and Segoe UI on Windows, as ZCode draws it; Han and CJK punctuation are
 * claimed first by `Lyra CJK` and `Lyra Punct`, which carry the per-locale and per-platform faces.
 * Settings store a CSS stack, not a menu id. Inter and IBM Plex stay bundled for anyone who picks
 * them; they must not be the first-frame sans.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/** The families of a CSS stack, in order, unquoted, with the `var(--alias, "Fallback")` heads kept as their fallback name. */
const families = (stack: string) =>
	stack
		.replace(/var\(--[a-z-]+,\s*("[^"]+")\)/g, "$1")
		.split(",")
		.map((family) => family.trim().replace(/^"|"$/g, ""));

test("default sans is the system stack behind the CJK aliases, with Inter and Plex still declared", async () => {
	const fonts = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	assert.match(fonts, /font-family:\s*"IBM Plex Sans Variable"/);
	assert.match(fonts, /font-family:\s*"Inter Variable"/);
	const sans = tokens.match(/--font-sans:([^;]+);/);
	assert.ok(sans);
	const order = families(sans[1]);
	// Punctuation, then Han, then the platform: a period drawn by SF Pro is the mid-height circle.
	assert.deepEqual(order.slice(0, 4), ["Lyra Punct", "Lyra CJK", "ui-sans-serif", "system-ui"]);
	assert.ok(!order.includes("IBM Plex Sans Variable") && !order.includes("Inter Variable"));
	assert.match(fonts, /font-weight:\s*400/);
	assert.match(fonts, /PingFangSC-Regular/);
	assert.match(fonts, /PingFangSC-Medium/);
	assert.match(fonts, /PingFangSC-Semibold/);
	assert.match(fonts, /font-family:\s*"Lyra Punct"/);
	assert.match(fonts, /font-family:\s*"Lyra Punct TW"/);
	assert.match(fonts, /STSongti-SC-Regular/);
	assert.doesNotMatch(fonts, /font-family:\s*"Lyra CJK"[\s\S]*?font-weight:\s*100 900/);
	const cjkFace = fonts.match(/font-family:\s*"Lyra CJK";[\s\S]*?unicode-range:\s*([^;]+);/);
	assert.ok(cjkFace, "Lyra CJK declares a unicode-range");
	assert.doesNotMatch(cjkFace[1], /U\+3000-303F/, "Han face must not claim CJK punctuation");
	assert.match(fonts, /font-family:\s*"Lyra Punct";[\s\S]*?U\+3000-303F/);
});

test("the stored default is the same system stack, and code is the system monospace with a Han face before the generic", async () => {
	const { FACTORY_APPEARANCE } = await import("../src/features/settings/appearance-defaults.ts");
	assert.deepEqual(families(FACTORY_APPEARANCE.uiFont).slice(0, 2), ["ui-sans-serif", "system-ui"]);
	const code = families(FACTORY_APPEARANCE.codeFont);
	assert.equal(code[0], "ui-monospace");
	// Consolas has no Han: without a Chinese face ahead of `monospace`, Windows draws it in SimSun.
	assert.ok(code.indexOf("Microsoft YaHei UI") >= 0 && code.indexOf("Microsoft YaHei UI") < code.indexOf("monospace"));
	assert.ok(!code.includes("JetBrains Mono Variable"), "JetBrains Mono is bundled, not the factory face");
});

test("Linux's Chinese faces are found under the names distributions install them by", async () => {
	/*
	 * `local("Noto Sans SC")` is the Google Fonts build's name. Debian, Ubuntu, Fedora and Arch ship
	 * Noto Sans CJK, whose faces are named `Noto Sans CJK SC …` / `NotoSansCJKsc-…` — so every Lyra
	 * CJK face missed on Linux and Han fell to whatever the fallback chain found, at one weight.
	 */
	const fonts = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");
	const faces = [...fonts.matchAll(/@font-face\s*\{([^}]*font-family:\s*"Lyra CJK";[^}]*)\}/g)].map((match) => match[1]);
	assert.equal(faces.length, 4, "one Lyra CJK face per weight");
	for (const face of faces) {
		const weight = face.match(/font-weight:\s*(\d+)/)?.[1];
		assert.match(face, /local\("NotoSansCJKsc-[A-Za-z]+"\)/, `Lyra CJK ${weight} has no Noto Sans CJK SC source`);
	}
	const punct = fonts.match(/@font-face\s*\{([^}]*font-family:\s*"Lyra Punct";[^}]*)\}/);
	assert.ok(punct);
	assert.match(punct[1], /local\("NotoSansCJKsc-Regular"\)/);
});
