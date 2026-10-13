/**
 * 画廊的排版：每行等高、整行正好撑满，最后一行不硬撑；按本地日期分组。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { aspectOf, byDay, justify } from "../src/lib/gallery-layout.ts";

const near = (actual: number, expected: number, label = "") => assert.ok(Math.abs(actual - expected) < 0.01, `${label} ${actual} ≠ ${expected}`);

test("满的一行恰好撑满列宽，图片保持自己的比例", () => {
	const rows = justify([1, 16 / 9, 1, 0.75, 1, 1], 900, { target: 220, gap: 8 });
	for (const row of rows.slice(0, -1)) {
		const used = row.tiles.reduce((sum, tile) => sum + tile.width, 0) + 8 * (row.tiles.length - 1);
		near(used, 900, "整行宽度");
		for (const tile of row.tiles) near(tile.height, row.height, "同一行等高");
	}
	const wide = rows.flatMap((row) => row.tiles).find((tile) => tile.index === 1);
	near((wide?.width ?? 0) / (wide?.height ?? 1), 16 / 9, "宽图不裁切");
});

test("行高贴近目标：多放一张更接近就放，否则留到下一行", () => {
	const rows = justify([1, 1, 1, 1, 1, 1, 1, 1], 1000, { target: 240, gap: 0 });
	// 四张方图 = 250 高，五张 = 200 高；250 离 240 更近，所以一行四张。
	assert.deepEqual(
		rows.map((row) => row.tiles.length),
		[4, 4],
	);
	near(rows[0].height, 250);
});

test("最后一行不拉伸：两张方图留在目标高度，靠左", () => {
	const rows = justify([1, 1, 1, 1, 1, 1], 1000, { target: 240, gap: 0 });
	const last = rows.at(-1);
	assert.equal(last?.tiles.length, 2);
	near(last?.height ?? 0, 240);
});

test("一张极宽的图单独成行时撑满，不会比目标还高", () => {
	const rows = justify([4, 1], 800, { target: 240, gap: 8 });
	assert.equal(rows[0].tiles.length, 1);
	near(rows[0].height, 200);
	assert.ok(rows.every((row) => row.height <= 240.01));
});

test("没量到尺寸的按方图算；极端比例收在 1:4 到 4:1 之间", () => {
	assert.equal(aspectOf({}), 1);
	assert.equal(aspectOf({ width: 1024, height: 0 }), 1);
	assert.equal(aspectOf({ width: 5504, height: 3072 }), 5504 / 3072);
	assert.equal(aspectOf({ width: 4000, height: 100 }), 4);
	assert.equal(aspectOf({ width: 10, height: 4000 }), 0.25);
});

test("宽度为零时不排（窗口还没量出来）", () => {
	assert.deepEqual(justify([1, 1], 0, { target: 200, gap: 8 }), []);
});

test("按本地日期分组：新的一天在前，同一天里保持给定顺序", () => {
	const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();
	const items = [
		{ id: "a", at: at(2026, 10, 13, 9) },
		{ id: "b", at: at(2026, 10, 12, 23) },
		{ id: "c", at: at(2026, 10, 13, 1) },
		{ id: "d", at: at(2026, 10, 11, 0) },
	];
	const sections = byDay(items, (item) => item.at);
	assert.deepEqual(
		sections.map((section) => [new Date(section.day).getDate(), section.items.map((item) => item.id)]),
		[
			[13, ["a", "c"]],
			[12, ["b"]],
			[11, ["d"]],
		],
	);
});
