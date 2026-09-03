/**
 * Every code theme, checked for the two ways a palette can be broken.
 *
 * This exists because 「Java 的高亮有问题」 turned out not to be a grammar bug at all: Java was
 * tokenising perfectly, and the theme in force — Min Light — had `keyword` and `variable` set to
 * the identical hex. Every keyword in every language rendered as body text, in that theme, and no
 * amount of testing the parser would ever have found it.
 *
 * So the palettes are tested as palettes:
 *
 *   - the seven load-bearing token colours have to be *distinguishable* from each other, measured
 *     as CIE Lab ΔE rather than as a channel difference. Channel distance calls a saturated
 *     mauve and a near-white "the same" because their red components match, which is how an
 *     earlier version of this cleared Catppuccin and flagged nothing useful.
 *   - a comment has to be *readable* on its own background. Below about 2.8:1 it stops being
 *     quiet and starts being invisible, which was Nord at 1.7.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DARK_CODE_THEMES, LIGHT_CODE_THEMES, type CodeThemeSpec } from "../src/lib/code/themes.ts";

const CORE = ["keyword", "string", "number", "comment", "function", "type", "variable"] as const;

/**
 * ΔE ≥ 9, not 12.
 *
 * Nord sets `function` to nord8 and `type` to nord7 — two adjacent blues that are the theme's own
 * identity, at ΔE 10. Demanding more would mean rewriting Nord into something that is not Nord.
 * Nine still fails anything actually identical, which is what the bug was.
 */
const MIN_DELTA = 9;
const MIN_COMMENT_CONTRAST = 2.8;

function channels(hex: string): number[] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function lab(hex: string): number[] {
	const [r, g, b] = channels(hex).map(linear);
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
	const [p, q] = [lab(a), lab(b)];
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function contrast(a: string, b: string): number {
	const luminance = (hex: string) => {
		const [r, g, b] = channels(hex).map(linear);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

const ALL: CodeThemeSpec[] = [...LIGHT_CODE_THEMES, ...DARK_CODE_THEMES];

test("every theme's core token colours are told apart from each other", () => {
	const broken: string[] = [];
	for (const theme of ALL) {
		for (let i = 0; i < CORE.length; i++) {
			for (let j = i + 1; j < CORE.length; j++) {
				const delta = deltaE(theme.tokens[CORE[i]], theme.tokens[CORE[j]]);
				if (delta < MIN_DELTA) {
					broken.push(`${theme.label}: ${CORE[i]} 与 ${CORE[j]} 太接近（ΔE ${delta.toFixed(0)}）`);
				}
			}
		}
	}
	assert.deepEqual(broken, [], `\n${broken.join("\n")}`);
});

test("comments are readable on their own background", () => {
	const faint = ALL.map((theme) => [theme.label, contrast(theme.tokens.comment, theme.background)] as const).filter(
		([, ratio]) => ratio < MIN_COMMENT_CONTRAST,
	);
	assert.deepEqual(faint.map(([label, ratio]) => `${label}: ${ratio.toFixed(1)}:1`), []);
});

test("every token colour is readable at all, not just comments", () => {
	// 2:1 is the floor for anything meant to be read. Below it a colour is decoration.
	const invisible: string[] = [];
	for (const theme of ALL) {
		for (const name of CORE) {
			const ratio = contrast(theme.tokens[name], theme.background);
			if (ratio < 2) invisible.push(`${theme.label}.${name} = ${ratio.toFixed(1)}:1`);
		}
	}
	assert.deepEqual(invisible, []);
});

test("the default pair takes the app's surface rather than bringing its own", () => {
	// The whole point of `inherit`: a fresh install must look like Lyra, not like somebody's
	// yellow paper. See `--ly-code-bg` in `theme.ts`.
	const light = LIGHT_CODE_THEMES.find((t) => t.id === "lyra-light");
	const dark = DARK_CODE_THEMES.find((t) => t.id === "lyra-dark");
	assert.ok(light?.inherit, "lyra-light 应该继承应用的表面");
	assert.ok(dark?.inherit, "lyra-dark 应该继承应用的表面");
	// And nothing else should, or picking a theme would do nothing visible.
	const others = ALL.filter((t) => t.inherit && !t.id.startsWith("lyra-"));
	assert.deepEqual(others.map((t) => t.label), []);
});

test("every theme declares all eleven token colours as real hex values", () => {
	for (const theme of ALL) {
		for (const [name, value] of Object.entries(theme.tokens)) {
			assert.match(value, /^#[0-9a-f]{6}$/i, `${theme.label}.${name} = ${value}`);
		}
		assert.match(theme.background, /^#[0-9a-f]{6}$/i, `${theme.label}.background`);
		assert.match(theme.foreground, /^#[0-9a-f]{6}$/i, `${theme.label}.foreground`);
	}
});
