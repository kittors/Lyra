/**
 * Usage, by day, as a grid.
 *
 * The page used to answer "what have I spent" with a list of the twelve heaviest conversations,
 * which is a different question and a worse one: it says which single sessions were expensive and
 * nothing at all about when the work happened, whether it is speeding up, or which weeks were quiet.
 * A calendar of days answers all three at a glance and the list answered none of them.
 *
 * The arithmetic lives here, away from the drawing, because "which cell is today" and "where does
 * the first column start" are the two things that go wrong and neither is visible in a screenshot —
 * a grid that is off by one day looks exactly like a grid that is right.
 */

/** A day's total, keyed `YYYY-MM-DD` in local time. */
export interface DayUsage {
	key: string;
	date: Date;
	sessions: number;
	messages: number;
	tokens: number;
	cost: number;
}

/** What the caller knows about one day, before it is placed in the grid. */
export interface DayTotals {
	day: string;
	sessions: number;
	messages: number;
	tokens: number;
	cost: number;
}

/** Local date key. Deliberately not ISO/UTC: a session at 23:00 belongs to the day you had it. */
export function dayKey(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The last `weeks` weeks as columns of seven days, oldest first, ending on the week containing
 * `now`.
 *
 * Columns start on Monday because the weeks people talk about start on Monday; the trailing column
 * is padded to the end of the current week so the grid is a rectangle rather than a staircase.
 * Padding days are real days in the future and carry zeroes — they are drawn faintly rather than
 * left as holes, which would make the last column look like missing data.
 *
 * Takes days that are already totalled, rather than sessions. It used to bin conversations by
 * `updatedAt`, which put every token of a three-day refactor on the third day; the totals now
 * arrive from the log scan, where a turn belongs to the day it happened.
 */
export function heatmapWeeks(totalled: DayTotals[], now: Date, weeks: number): DayUsage[][] {
	const totals = new Map<string, DayUsage>();
	for (const each of totalled) {
		const [y, m, d] = each.day.split("-").map(Number);
		if (!y || !m || !d) continue;
		totals.set(each.day, {
			key: each.day,
			date: new Date(y, m - 1, d),
			sessions: each.sessions,
			messages: each.messages,
			tokens: each.tokens,
			cost: each.cost,
		});
	}

	// Monday of the current week, then back `weeks - 1` weeks for the first column.
	const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
	const start = new Date(monday);
	start.setDate(start.getDate() - (weeks - 1) * 7);

	const grid: DayUsage[][] = [];
	for (let w = 0; w < weeks; w++) {
		const column: DayUsage[] = [];
		for (let d = 0; d < 7; d++) {
			const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
			const key = dayKey(date);
			column.push(totals.get(key) ?? { key, date, sessions: 0, messages: 0, tokens: 0, cost: 0 });
		}
		grid.push(column);
	}
	return grid;
}

/**
 * Which of five shades a day gets, 0 for nothing.
 *
 * Cut against the busiest day rather than a fixed number of tokens, because there is no absolute
 * scale that suits both an afternoon of questions and a week of refactoring. Ranked rather than
 * linear: one enormous day would otherwise flatten every other day to the palest shade and the grid
 * would say "you worked once".
 */
export function heatLevel(value: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
	if (value <= 0 || busiest <= 0) return 0;
	const share = value / busiest;
	if (share > 0.6) return 4;
	if (share > 0.3) return 3;
	if (share > 0.1) return 2;
	return 1;
}

/** Columns between labels; below this two of them overlap. */
const MIN_LABEL_GAP = 4;

/** The month labels for a row of columns, one per column that begins a new month. */
export function monthLabels(grid: DayUsage[][]): { column: number; text: string }[] {
	const labels: { column: number; text: string }[] = [];
	let seen = -1;
	let lastAt = -99;
	grid.forEach((column, index) => {
		const first = column[0];
		if (!first) return;
		const month = first.date.getMonth();
		if (month === seen || index >= grid.length - 1) return;
		/*
		 * Far enough from the previous label to be readable.
		 *
		 * A month can begin two columns after the last one did — a short February, a month starting
		 * on a Sunday — and two labels three characters wide cannot both fit in 28px. The one that
		 * would collide is dropped rather than drawn on top, which is what produced "2月3月".
		 */
		if (index - lastAt < MIN_LABEL_GAP) {
			seen = month;
			return;
		}
		labels.push({ column: index, text: `${month + 1}月` });
		seen = month;
		lastAt = index;
	});
	return labels;
}
