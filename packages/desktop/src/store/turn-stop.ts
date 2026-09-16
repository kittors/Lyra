import type { Message } from "@lyra/core";

export type TurnStop = "user" | "interrupt" | "error" | null;

/**
 * Whether the conversation was left mid-turn.
 *
 * Two shapes mean the same thing. A reply still marked `pending` never reached its end; a
 * finished reply whose tool calls have no results was cut off between asking for the tools and
 * running them. Either way the work stopped somewhere it did not choose to.
 *
 * Exported because `derive.ts` re-exports it and the tests drive it directly. It used to live
 * there and was copied here when `howItStopped` moved; one of the two had to go, and the one the
 * application actually runs is this one.
 */
export function wasCutShort(messages: Message[]): boolean {
	/*
	 * A finished turn always ends with the agent saying something.
	 *
	 * Stopping between a tool's result and the reply to it leaves the result as the last message:
	 * the tools all ran, nothing is unanswered, and the old rules below therefore called it
	 * complete — while the one thing the turn was for, the answer, never arrived.
	 */
	if (messages[messages.length - 1]?.role === "toolResult") return true;

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		if (message.stopReason === "pending") return true;
		const calls = message.content.filter((block) => block.type === "toolCall");
		if (calls.length === 0) return false;
		const answered = new Set(
			messages.slice(i + 1).flatMap((m) => (m.role === "toolResult" ? [m.toolCallId] : [])),
		);
		return calls.some((call) => call.type === "toolCall" && !answered.has(call.id));
	}
	return false;
}

/**
 * Why a turn ended, as the UI should describe it.
 */
export function howItStopped(messages: Message[], reason?: string): TurnStop {
	if (reason === "aborted") return "user";
	if (reason === "error") return "error";
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		if (message.stopReason === "aborted") return "user";
		if (message.stopReason === "error") return "error";
		break;
	}
	return wasCutShort(messages) ? "interrupt" : null;
}
