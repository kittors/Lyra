/**
 * What the trend chart's pointer does, without a chart to point at.
 *
 * The chart itself is a handful of `<polyline>`s and needs no help. What is easy to get wrong is
 * everything around the pointer: turning a screen coordinate into a day when the SVG is drawn in
 * its own 640-wide space and stretched to whatever the card is; keeping the bubble on screen when
 * the day being hovered is the last one and the card ends at the window's right edge.
 *
 * Both were wrong before, in the way that is invisible until someone tries it: the only hover
 * targets were five-pixel circles on the data points themselves, so the pointer had to land on a
 * line to the pixel, and pointing at the chart — which is what people do — did nothing at all.
 *
 * Kept here, apart from the component, because the arithmetic is the part worth testing and a test
 * for it should not have to mount React or measure a layout that a test DOM does not perform.
 */

import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import type { ProviderTrend } from "./usage-aggregate.ts";
import { formatCost } from "./usage-format.ts";

export type TrendMetric = "cost" | "tokens";

/**
 * The SVG's own coordinate space. Everything below is in these units until it reaches the screen.
 *
 * The width is fixed and the height is not. The chart shares a row with the spend list beside it,
 * and a grid row is as tall as its tallest cell — so the card had a band of empty below the plot
 * whose height was decided by how many providers were listed next to it. The height therefore
 * follows the box the chart is given, at whatever scale the width implies, which keeps one unit
 * worth the same number of pixels in both directions: no stretched labels, no thickened strokes.
 */
export const CHART = { width: 640, height: 212, left: 52, right: 12, top: 12, bottom: 28 } as const;

export const PLOT_WIDTH = CHART.width - CHART.left - CHART.right;
const PLOT_HEIGHT = CHART.height - CHART.top - CHART.bottom;

/** The viewBox height for a rendered box, in the same units as the fixed width. */
export function viewHeightFor(box: { width: number; height: number }): number {
	if (!(box.width > 0) || !(box.height > 0)) return CHART.height;
	return Math.round(Math.max(CHART.top + CHART.bottom + 80, (CHART.width * box.height) / box.width));
}

export function plotHeightFor(viewHeight: number): number {
	return viewHeight - CHART.top - CHART.bottom;
}

const COLORS = ["var(--color-accent)", "var(--color-violet)", "var(--color-ok)", "var(--color-info)"];

export function trendColor(index: number): string {
	return COLORS[index % COLORS.length];
}

/** Where day `index` sits along the x axis, in SVG units. A single day is drawn at the left edge. */
export function pointAtX(index: number, count: number): number {
	if (count <= 1) return CHART.left;
	return CHART.left + (index / (count - 1)) * PLOT_WIDTH;
}

export function pointAtY(value: number, maximum: number, plotHeight = PLOT_HEIGHT): number {
	return CHART.top + plotHeight - (value / Math.max(1, maximum)) * plotHeight;
}

/**
 * The day nearest the pointer, or `null` when there is nothing to point at.
 *
 * The whole plot answers, not just the marks on it: a pointer above the line, below it, or out in
 * the left gutter still means a day, and rounding to the closest one is what makes moving across
 * the chart feel continuous rather than like hunting for hotspots.
 *
 * `box` is the rendered SVG's rectangle. Its width divided by the viewBox width is the scale, and
 * a zero-width box means the element has not been laid out — a test DOM, a hidden tab — where the
 * honest answer is that there is no day under the pointer.
 */
export function hoverIndexAt(pointerX: number, box: { left: number; width: number }, count: number): number | null {
	if (count <= 0 || !(box.width > 0)) return null;
	if (count === 1) return 0;
	const scale = box.width / CHART.width;
	const inside = (pointerX - box.left) / scale;
	const share = (inside - CHART.left) / PLOT_WIDTH;
	const index = Math.round(share * (count - 1));
	return Math.min(count - 1, Math.max(0, index));
}

const GAP = 14;
const MARGIN = 8;

