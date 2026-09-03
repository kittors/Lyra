/**
 * Every language in the picker, actually highlighted.
 *
 * The failure this guards against is silent by construction: a grammar that does not load, or one
 * whose tags nothing in the mapping claims, still renders the code. It just renders all of it in
 * one colour — which looks like a theme choice rather than a bug, and is exactly how `nginx`,
 * `yaml` and every other stream-mode grammar went unnoticed for months.
 *
 * So the measurement is per language and it is about *distinctions*: how many kinds of token the
 * sample resolves to, and how much of it nothing claimed at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGES } from "../src/features/settings/format-catalog.ts";
import { highlightPieces } from "../src/features/settings/preview-highlight.ts";

/** Everything measured once, because parsing fifty grammars is the slow part. */
const measured = await Promise.all(
	LANGUAGES.map(async (entry) => {
		const pieces = await highlightPieces(entry.sample, entry.key);
		const kinds = new Set(pieces.map((p) => p.token).filter(Boolean));
		const printable = entry.sample.replace(/\s/g, "").length;
		const unclaimed = pieces.filter((p) => !p.token).reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
		return { entry, kinds, share: unclaimed / printable, pieces };
	}),
);

test("every sample resolves to at least three kinds of token", () => {
	// Three is the floor for "the grammar ran": a keyword, a value and something else. Two means
	// it found strings and gave up; one means it did not load.
	const thin = measured
		.filter((m) => m.kinds.size < 3)
		.map((m) => `${m.entry.label}: ${m.kinds.size} 种（${[...m.kinds].join("、") || "全无"}）`);
	assert.deepEqual(thin, []);
});

test("no sample is mostly unclaimed text", () => {
	/*
	 * Seventy per cent, because some languages legitimately are mostly literals.
	 *
	 * A Dockerfile is a list of directives followed by paths and shell commands; `FROM` is a
	 * keyword and `node:24-alpine` is not anything, in this or any other editor. Same for
	 * `.gitignore` and `.env`. The check is here to catch a grammar that failed to load — which
	 * shows up as ninety-plus per cent, the way `.patch` did before `inserted` and `deleted` were
	 * mapped — not to demand colour where there is no syntax.
	 */
	const flat = measured.filter((m) => m.share > 0.7).map((m) => `${m.entry.label}: ${Math.round(m.share * 100)}% 未着色`);
	assert.deepEqual(flat, []);
});

test("every sample round-trips — no text is dropped on the way through", () => {
	// The gaps `highlightTree` skips have to be filled back in. Losing them deletes whitespace and
	// punctuation from what the preview shows.
	for (const { entry, pieces } of measured) {
		assert.equal(pieces.map((p) => p.text).join(""), entry.sample, `${entry.label} 的内容被改变了`);
	}
});

test("no run is labelled with a name a theme cannot colour", () => {
	/*
	 * `tagHighlighter` joins every matching rule's class with a space, so a Markdown heading
	 * arrives as "function comment" — a key no theme has, which silently renders as plain text.
	 * Every label here has to be one of the eleven a theme declares.
	 */
	const known = new Set([
		"keyword", "string", "number", "comment", "function", "type", "variable", "operator", "punctuation", "tag", "attribute",
	]);
	const strays = new Set<string>();
	for (const { entry, pieces } of measured) {
		for (const piece of pieces) {
			if (piece.token && !known.has(piece.token)) strays.add(`${entry.label}: ${piece.token}`);
		}
	}
	assert.deepEqual([...strays], []);
});

test("comments are found in every language whose sample has one", () => {
	// The single most useful thing highlighting does to a config file, and the first thing to go
	// when a grammar half-loads.
	const missing = measured
		.filter((m) => /(^|\n)\s*(#|\/\/|--|;|%|\/\*|<!--)/.test(m.entry.sample))
		.filter((m) => !m.kinds.has("comment"))
		.map((m) => m.entry.label);
	assert.deepEqual(missing, []);
});
