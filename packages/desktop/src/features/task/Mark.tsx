/**
 * What one step of the plan is doing, as a 13px mark.
 *
 * Shared by the floating card and the task panel so the same step never reads two different ways
 * in two places — which it did: the card showed a live spinner while the panel showed a dot that
 * looked identical whether the run was working, paused or dead.
 */

import { translate } from "../../i18n/translate.ts";
import { Check } from "lucide-react";
import { Spinner } from "../../ui/motion/loaders.tsx";
import type { TodoItem } from "@lyra/core";

export /**
 * Three states, three marks, all on the same 13px grid so the column of them stays a column.
 *
 * 正在跑的那一步用的就是全应用那一个 `Spinner`，不是照它的样子再画一个——这里原先自己描了一段
 * 圆弧，跟它想模仿的那个 spinner 只是碰巧长得像，后者换了形状它还留在原地。等待中是一圈虚线：
 * 在，但显然还没开始，实线轮廓读起来不是这个意思。
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
			<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center" aria-label={translate("mark.failed")}>
				<span className="block h-[7px] w-[7px] rounded-full bg-danger" />
			</span>
		);
	}
	if (status === "in_progress" && paused) {
		// Two bars: stopped where it stands, rather than finished or failed.
		return (
			<span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center gap-[2px]" aria-label={translate("mark.paused")}>
				<span className="block h-[8px] w-[2px] rounded-[1px] bg-ink-faint" />
				<span className="block h-[8px] w-[2px] rounded-[1px] bg-ink-faint" />
			</span>
		);
	}
	if (status === "in_progress") {
		return <Spinner size={13} className="text-accent" />;
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
