/**
 * How a sub-agent's state reads, in the two places it is shown.
 *
 * Here rather than in either component because the bar and the pane describe the same four states
 * and the same clock, and two spellings of 「已结束」 would be two answers to one question.
 */

import type { SubAgentStatus } from "@lyra/core";

/** `18s`, `2m 14s`, `1h 3m` — the same shape the running turn's own meter uses. */
export function elapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		return `${hours}h ${minutes % 60}m`;
	}
	return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/** Elapsed from a start stamp to now, for something still going. */
export function elapsedSince(startedAt: number): string {
	return elapsed(Date.now() - startedAt);
}

/**
 * How long it ran, whether or not it still is.
 *
 * A finished sub-agent's reading has to stop at the moment it finished; counting to now would show
 * a run that took nine seconds as having taken an hour, purely because the window stayed open.
 */
export function ranFor(one: { startedAt: number; endedAt?: number }): string {
	return elapsed((one.endedAt ?? Date.now()) - one.startedAt);
}

/** One word for a terminal state — running has a clock instead, which says more. */
export function statusWord(status: SubAgentStatus): string {
	if (status === "done") return "已完成";
	if (status === "failed") return "失败";
	if (status === "aborted") return "已停止";
	return "运行中";
}

/** The dot's colour, matched to the app's own semantics for the same three outcomes. */
export function statusTone(status: SubAgentStatus): string {
	if (status === "running") return "bg-accent";
	if (status === "done") return "bg-ok";
	if (status === "failed") return "bg-danger";
	return "bg-ink-faint";
}
