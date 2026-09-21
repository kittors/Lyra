/**
 * 一段日子的算术。
 *
 * 这些函数每一个都有一个说不清就会错的边界，而错了之后不会报错——只会画出一张看起来对、圈错了
 * 日子的日历，然后照着它删掉别的会话。所以边界在这里问清楚：月初补的那几格属于上个月、跨年的
 * 「上一个月」、以及人点了一个比开头更早的日子时到底想说什么。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMonths, dayKey, inRange, isInterior, monthGrid, monthStart, parseDay, pickDay, rangeLength } from "../src/ui/inputs/day-range.ts";

describe("dayKey / parseDay", () => {
	it("按本地日期写，不是 UTC", () => {
		// 23:00 的那次对话属于你过的那一天。换成 UTC 它会跑到第二天，和用量页的数字对不上。
		assert.equal(dayKey(new Date(2026, 8, 21, 23, 30)), "2026-09-21");
		assert.equal(dayKey(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
	});

	it("读回来还是本地当天的零点", () => {
		const back = parseDay("2026-09-21");
		assert.equal(back?.getFullYear(), 2026);
		assert.equal(back?.getMonth(), 8);
		assert.equal(back?.getDate(), 21);
		assert.equal(back?.getHours(), 0);
	});

	it("读不出来就是 null，不是 Invalid Date", () => {
		// 调用方把 null 当作「这一头没设」，而一个 Invalid Date 会一路往下传到比较里去。
		assert.equal(parseDay(null), null);
		assert.equal(parseDay(""), null);
		assert.equal(parseDay("不是日期"), null);
	});
});

describe("addMonths", () => {
	it("31 号往前一个月不会溢出到下个月", () => {
		// `setMonth` 在这里会给出 3 月 3 日：2 月没有 31 号。永远从 1 号起算就没有这个问题。
		assert.equal(dayKey(addMonths(new Date(2026, 2, 31), -1)), "2026-02-01");
	});

	it("跨年", () => {
		assert.equal(dayKey(addMonths(new Date(2026, 0, 15), -1)), "2025-12-01");
		assert.equal(dayKey(addMonths(new Date(2026, 11, 15), 1)), "2027-01-01");
	});
});

describe("monthGrid", () => {
	const grid = monthGrid(new Date(2026, 8, 1), 1);

	it("永远六行七列——行数会变的话，翻个月整张卡片就弹一下", () => {
		assert.equal(grid.length, 6);
		for (const week of grid) assert.equal(week.length, 7);
	});

	it("头尾补的是真实的上下月日期，不是空格", () => {
		// 2026-09-01 是周二，所以周一那格是 8 月 31 日——而「8/31 到 9/2」是人真会想选的一段。
		assert.equal(dayKey(grid[0][0]), "2026-08-31");
		assert.equal(dayKey(grid[0][1]), "2026-09-01");
		assert.equal(dayKey(grid[5][6]), "2026-10-11");
	});

	it("周日起头是另一种排法", () => {
		assert.equal(dayKey(monthGrid(new Date(2026, 8, 1), 0)[0][0]), "2026-08-30");
	});

	it("1 号正好是周一时，第一格就是 1 号，不空补一整周", () => {
		// 2026-06-01 是周一。补一整周会让六月凭空多出一行八月末尾。
		assert.equal(dayKey(monthGrid(new Date(2026, 5, 1), 1)[0][0]), "2026-06-01");
	});
});

describe("monthStart", () => {
	it("同一个月的任何一天都归到 1 号", () => {
		assert.equal(dayKey(monthStart(new Date(2026, 8, 21))), "2026-09-01");
	});
});

describe("inRange / isInterior", () => {
	const range = { from: "2026-09-01", to: "2026-09-10" };

	it("两头都含当天", () => {
		assert.equal(inRange("2026-09-01", range), true);
		assert.equal(inRange("2026-09-10", range), true);
		assert.equal(inRange("2026-08-31", range), false);
		assert.equal(inRange("2026-09-11", range), false);
	});

	it("空的那头不设限", () => {
		assert.equal(inRange("1999-01-01", { from: null, to: "2026-09-10" }), true);
		assert.equal(inRange("2099-01-01", { from: "2026-09-01", to: null }), true);
		assert.equal(inRange("2026-09-05", { from: null, to: null }), true);
	});

	it("两端不算中间——它们另画，中间那几格才连成一条", () => {
		assert.equal(isInterior("2026-09-01", range), false);
		assert.equal(isInterior("2026-09-05", range), true);
		assert.equal(isInterior("2026-09-10", range), false);
	});

	it("只选了一头的时候没有中间", () => {
		assert.equal(isInterior("2026-09-05", { from: "2026-09-01", to: null }), false);
	});
});

describe("pickDay", () => {
	it("第一下定开头", () => {
		assert.deepEqual(pickDay({ from: null, to: null }, "2026-09-05"), { from: "2026-09-05", to: null });
	});

	it("第二下定结尾", () => {
		assert.deepEqual(pickDay({ from: "2026-09-05", to: null }, "2026-09-10"), { from: "2026-09-05", to: "2026-09-10" });
	});

	it("点一个比开头更早的日子，是把开头往前挪，不是选出一段倒着的日子", () => {
		// 想把范围往前扩的时候，人做的动作就是点一个更早的日子。读成「结尾在开头前面」得到的是
		// 一段空范围，而且没有任何东西说明刚才发生了什么。
		assert.deepEqual(pickDay({ from: "2026-09-05", to: null }, "2026-09-01"), { from: "2026-09-01", to: null });
	});

	it("选完一段之后再点，是开始选新的一段", () => {
		assert.deepEqual(pickDay({ from: "2026-09-01", to: "2026-09-10" }, "2026-09-20"), { from: "2026-09-20", to: null });
	});

	it("同一天点两下是只有一天的那一段", () => {
		assert.deepEqual(pickDay({ from: "2026-09-05", to: null }, "2026-09-05"), { from: "2026-09-05", to: "2026-09-05" });
	});
});

describe("rangeLength", () => {
	it("两头都算", () => {
		assert.equal(rangeLength({ from: "2026-09-01", to: "2026-09-01" }), 1);
		assert.equal(rangeLength({ from: "2026-09-01", to: "2026-09-10" }), 10);
	});

	it("跨夏令时切换的那一天也还是整数天", () => {
		// 3 月那次切换让一天只有 23 小时，按毫秒硬除会得到 30.96 天。
		assert.equal(rangeLength({ from: "2026-03-01", to: "2026-03-31" }), 31);
	});

	it("有一头空着就数不出来", () => {
		assert.equal(rangeLength({ from: "2026-09-01", to: null }), null);
		assert.equal(rangeLength({ from: null, to: null }), null);
	});
});
