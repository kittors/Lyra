/**
 * The usage calendar.
 *
 * The claims: every day lands in the column and row it belongs to, a session at either end of the
 * day counts on that day, and the shading ranks days against each other rather than against a
 * number nobody chose.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, heatLevel, heatmapWeeks, monthLabels } from "../src/features/settings/usage-heatmap.ts";

/**
 * One already-totalled day, as the log scan hands them over.
 *
 * The grid stopped binning sessions by `updatedAt` — that put every token of a three-day refactor
 * on the third day — so what arrives here is a day, not a conversation.
 */
const day = (key: string, sessions = 1, tokens = 0, cost = 0, messages = sessions * 2) => ({
	day: key,
	sessions,
	messages,
	tokens,
	cost,
});

test("the grid is weeks of seven, oldest first, ending on this week", () => {
	// A Thursday.
	const now = new Date(2026, 7, 13, 15, 0);
	const grid = heatmapWeeks([], now, 4);

	assert.equal(grid.length, 4);
	for (const column of grid) assert.equal(column.length, 7, "every column is a full week");

	// Columns start on Monday.
	for (const column of grid) assert.equal(column[0]?.date.getDay(), 1, `column starts on ${column[0]?.date}`);

	// Today is in the last column.
	const last = grid[grid.length - 1]!;
	assert.ok(last.some((d) => d.key === dayKey(now)), "today is in the final week");
});

test("a day lands on its own square, and adjacent days do not bleed into each other", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([day("2026-08-12"), day("2026-08-13", 2)], now, 2);
	const days = grid.flat();

	assert.equal(days.find((d) => d.key === "2026-08-12")?.sessions, 1);
	assert.equal(days.find((d) => d.key === "2026-08-13")?.sessions, 2);
});

test("a day carries its totals through to the square", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([day("2026-08-11", 2, 500, 2, 9)], now, 2);
	const cell = grid.flat().find((d) => d.key === "2026-08-11");
	assert.equal(cell?.sessions, 2);
	assert.equal(cell?.tokens, 500);
	assert.equal(cell?.messages, 9);
	assert.equal(cell?.cost, 2);
});

test("days with nothing on them are present and empty, not missing", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([], now, 3);
	const days = grid.flat();
	assert.equal(days.length, 21);
	assert.ok(days.every((d) => d.sessions === 0 && d.tokens === 0), "a rectangle of zeroes, not holes");
});

test("days older than the window are simply not shown", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([day("2020-01-01", 1, 999)], now, 2);
	assert.ok(grid.flat().every((d) => d.tokens === 0));
});

test("a malformed day key is dropped rather than placed on the epoch", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([{ day: "not-a-date", sessions: 3, messages: 3, tokens: 5, cost: 0 }], now, 2);
	assert.ok(grid.flat().every((d) => d.sessions === 0));
});

test("shading ranks days against the busiest, so one huge day does not flatten the rest", () => {
	assert.equal(heatLevel(0, 1000), 0, "nothing is nothing");
	assert.equal(heatLevel(1000, 1000), 4, "the busiest day is the darkest");
	assert.equal(heatLevel(500, 1000), 3);
	assert.equal(heatLevel(200, 1000), 2);
	assert.equal(heatLevel(50, 1000), 1, "a quiet day is still visible");
	// And with no data at all nothing is shaded, rather than everything.
	assert.equal(heatLevel(0, 0), 0);
	assert.equal(heatLevel(10, 0), 0);
});

test("month labels appear once per month and never on the last column", () => {
	const now = new Date(2026, 7, 13, 12, 0);
	const grid = heatmapWeeks([], now, 12);
	const labels = monthLabels(grid);

	assert.ok(labels.length >= 2, `expected a few months across 12 weeks, got ${labels.length}`);
	const columns = labels.map((l) => l.column);
	assert.deepEqual(columns, [...new Set(columns)], "one label per column");
	assert.ok(
		labels.every((l) => l.column < grid.length - 1),
		"nothing on the final column, where it would collide with the edge",
	);
	assert.deepEqual([...new Set(labels.map((l) => l.text))], labels.map((l) => l.text), "each month once");
});
