/**
 * Transcript repairs shared by the main store and the side chat's.
 *
 * Lives on its own because the main store already imports the side one; putting this in either
 * would make the pair circular.
 */

import type { AgentEvent, AssistantMessage, Message } from "@lyra/core";

/**
 * Close out a reply the stream never finished.
 *
 * `message_end` is what normally settles an assistant message, and it does not arrive if the
 * connection drops mid-turn — an upstream socket reset (`UND_ERR_SOCKET`) leaves the last reply
 * marked `pending` forever, so it never gets its usage line and reads as still being written
 * long after the turn died. The run is over by the time this event arrives, so the tail follows.
 */
export function settleTail(messages: Message[], event: Extract<AgentEvent, { type: "agent_end" }>): Message[] {
	const index = messages.findLastIndex((m) => m.role === "assistant" && m.stopReason === "pending");
	if (index === -1) return messages;
	const tail = messages[index] as AssistantMessage;
	const next = [...messages];
	next[index] = {
		...tail,
		stopReason: event.reason === "aborted" ? "aborted" : event.reason === "error" ? "error" : "stop",
		errorMessage: event.reason === "error" ? (event.error ?? tail.errorMessage) : tail.errorMessage,
	};
	return next;
}