/**
 * Where the bubble goes: beside the crosshair, never over the pointer, never off screen.
 *
 * Beside rather than below, because the thing being read is a vertical line through the plot and a
 * bubble under the pointer covers the very marks it is describing. The preferred side is the right;
 * it flips to the left when the bubble would run past the window, which is the common case, since
 * the most recent day — the one people point at — is the rightmost.
 *
 * Vertically it follows the pointer, but only within `plot`. Free to follow, a reading taken near
 * the top of the chart rides up over the legend and the 费用/Token switch, and one taken near the
 * bottom hangs below the card: the bubble ends up covering the controls that are how you change
 * what it says. Held to the plot's own band it stays over the chart, where there is nothing to hide
 * but the chart it is describing. It is released again when it is taller than the plot, because a
 * bubble squeezed into a band shorter than itself has to lose an end.
 *
 * The viewport clamps are last and unconditional.
 */
export function chartTipPlacement(
	anchor: { x: number; y: number },
	tip: { width: number; height: number },
	viewport: { width: number; height: number },
	plot?: { top: number; bottom: number },
): { left: number; top: number } {
	const right = anchor.x + GAP;
	const left = anchor.x - GAP - tip.width;
	const fitsRight = right + tip.width <= viewport.width - MARGIN;
	const fitsLeft = left >= MARGIN;
	// When neither side fits, take the one with more room and let the clamp do the rest.
	const preferred = fitsRight ? right : fitsLeft ? left : anchor.x > viewport.width / 2 ? left : right;

	let top = anchor.y - tip.height / 2;
	if (plot && plot.bottom - plot.top >= tip.height) top = Math.max(plot.top, Math.min(top, plot.bottom - tip.height));
	return {
		left: Math.max(MARGIN, Math.min(preferred, Math.max(MARGIN, viewport.width - tip.width - MARGIN))),
		top: Math.max(MARGIN, Math.min(top, Math.max(MARGIN, viewport.height - tip.height - MARGIN))),
	};
}

interface TipRow {
	id: string;
	label: string;
	color: string;
	value: number;
	text: string;
}

export interface TipContent {
	day: string;
	title: string;
	rows: TipRow[];
	total: string | null;
}

/**
 * The bubble's contents for one day: every provider, in the order the legend lists them.
 *
 * Providers that spent nothing that day stay in the list rather than being filtered out. "Relay
 * $0" is an answer — it says the day was someone else's — and a list whose rows appear and
 * disappear as the pointer moves is much harder to read than one that does not.
 */
export function tipContentAt(trends: ProviderTrend[], index: number, metric: TrendMetric, labelOf: (id: string) => string): TipContent | null {
	const day = trends[0]?.points[index]?.day;
	if (!day) return null;
	const rows = trends.map((trend, order) => {
		const value = trend.points[index]?.[metric] ?? 0;
		return { id: trend.id, label: labelOf(trend.id), color: trendColor(order), value, text: metricLabel(value, metric) };
	});
	const sum = rows.reduce((total, row) => total + row.value, 0);
	return { day, title: dayTitle(day), rows, total: rows.length > 1 ? metricLabel(sum, metric) : null };
}

/** `$12.34`, or four decimals for the fractions of a cent a small day costs. */
export function metricLabel(value: number, metric: TrendMetric): string {
	if (metric === "tokens") return Math.round(value).toLocaleString();
	if (value <= 0) return "$0";
	if (value < 0.005) return `$${value.toFixed(4)}`;
	return formatCost(value) ?? "$0";
}

/** Keys, not words: this table is built at import, before the window has settled on a language. */
const WEEKDAYS: MessageKey[] = [
	"weekday.sun",
	"weekday.mon",
	"weekday.tue",
	"weekday.wed",
	"weekday.thu",
	"weekday.fri",
	"weekday.sat",
];

/** `2026/9/5 周六` — the full date, because the axis only has room for `9/5`. */
export function dayTitle(day: string): string {
	const [year, month, date] = day.split("-").map(Number);
	if (!year || !month || !date) return day;
	return `${year}/${month}/${date} ${translate(WEEKDAYS[new Date(year, month - 1, date).getDay()])}`;
}
