/**
 * What one step of the plan is doing, as a 13px mark.
 *
 * Shared by the floating card and the task panel so the same step never reads two different ways
 * in two places — which it did: the card showed a live spinner while the panel showed a dot that
 * looked identical whether the run was working, paused or dead.
 */

import { Check } from "lucide-react";
import type { TodoItem } from "@lyra/core";

export /**
 * Three states, three marks, all on the same 13px grid so the column of them stays a column.
 *
 * The running one borrows the app's spinner geometry rather than a second kind of spinner, and
 * pending is a dashed ring — present, but plainly not started, which a solid outline reads as.
 */
function Mark({ status, paused, failed }: { status: TodoItem["status"]; paused?: boolean; failed?: boolean }) {
	if (status === "completed") {
		return (
			<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center text-ok">
				<Check size={11} strokeWidth={2.4} />
			</span>
		);
	}
	if (status === "in_progress" && failed) {
		// Stopped, and not by choice — so the offer is "again" rather than "carry on".
		return (
			<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center" aria-label="失败">
				<span className="block h-[7px] w-[7px] rounded-full bg-danger" />
			</span>
		);
	}
	if (status === "in_progress" && paused) {
		// Two bars: stopped where it stands, rather than finished or failed.
		return (
			<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center gap-[2px]" aria-label="已暂停">
				<span className="block h-[8px] w-[2px] rounded-[1px] bg-ink-faint" />
				<span className="block h-[8px] w-[2px] rounded-[1px] bg-ink-faint" />
			</span>
		);
	}
	if (status === "in_progress") {
		return (
			<svg width={13} height={13} viewBox="0 0 24 24" aria-hidden className="ly-spin ly-breathe shrink-0">
				<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3.4" className="text-line" />
				<circle
					cx="12"
					cy="12"
					r="9"
					fill="none"
					stroke="currentColor"
					strokeWidth="3.4"
					strokeLinecap="round"
					strokeDasharray={`${2 * Math.PI * 9 * 0.3} ${2 * Math.PI * 9}`}
					className="text-accent"
				/>
			</svg>
		);
	}
	return (
		<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
			<span className="block h-[9px] w-[9px] rounded-full border border-dashed border-line" />
		</span>
	);
}

/** The most recent reply, and whether it ended in an error rather than an answer. */
export function lastTurnFailed(messages: { role: string; stopReason?: string }[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		return message.stopReason === "error";
	}
	return false;
}
