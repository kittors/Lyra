/**
 * A scheduled task failed: said above the composer, until someone has seen it.
 *
 * In the conversation rather than in a corner of the window. The task ran in a session of its own
 * that nobody was looking at, and a toast would have been gone before anyone looked up. One line —
 * the newest failure, and how many others there are. 查看 opens the schedule at that task's card,
 * where the reason stays; the cross says it has been seen. Both clear the count on the sidebar too,
 * since it counts the same failures.
 *
 * Only the screen in front says it. A split window draws a composer for every screen, and the line
 * belongs to none of their conversations, so it is said once rather than beside each of them.
 */

import { Clock, X } from "lucide-react";
import { useState } from "react";
import { useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { Collapse } from "../../ui/layout/Collapse.tsx";
import { markFailuresSeen, showScheduledTask, useScheduledNotices } from "./notices.ts";

export function ScheduledAlert() {
	const { t } = useI18n();
	const unseen = useScheduledNotices((s) => s.unseen);
	const screen = useScopedSessionId();
	const inFront = useApp((s) => s.activeSessionId === screen);
	const latest = inFront ? unseen.at(-1) : undefined;
	// Held while the line folds away, so its words leave with it rather than blanking as it starts to close.
	const [shown, setShown] = useState(latest);
	if (latest && latest !== shown) setShown(latest);
	const others = unseen.length - 1;

	return (
		<Collapse open={latest !== undefined}>
			{shown && (
				<div
					className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line-soft bg-card/60 px-2 py-0.5"
					data-scheduled-alert={shown.taskId}
				>
					<Clock size={13} strokeWidth={1.8} className="shrink-0 text-danger" />
					<span className="min-w-0 flex-1 truncate py-1 text-detail text-ink-muted" data-ly-tip={shown.message}>
						{shown.message}
					</span>
					{others > 0 && (
						<span className="shrink-0 text-caption tabular-nums text-ink-faint" data-scheduled-alert-others>
							{t("scheduled.otherFailures", { n: others })}
						</span>
					)}
					<button
						type="button"
						onClick={() => showScheduledTask(shown.taskId)}
						data-scheduled-alert-look
						className="flex h-5 shrink-0 items-center rounded px-1 text-caption text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
					>
						{t("common.look")}
					</button>
					<button
						type="button"
						onClick={markFailuresSeen}
						data-scheduled-alert-dismiss
						data-ly-tip={t("scheduled.dismissFailures")}
						aria-label={t("scheduled.dismissFailures")}
						className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
					>
						<X size={12} strokeWidth={2} />
					</button>
				</div>
			)}
		</Collapse>
	);
}
