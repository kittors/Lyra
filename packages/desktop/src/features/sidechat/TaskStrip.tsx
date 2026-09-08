/**
 * What the side chat has handed over, and where it got to.
 *
 * The side chat cannot act on the project itself, so anything that needs doing is dispatched to the
 * main session's queue. This is the receipt for that — one line per task, in a panel two hundred
 * pixels wide, which is the constraint that decides everything below.
 *
 * No fill, no border, no expander. It had all three: a rule above it, a tinted background, a
 * summary row that collapsed the list, and a card with its own border and its own spinner sitting
 * under the spinner that was already in the summary. Two spinners for one fact. The text is
 * truncated to a line and the whole of it is a tooltip, which is what a narrow panel can afford.
 */

import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import type { QueuedTask } from "@lyra/core";
import { Ban, Check, CircleDashed, Clock, OctagonPause, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useSide } from "../dock/index.ts";
import { useApp } from "../../store/index.ts";

const TASK_ICON: Record<QueuedTask["status"], typeof Clock> = {
	queued: Clock,
	running: CircleDashed,
	done: Check,
	failed: TriangleAlert,
	cancelled: Ban,
};

/**
 * Rows worth keeping once they are over.
 *
 * A completed or failed task is news — you were not watching, and this row is how you find out. A
 * task you withdrew yourself is not: you clicked, you know. But one that was cancelled *by the main
 * session stopping* is news again, and the sharpest kind: it was running a moment ago. Leaving that
 * out is what made a dispatched task vanish from the panel when the main conversation was paused,
 * which reads as the work having been lost.
 */
function worthKeeping(task: QueuedTask): boolean {
	if (task.status === "done" || task.status === "failed") return true;
	return task.status === "cancelled" && task.cancelledBy === "stop";
}

/** Finished rows linger this many, so a row does not vanish the instant it completes. */
const RECENT_KEPT = 3;

export function TaskStrip() {
	const tasks = useSide((s) => s.tasks);

	const active = tasks.filter((t) => t.status === "queued" || t.status === "running");
	const recent = tasks.filter(worthKeeping).slice(-RECENT_KEPT);
	const shown = [...recent, ...active];

	if (shown.length === 0) return null;

	return (
		<div className="shrink-0">
			<div className="mx-auto flex w-full max-w-[var(--ly-content)] flex-col gap-px px-2 pb-1">
				{shown.map((task) => (
					<TaskRow key={task.id} task={task} />
				))}
			</div>
		</div>
	);
}

/** What the row says about itself, under the text. */
function statusOf(task: QueuedTask): string {
	switch (task.status) {
		case "queued":
			return translate("taskStrip.queued");
		case "running":
			return translate("taskStrip.mainBusy");
		case "done":
			return translate("taskStrip.done");
		case "failed":
			return task.error ? translate("taskStrip.failedWith", { error: task.error }) : translate("taskStrip.failed");
		case "cancelled":
			// The two cancellations, told apart — see `cancelledBy`.
			return translate(task.cancelledBy === "stop" ? "taskStrip.interrupted" : "taskStrip.withdrawn");
	}
}

function TaskRow({ task }: { task: QueuedTask }) {
	const { t } = useI18n();
	const cancelTask = useSide((s) => s.cancelTask);
	const dismissTask = useSide((s) => s.dismissTask);
	const resumeTask = useSide((s) => s.resumeTask);
	const seedDraft = useSide((s) => s.seedDraft);
	const send = useApp((s) => s.send);
	const Icon = task.status === "cancelled" && task.cancelledBy === "stop" ? OctagonPause : TASK_ICON[task.status];
	const over = task.status !== "queued" && task.status !== "running";
	/*
	 * Whether to offer a way back into this one.
	 *
	 * The rule is stated in `TaskQueue.resume`, and this is deliberately a second reading of it
	 * rather than a call into it: importing a *value* from `@lyra/core` here pulls the whole package
	 * — native modules included — into the renderer bundle, and the build says so.
	 *
	 * Safe to duplicate because the queue is the one that decides. It refuses anything that is not
	 * resumable, so the worst a drift here can do is show a button that declines; it cannot resume
	 * something that should not be.
	 */
	const resumable = task.status === "failed" || (task.status === "cancelled" && task.cancelledBy === "stop");

	return (
		<div
			className="group/task flex items-center gap-2 rounded-md px-1.5 py-1 text-detail transition-colors hover:bg-card-hover"
			// The whole instruction, for a row that can only show a line of it.
			data-ly-tip={`${task.text}\n\n${statusOf(task)}`}
		>
			<Icon
				size={12}
				strokeWidth={1.9}
				className={`shrink-0 ${
					task.status === "failed"
						? "text-danger"
						: task.status === "done"
							? "text-ok"
							: task.status === "running"
								? "ly-spin text-ink-muted"
								: "text-ink-faint"
				}`}
			/>
			<span className="min-w-0 flex-1 truncate text-ink-muted">{task.text}</span>

			{/*
			 * Only on hover, and only what applies.
			 *
			 * `group-has-[:focus-visible]` rather than `focus-within`: a mouse click leaves focus
			 * behind, and the buttons would stay out after the pointer had gone — see
			 * `e2e/hover-controls-probe.ts`.
			 */}
			<div data-ly-hover-reveal className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/task:opacity-100 group-has-[:focus-visible]/task:opacity-100">
				{task.status === "queued" && (
					<>
						<button
							type="button"
							data-ly-tip={t("taskStrip.runNow")}
							onClick={() => {
								void cancelTask(task.id);
								void send([{ type: "text", text: task.text }]);
							}}
							className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
							aria-label={t("taskStrip.runNow")}
						>
							<Play size={11} strokeWidth={2} />
						</button>
						<button
							type="button"
							data-ly-tip={t("taskStrip.withdraw")}
							onClick={() => {
								void cancelTask(task.id);
								seedDraft(task.text);
							}}
							className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
							aria-label={t("taskStrip.withdrawOne")}
						>
							<RotateCcw size={11} strokeWidth={2} />
						</button>
					</>
				)}
				{/*
				 * Picking it back up, for the two ways a task stops without finishing.
				 *
				 * The main session being paused takes its dispatched task down with it, and a task
				 * can fail on its own. Both used to be the end of the story — the row said what had
				 * happened and nothing could act on it, so work dispatched from this panel was
				 * simply not done and there was no way to ask for it again short of retyping it.
				 */}
				{resumable && (
					<button
						type="button"
						data-ly-tip={t(task.status === "failed" ? "taskStrip.retryOne" : "taskStrip.resumeOne")}
						onClick={() => void resumeTask(task.id)}
						className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
						aria-label={t(task.status === "failed" ? "taskStrip.retryOne" : "taskStrip.resumeOne")}
					>
						<Play size={11} strokeWidth={2} />
					</button>
				)}
				{over && (
					<button
						type="button"
						data-ly-tip={t("taskStrip.remove")}
						onClick={() => void dismissTask(task.id)}
						className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:text-danger"
						aria-label={t("taskStrip.removeOne")}
					>
						<X size={11} strokeWidth={2} />
					</button>
				)}
			</div>
		</div>
	);
}
