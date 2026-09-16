/**
 * Work waiting behind whatever is running.
 *
 * Deliberately not the steering queue. Steering splices a message between turns of the current run,
 * which is right for "actually, also check X" and wrong for a dispatched task — that is a separate
 * piece of work and must not blur into the one in progress.
 *
 * The queue owns the list and the draining; it does not know how to run anything. What to do with a
 * task is passed in, which is what keeps this testable without a model and what lets a different
 * scheduler decide the order without touching any of it.
 */

import { randomUUID } from "node:crypto";
import type { QueuedTask } from "../agent/events.ts";
import { nextTask } from "./scheduling.ts";

export interface TaskQueueOptions {
	/** Run one task to completion. Throwing marks it failed. */
	run(task: QueuedTask): Promise<void>;
	/** Whether the session is busy with something that is not a task. */
	busy(): boolean;
	/** Called whenever the list changes, so the UI can be told. */
	changed(): Promise<void>;
	newId(): string;
	now(): number;
}

/**
 * Whether a task that has stopped can be picked up again.
 *
 * The panel reads this rule too, in `TaskStrip`, written out rather than imported: pulling a value
 * out of this package and into the renderer drags the whole of it — native modules included — into
 * that bundle. Duplicating it is safe in this direction because `resume` below is the one that
 * decides; a stale copy in the panel can only offer a button that declines.
 */
export function isResumable(task: QueuedTask): boolean {
	if (task.status === "failed") return true;
	return task.status === "cancelled" && task.cancelledBy === "stop";
}

export class TaskQueue {
	private readonly tasks: QueuedTask[] = [];
	/** Guards the drain loop against the re-entry its own `run` would otherwise cause. */
	private draining = false;

	private readonly options: TaskQueueOptions;

	constructor(options: TaskQueueOptions) {
		this.options = options;
	}

	list(): QueuedTask[] {
		return this.tasks;
	}

	/**
	 * Hand the session a piece of work to run once it is free.
	 *
	 * Runs immediately when nothing is in progress, which is the whole point: you dispatch it and
	 * walk away.
	 */
	async enqueue(text: string, origin: QueuedTask["origin"] = "side-chat"): Promise<QueuedTask> {
		const task: QueuedTask = {
			id: this.options.newId(),
			text,
			origin,
			status: "queued",
			createdAt: this.options.now(),
		};
		this.tasks.push(task);
		await this.options.changed();
		void this.drain();
		return task;
	}

