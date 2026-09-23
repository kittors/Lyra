/**
 * The default UI face is the machine's Chinese UI family, so Han and Latin share one face.
 *
 * Settings store a CSS stack, not a menu id. Inter and IBM Plex stay bundled for anyone
 * who types those stacks; they must not be the first-frame sans any more.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("default sans is PingFang-first, with Inter and Plex still declared", async () => {
	const fonts = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	assert.match(fonts, /font-family:\s*"IBM Plex Sans Variable"/);
	assert.match(fonts, /font-family:\s*"Inter Variable"/);
	assert.match(tokens, /--font-sans:[^;]*"Lyra Punct"/);
	assert.match(tokens, /--font-sans:[^;]*"PingFang SC"/);
	assert.doesNotMatch(tokens, /--font-sans:[^;]*"IBM Plex Sans Variable"/);
	assert.doesNotMatch(tokens, /--font-sans:[^;]*"Inter Variable"/);
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

/** The families of a CSS stack, in order, unquoted. */
const families = (stack: string) => stack.split(",").map((family) => family.trim().replace(/^"|"$/g, ""));

/**
 * Where each face sits in a stack, asserting the Windows and Linux ones are there, and that
 * PingFang — a Mac's face for both scripts — still comes before all of them.
 */
function assertPlatformOrder(stack: string, what: string) {
	const order = families(stack);
	const at = (family: string) => order.indexOf(family);
	for (const family of ["PingFang SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Noto Sans", "Noto Sans CJK SC"]) {
		assert.ok(at(family) >= 0, `${what} has no ${family}: ${stack}`);
	}
	// A Mac is unchanged: PingFang still draws Latin and Han before anything added here is asked.
	assert.ok(at("PingFang SC") < at("Segoe UI Variable Text"), `${what}: PingFang must stay first`);
	// Windows: Segoe has the 600 that YaHei (300/400/700) lacks, and YaHei's Latin is Segoe's.
	assert.ok(at("Segoe UI Variable Text") < at("Segoe UI") && at("Segoe UI") < at("Microsoft YaHei UI"), `${what}: Segoe before YaHei`);
	// Linux: ahead of the generic, which lands on DejaVu or Liberation (400/700 only).
	assert.ok(at("Noto Sans") < at("sans-serif") && at("Noto Sans CJK SC") < at("sans-serif"), `${what}: Noto before sans-serif`);
}

test("Windows and Linux draw with faces that have a weight between regular and bold", async () => {
	/*
	 * The base is 500 and the two steps above it 600 and 700. YaHei UI has 300, 400 and 700, and
	 * DejaVu and Liberation 400 and 700, so on those machines the three steps landed on two weights
	 * and the hierarchy between body, label and heading collapsed.
	 */
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	const sans = tokens.match(/--font-sans:([^;]+);/);
	assert.ok(sans);
	assertPlatformOrder(sans[1].replace(/var\([^)]*\)\)?,?/g, ""), "--font-sans");

	// The stored default lives in core and cannot change there, so it is widened where it is drawn.
	const { drawnUiFont, FACTORY_APPEARANCE } = await import("../src/features/settings/appearance-defaults.ts");
	assertPlatformOrder(drawnUiFont(FACTORY_APPEARANCE.uiFont), "the default UI font as drawn");
	// A stack somebody typed is theirs, exactly as typed.
	assert.equal(drawnUiFont('"Inter Variable", sans-serif'), '"Inter Variable", sans-serif');
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
