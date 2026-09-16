import type { TurnStop } from "../../store/turn-stop.ts";

/** Someone pressed stop. A clean `done` with leftover todos is not this. */
export function isUserPaused(running: boolean, stopped: TurnStop): boolean {
	return !running && stopped === "user";
}

/**
 * What the collapsed row should claim.
 *
 * `!running && active` used to be "paused". That is how a finished turn whose last todo_write
 * never ticked the last box announced 「已暂停」 after a normal reply.
 */
export function taskListHeadline(input: {
	running: boolean;
	stopped: TurnStop;
	active?: { content: string; activeForm?: string | null };
	done: number;
	total: number;
}): "paused" | "step" | "allDone" | "notStarted" {
	if (input.active) return isUserPaused(input.running, input.stopped) ? "paused" : "step";
	return input.total === input.done ? "allDone" : "notStarted";
}