	async cancel(taskId: string): Promise<boolean> {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task || task.status !== "queued") return false;
		task.status = "cancelled";
		task.cancelledBy = "user";
		task.finishedAt = this.options.now();
		await this.options.changed();
		return true;
	}

	/**
	 * Put an interrupted task back in the queue.
	 *
	 * Only the ones that stopped because the *session* stopped. A task cancelled that way is not
	 * finished business — it was running, something else was paused, and it went down with it — and
	 * until now there was no way back: the row said 「主会话已暂停，任务一并中断」 and that was the
	 * end of it, whatever the main conversation did afterwards. Continuing the main session does not
	 * revive it either, because by then it is a terminal record with nothing tying it to the turn.
	 *
	 * So the way back is explicit, and it is the same act as dispatching it the first time: the task
	 * goes to the back of the queue and drains when the session is free.
	 *
	 * Failures qualify too, for the same reason and by the same gesture — a task that died on a
	 * dropped connection is work you still want done. Withdrawn tasks do not: you took that one back
	 * on purpose. Nor do completed ones; asking for the same thing twice is a new dispatch.
	 */
	async resume(taskId: string): Promise<boolean> {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task || !isResumable(task)) return false;
		task.status = "queued";
		delete task.cancelledBy;
		delete task.finishedAt;
		delete task.startedAt;
		await this.options.changed();
		void this.drain();
		return true;
	}

	/**
	 * Take a finished task off the list.
	 *
	 * The list is a receipt, not a record: what actually happened is in the session's transcript,
	 * and that is not touched. This is for clearing away rows you have already read — including the
	 * ones you cancelled yourself, whose outcome you knew before you clicked.
	 *
	 * Only tasks that are over. Dismissing something still queued would look like cancelling it and
	 * would not be: the work would run with nothing on screen saying so.
	 */
	async dismiss(taskId: string): Promise<boolean> {
		const index = this.tasks.findIndex((t) => t.id === taskId);
		if (index < 0) return false;
		const task = this.tasks[index]!;
		if (task.status === "queued" || task.status === "running") return false;
		this.tasks.splice(index, 1);
		await this.options.changed();
		return true;
	}

	/**
	 * Stop means stop, including the one in progress.
	 *
	 * A task that has been picked up is cancelled here as well as the ones still waiting: the
	 * button was pressed while it was running, and leaving it to finish is the opposite of what
	 * pressing it asks for. The turn itself is aborted separately, by whoever owns the controller.
	 */
	async cancelAll(): Promise<void> {
		let touched = false;
		for (const task of this.tasks) {
			if (task.status !== "queued" && task.status !== "running") continue;
			task.status = "cancelled";
			// Not the same as being withdrawn: this task was going, and it stopped because the main
			// session did. The list has to keep saying so — see `cancelledBy`.
			task.cancelledBy = "stop";
			task.finishedAt = this.options.now();
			touched = true;
		}
		if (touched) await this.options.changed();
	}

	/** A cancelled goal is withdrawn, so Continue cannot revive its dispatched work. */
	async discardPlan(): Promise<void> {
		let changed = false;
		for (const task of this.tasks) {
			if (!isResumable(task)) continue;
			task.status = "cancelled";
			task.cancelledBy = "user";
			changed = true;
		}
		if (changed) await this.options.changed();
	}

	/** Start draining if nothing else is. Safe to call from anywhere, including mid-drain. */
	async drain(): Promise<void> {
		if (this.draining || this.options.busy()) return;
		this.draining = true;
		try {
			while (true) {
				const next = nextTask(this.tasks);
				if (!next) return;

				next.status = "running";
				next.startedAt = this.options.now();
				await this.options.changed();

				let failure: string | null = null;
				try {
					await this.options.run(next);
				} catch (cause) {
					failure = cause instanceof Error ? cause.message : String(cause);
				}

				/*
				 * Re-read rather than writing to `next` directly.
				 *
				 * `abort` cancels whatever is running and can land at any point during the await
				 * above. Its verdict is the user's; ours is a guess made before the fact.
				 */
				const settled = this.tasks.find((t) => t.id === next.id);
				if (settled?.status === "running") {
					settled.status = failure ? "failed" : "done";
					if (failure) settled.error = failure;
					settled.finishedAt = this.options.now();
				}
				await this.options.changed();
			}
		} finally {
			this.draining = false;
		}
	}
}

/**
 * The queue a session uses, with the two mechanical answers already filled in.
 *
 * Ids and clocks are the queue's business, not the session's — and a caller that had to supply
 * them could supply a clock that goes backwards. What the session does have to say is what running
 * a task means, whether it is busy, and where to send the list when it changes.
 */
export function sessionTaskQueue(deps: {
	run(task: QueuedTask): Promise<void>;
	busy(): boolean;
	/** Given a copy, never the live list: an event holding a reference would report the queue as it
	    looked when someone got round to reading it, not when it was sent. */
	changed(tasks: QueuedTask[]): Promise<void>;
}): TaskQueue {
	const queue: TaskQueue = new TaskQueue({
		run: deps.run,
		busy: deps.busy,
		changed: () => deps.changed(queue.list().map((task) => ({ ...task }))),
		newId: () => randomUUID().slice(0, 8),
		now: () => Date.now(),
	});
	return queue;
}
