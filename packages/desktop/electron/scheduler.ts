/**
 * Scheduled tasks.
 *
 * Each due task starts a *fresh* session and sends its prompt. A fresh session is deliberate:
 * a recurring task that accumulated history would drift as the transcript grew, and would
 * eventually blow past the context window.
 *
 * The tick is one minute, which is the finest granularity the schedule kinds express.
 */

import { isDue } from "@lyra/core";
import type { AgentSession, ScheduledTask, Settings } from "@lyra/core";
import { nativeText } from "./i18n.ts";

const TICK_MS = 60_000;

export interface SchedulerDeps {
	getSettings(): Settings;
	saveSettings(settings: Settings): Promise<void>;
	createSession(cwd: string, modelId: string): Promise<AgentSession>;
	/** A notice for the window, already in the interface language. */
	notify(message: string, level: "info" | "warn" | "error"): void;
}

export class Scheduler {
	private deps: SchedulerDeps;
	private timer: ReturnType<typeof setInterval> | null = null;
	/** Guards against a slow task being started twice by successive ticks. */
	private running = new Set<string>();

	constructor(deps: SchedulerDeps) {
		this.deps = deps;
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		// Run one tick shortly after launch so a task overdue from last session fires.
		setTimeout(() => void this.tick(), 5_000);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async tick(now = Date.now()): Promise<void> {
		const settings = this.deps.getSettings();
		for (const task of settings.scheduledTasks) {
			if (!task.enabled || this.running.has(task.id)) continue;
			if (!isDue(task, now)) continue;
			await this.run(task, now);
		}
	}

	private async run(task: ScheduledTask, now: number): Promise<void> {
		this.running.add(task.id);
		let sessionId: string | undefined;
		let error: string | undefined;

		try {
			const settings = this.deps.getSettings();
			const session = await this.deps.createSession(task.cwd, settings.defaultModelId ?? "");
			sessionId = session.meta.id;
			this.deps.notify(nativeText("scheduled.started", { name: task.name }), "info");
			// Not awaited: the turn can run for minutes and must not block the tick.
			void session.prompt([{ type: "text", text: task.prompt }]).catch((cause: unknown) => {
				this.deps.notify(
					nativeText("scheduled.failed", { name: task.name, reason: cause instanceof Error ? cause.message : String(cause) }),
					"error",
				);
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			this.deps.notify(nativeText("scheduled.couldNotStart", { name: task.name, reason: error }), "error");
		} finally {
			this.running.delete(task.id);
			// Record the attempt either way, so a failing task does not retry every minute.
			const settings = this.deps.getSettings();
			await this.deps.saveSettings({
				...settings,
				scheduledTasks: settings.scheduledTasks.map((t) =>
					t.id === task.id ? { ...t, lastRunAt: now, lastSessionId: sessionId, lastError: error } : t,
				),
			});
		}
	}
}
