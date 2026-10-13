/**
 * The gallery's rows: every picture at its own shape, every full row exactly as wide as the column.
 *
 * Not a grid of squares. Drawings come in every shape — 1:1, 16:9 posters, 9:16 phone wallpapers —
 * and a square crop shows a third of a wide one. Rows of equal height whose widths add up to the
 * column keep each picture whole and still line up on both edges, the way photo libraries do it.
 */

interface PlacedTile {
	/** Index into the list that was laid out. */
	index: number;
	width: number;
	height: number;
}

export interface PlacedRow {
	tiles: PlacedTile[];
	height: number;
}

/** Width over height, from the sizes a drawing records; square when it recorded none. */
export function aspectOf(size: { width?: number; height?: number }): number {
	const { width, height } = size;
	if (!width || !height || width <= 0 || height <= 0) return 1;
	// Kept within reason: a 1×40 banner would otherwise take a whole row as a hairline.
	return Math.min(4, Math.max(0.25, width / height));
}

/**
 * Break pictures into rows near `target` tall.
 *
 * A row takes pictures until one more would bring it under the target height, then keeps whichever
 * of the two heights — with that picture or without it — is closer to the target. The last row is
 * not stretched to the edge: three pictures stretched across a whole row would be twice the height
 * of every other row.
 */
export function justify(aspects: readonly number[], width: number, options: { target: number; gap: number }): PlacedRow[] {
	const { target, gap } = options;
	if (width <= 0) return [];
	const rows: PlacedRow[] = [];
	const fit = (from: number, to: number) => {
		let sum = 0;
		for (let i = from; i < to; i++) sum += aspects[i];
		return (width - gap * (to - from - 1)) / sum;
	};
	const close = (from: number, to: number, height: number) => {
		const tiles: PlacedTile[] = [];
		for (let i = from; i < to; i++) tiles.push({ index: i, width: aspects[i] * height, height });
		rows.push({ tiles, height });
	};
	let start = 0;
	while (start < aspects.length) {
		let end = start + 1;
		while (end < aspects.length && fit(start, end + 1) >= target) end++;
		if (end === aspects.length) {
			// What is left fits at the target height or taller: the last row, left at the target.
			const height = Math.min(target, fit(start, end));
			close(start, end, height);
			break;
		}
		const without = fit(start, end);
		const withNext = fit(start, end + 1);
		if (Math.abs(withNext - target) < Math.abs(without - target)) end++;
		close(start, end, fit(start, end));
		start = end;
	}
	return rows;
}

/** A day of pictures, newest day first. `day` is local midnight, for the heading. */
export interface DaySection<T> {
	day: number;
	items: T[];
}

/** Group by local day, keeping the order given within each day. */
export function byDay<T>(items: readonly T[], at: (item: T) => number): DaySection<T>[] {
	const sections: DaySection<T>[] = [];
	const index = new Map<number, DaySection<T>>();
	for (const item of items) {
		const date = new Date(at(item));
		const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		let section = index.get(day);
		if (!section) {
			section = { day, items: [] };
			index.set(day, section);
			sections.push(section);
		}
		section.items.push(item);
	}
	return sections.sort((a, b) => b.day - a.day);
}
