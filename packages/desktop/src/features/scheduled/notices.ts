/**
 * What the scheduler has told this window, held for the places that show it.
 *
 * A run in progress shows on its task's card. A failure shows there too — from the task's own
 * `lastError`, which outlives the window — and, until someone has seen it, on the line above the
 * composer and as a count on the sidebar's entry for the schedule. Only that "not seen yet" is kept
 * here, and only while the window is open: the failure itself is on the task.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { SessionActivity } from "@lyra/core/activity";
import type { SchedulerNotice } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";

/** A failure nobody has looked at yet. */
interface UnseenFailure {
	taskId: string;
	/** The notice's own sentence, already in the interface language. */
	message: string;
}

interface ScheduledNotices {
	/**
	 * Runs that have started and not yet ended: the session each one is in, by task.
	 *
	 * Taken from the notice rather than read off the task and the session's activity alone, because
	 * neither of those knows yet when it arrives. The task names its new session only once the attempt
	 * has been saved and the settings have come back, and until then points at the previous run; the
	 * session's activity begins with its turn, a few writes to disk later.
	 */
	runs: Readonly<Record<string, string>>;
	/** One per task — a later failure replaces an earlier one — newest last. */
	unseen: readonly UnseenFailure[];
	/** The task whose card the schedule should bring into view when it next shows. */
	focus: string | null;
}

export const useScheduledNotices = create<ScheduledNotices>(() => ({ runs: {}, unseen: [], focus: null }));

function without(runs: Readonly<Record<string, string>>, taskId: string): Record<string, string> {
	const rest = { ...runs };
	delete rest[taskId];
	return rest;
}

/** One notice from the scheduler, into the state the card, the composer and the sidebar read. */
export function receiveNotice(notice: SchedulerNotice): void {
	useScheduledNotices.setState((state) => {
		if (notice.kind === "started") {
			return notice.sessionId ? { runs: { ...state.runs, [notice.taskId]: notice.sessionId } } : {};
		}
		const unseen = [...state.unseen.filter((failure) => failure.taskId !== notice.taskId), { taskId: notice.taskId, message: notice.message }];
		// A turn that failed is over. A task that could not start ends nothing: an earlier run of it
		// may still be going, and this is not about that one.
		const ended = notice.kind === "failed" && notice.sessionId !== undefined && state.runs[notice.taskId] === notice.sessionId;
		return ended ? { unseen, runs: without(state.runs, notice.taskId) } : { unseen };
	});
}

/**
 * Whether a run's session has stopped, going by the activity the sidebar keeps for it.
 *
 * Finished and failed say so outright. An aborted turn goes back to no activity at all, and so does
 * one that finished on screen — a conversation being watched has nothing unread — which means "over"
 * only when it had been going.
 */
export function runEnded(before: SessionActivity | undefined, now: SessionActivity | undefined): boolean {
	if (now === "done" || now === "failed") return true;
	return now === undefined && (before === "running" || before === "waiting");
}

function settle(taskId: string, sessionId: string): void {
	useScheduledNotices.setState((state) => (state.runs[taskId] === sessionId ? { runs: without(state.runs, taskId) } : {}));
}

/** Someone has seen them: 知道了 on the composer's line, or the schedule itself on screen. */
export function markFailuresSeen(): void {
	if (useScheduledNotices.getState().unseen.length > 0) useScheduledNotices.setState({ unseen: [] });
}

/** 查看 on the composer's line: the schedule, with that task's card brought into view. */
export function showScheduledTask(taskId: string): void {
	useScheduledNotices.setState({ focus: taskId });
	useApp.getState().setView("scheduled");
}

/**
 * Listens to the scheduler, and for the end of every run it announced. Mounted once, by the shell.
 *
 * The end is read off the activity the sidebar already keeps for every session rather than sent as
 * a notice of its own: the event stream is the one account of what a session is doing, and a second
 * would be a second thing to disagree with it.
 */
export function useSchedulerNotices(): void {
	useEffect(() => bridge.scheduler.onNotice(receiveNotice), []);
	useEffect(
		() =>
			useApp.subscribe((state, previous) => {
				if (state.activity === previous.activity) return;
				for (const [taskId, sessionId] of Object.entries(useScheduledNotices.getState().runs)) {
					if (runEnded(previous.activity[sessionId], state.activity[sessionId])) settle(taskId, sessionId);
				}
			}),
		[],
	);
}
