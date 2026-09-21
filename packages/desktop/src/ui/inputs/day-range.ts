/**
 * 一段日子，以及画出一个月需要的那点算术。
 *
 * 全部按**本地**日期算，和用量页、扫描器用的是同一个口径（`dayKey`）。这不是随手选的：一次
 * 23:00 的对话属于你过的那一天，换成 UTC 它会跑到第二天去，于是日历上圈出来的那一段和页面上
 * 的数字对不上——而这两样东西正是给同一个人看的。
 *
 * 纯函数单独放，因为这里每一条都有一个说不清就会错的边界：月初那几格属于上个月、选反了的两头、
 * 跨年的「上一个月」。这些用几行断言问清楚，比在一个画了四十二个格子的组件里翻出来便宜得多。
 */

/** 一段日子，两头都含当天。null 表示那一头不设限。 */
export interface DayRange {
	from: string | null;
	to: string | null;
}

/** 本地日期键 `YYYY-MM-DD`。刻意不是 ISO/UTC——见文件开头。 */
export function dayKey(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** 把日期键读回本地当天的零点。读不出来给 null，调用方当作「没设」。 */
export function parseDay(key: string | null | undefined): Date | null {
	if (!key) return null;
	const [year, month, day] = key.split("-").map(Number);
	if (!year || !month || !day) return null;
	const date = new Date(year, month - 1, day);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** 同一个月里的第一天。用来做月历的锚，也用来比较「是不是同一个月」。 */
export function monthStart(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * 往前或往后几个月。
 *
 * 走 `new Date(年, 月 + n, 1)` 而不是 `setMonth`：后者在当前是 31 号时会溢出到下个月（3 月 31
 * 日往前一个月得到 3 月 3 日），而这里永远从 1 号起算，没有这个问题。跨年也由它自己处理。
 */
export function addMonths(date: Date, n: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

/**
 * 画一个月要的六行七列。
 *
 * 固定六行，哪怕这个月五行就排得下——行数随月份变，面板的高度就会跟着跳，翻个月整张卡片弹一下。
 * 头尾补的是真实的上下月日期，不是空格：它们照样可选，因为「8 月 31 日到 9 月 2 日」是一段人会
 * 真的想选的日子，而它横跨两个月。
 *
 * `weekStart` 是一周从星期几开始（0 = 周日）。中文习惯从周一起，所以调用处传 1。
 */
export function monthGrid(month: Date, weekStart = 1): Date[][] {
	const first = monthStart(month);
	const lead = (first.getDay() - weekStart + 7) % 7;
	const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
	return Array.from({ length: 6 }, (_, row) =>
		Array.from({ length: 7 }, (_, column) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + row * 7 + column)),
	);
}

/** 这一天落在这段里吗。两头都含当天，空的那头不设限。 */
export function inRange(day: string, range: DayRange): boolean {
	if (range.from && day < range.from) return false;
	if (range.to && day > range.to) return false;
	return true;
}

/** 两头都有，而且这一天严格在中间——中间那几格是连起来的一条，两端另画。 */
export function isInterior(day: string, range: DayRange): boolean {
	return Boolean(range.from && range.to && day > range.from && day < range.to);
}

/**
 * 点了一天之后，这段日子变成什么。
 *
 * 三种情形，而第三种是大多数日历弄拧的那一种：
 *
 *   还没开头，或者上一段已经选完 → 这一天是新的开头，结尾清空（开始重新选一段）
 *   有开头没结尾，点的日子不比开头早 → 这一天是结尾，一段选完
 *   有开头没结尾，点的日子比开头早 → **改开头**，不是选出一段倒着的日子
 *
 * 最后那条是关键：人想把范围往前扩的时候，做的动作就是点一个更早的日子。把它读成「结尾在开头
 * 前面」得到的是一段空范围，而且没有任何提示说刚才发生了什么。
 */
export function pickDay(range: DayRange, day: string): DayRange {
	if (!range.from || range.to) return { from: day, to: null };
	if (day < range.from) return { from: day, to: null };
	return { from: range.from, to: day };
}

/** 这段日子有几天，两头都算。哪一头空着都数不出来。 */
export function rangeLength(range: DayRange): number | null {
	const from = parseDay(range.from);
	const to = parseDay(range.to);
	if (!from || !to) return null;
	return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}
