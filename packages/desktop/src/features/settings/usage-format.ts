/**
 * Numbers, short enough to fit in a tile.
 *
 * Shared rather than defined next to each caller: the page states the same quantity in three
 * places — a tile, a bar's label, a tooltip — and two of them rounding differently is the kind of
 * disagreement that makes people distrust all three.
 */

/** `1.2M`, `3.4k`, `860`. The exact number goes in the tooltip beside it. */
export function formatCompact(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (value >= 1_000_000_000) {
		const b = value / 1_000_000_000;
		return `${b >= 100 ? b.toFixed(0) : b.toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		const m = value / 1_000_000;
		return `${m >= 100 ? m.toFixed(0) : m.toFixed(1)}M`;
	}
	if (value >= 10_000) {
		const k = value / 1000;
		return `${k >= 100 ? k.toFixed(0) : k.toFixed(1)}k`;
	}
	return Math.round(value).toLocaleString();
}

/**
 * What a cost is worth saying. Below a hundredth of a cent, nothing — 「$0.0000」 is noise.
 *
 * Between that and half a cent it says 「<$0.01」 rather than 「$0.00」: a sub-agent that read
 * three files costs a fraction of a cent, and printing that as zero reads as free, which it is not.
 */
export function formatCost(value: number): string | null {
	if (!(value > 0.0001)) return null;
	if (value < 0.005) return "<$0.01";
	return value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}
