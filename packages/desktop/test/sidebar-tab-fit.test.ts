/**
 * The sidebar's Projects/Chats strip, fitted to the room its row leaves it.
 *
 * The widths are the ones a real window measures at the default type size: the words' own widths,
 * a 13px mark with its 6px gap, and 174px of room at the default sidebar width of 272 — the row's
 * 252 less the two buttons beside the strip, the gap to them, and the track's padding. Chinese fits
 * with room over; English is a few pixels short.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fitTabs } from "../src/features/sidebar/tab-fit.ts";

const MARK = 13 + 6;
const PAD = { full: 12, floor: 8 };
/** The room at the default sidebar width, and at the narrowest it can be dragged to. */
const DEFAULT_ROOM = 174;
const NARROWEST_ROOM = 142;

const WORDS = {
	"zh-CN": [28, 28],
	en: [54.88, 38.53],
} as const;

/** What the strip's tabs come to with this fit, less the track's own padding. */
const drawn = (labels: readonly number[], fit: { pad: number; words: boolean }) =>
	fit.words ? labels.reduce((sum, width) => sum + width + MARK + 2 * fit.pad, 0) : labels.length * (13 + 2 * fit.pad);

test("with room over, every tab keeps its full padding and its word", () => {
	assert.deepEqual(fitTabs(DEFAULT_ROOM, WORDS["zh-CN"], MARK, PAD), { pad: 12, words: true });
	// The narrowest drag was measured against Chinese, and still leaves it untouched.
	assert.deepEqual(fitTabs(NARROWEST_ROOM, WORDS["zh-CN"], MARK, PAD), { pad: 12, words: true });
});

test("English at the default width gives a little padding rather than its words", () => {
	const fit = fitTabs(DEFAULT_ROOM, WORDS.en, MARK, PAD);
	assert.equal(fit.words, true, "both words stay");
	assert.ok(fit.pad < PAD.full && fit.pad >= PAD.floor, `and the padding gives instead (${fit.pad})`);
	assert.ok(drawn(WORDS.en, fit) <= DEFAULT_ROOM, `within the room (${drawn(WORDS.en, fit)} of ${DEFAULT_ROOM})`);
	assert.ok(DEFAULT_ROOM - drawn(WORDS.en, fit) < 2, "and using nearly all of it, so the strip keeps its width");
});

test("at the narrowest drag everything but Chinese is marks alone, and the marks still fit", () => {
	for (const locale of ["en"] as const) {
		const fit = fitTabs(NARROWEST_ROOM, WORDS[locale], MARK, PAD);
		assert.equal(fit.words, false, locale);
		assert.ok(drawn(WORDS[locale], fit) <= NARROWEST_ROOM, locale);
	}
});

test("padding exactly at the floor still keeps the words", () => {
	const labels = [40, 30];
	const room = 40 + 30 + 2 * MARK + 4 * PAD.floor;
	assert.deepEqual(fitTabs(room, labels, MARK, PAD), { pad: PAD.floor, words: true });
	assert.equal(fitTabs(room - 0.5, labels, MARK, PAD).words, false, "and half a pixel less does not");
});

test("the padding is rounded down, so the words never come out wider than the room", () => {
	for (let room = 120; room <= 260; room += 0.37) {
		for (const labels of Object.values(WORDS)) {
			const fit = fitTabs(room, labels, MARK, PAD);
			if (fit.words) assert.ok(drawn(labels, fit) <= room + 1e-9, `${labels.join("+")} in ${room}: ${drawn(labels, fit)}`);
		}
	}
});
