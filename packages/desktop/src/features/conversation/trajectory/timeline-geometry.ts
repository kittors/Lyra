import type { Entry } from "@lyra/core/trajectory-view";

export interface TimeRange { start: number; end: number }
export const LANE_HEIGHT = 16;
const MIN_DRAG = 3;

export function timelineLane(entry: Entry): number {
	return entry.source === "tool-call" ? 1 : entry.source === "compaction" || entry.source === "subagent" ? 2 : 0;
}

export function timelineDomain(entries: Entry[]): TimeRange {
	let start = Infinity, end = -Infinity;
	for (const entry of entries) { start = Math.min(start, entry.startedAt ?? entry.ts); end = Math.max(end, entry.finishedAt ?? entry.startedAt ?? entry.ts); }
	return entries.length ? { start, end: Math.max(start + 1, end) } : { start: 0, end: 1 };
}

function timelineTime(x: number, width: number, shown: TimeRange): number {
	return shown.start + Math.max(0, Math.min(width, x)) / Math.max(1, width) * (shown.end - shown.start);
}

/** Hit the same minimum-width painted span; lane gaps must never select a neighbouring row. */
export function timelineHit(entries: Entry[], x: number, y: number, width: number, shown: TimeRange): Entry | undefined {
	if (width <= 0 || x < 0 || x > width || y < 0 || y >= LANE_HEIGHT * 3 || y % LANE_HEIGHT < 3 || y % LANE_HEIGHT >= 13) return;
	const lane = Math.floor(y / LANE_HEIGHT);
	let hit: Entry | undefined;
	for (const entry of entries) {
		if (timelineLane(entry) !== lane) continue;
		const left = ((entry.startedAt ?? entry.ts) - shown.start) / (shown.end - shown.start) * width;
		const right = Math.max(left + 2, ((entry.finishedAt ?? entry.startedAt ?? entry.ts) - shown.start) / (shown.end - shown.start) * width);
		if (x >= left && x < right) hit = entry;
	}
	return hit;
}

export function draggedRange(startX: number, endX: number, width: number, shown: TimeRange): TimeRange | null {
	if (Math.abs(endX - startX) < MIN_DRAG) return null;
	const start = timelineTime(Math.min(startX, endX), width, shown);
	const end = timelineTime(Math.max(startX, endX), width, shown);
	return end > start ? { start, end } : null;
}
