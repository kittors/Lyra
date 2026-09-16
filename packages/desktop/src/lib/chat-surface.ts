/**
 * Which main-column surface a chat selection should paint.
 *
 * `meta.messageCount` is not a signal here. A cold click writes the sidebar row first
 * (`messageCount > 0`, `messages = []`, `loadingSession = true`). Treating the count as
 * "there is already a transcript" mounts `Conversation` over an empty list and skips the
 * skeleton that exists for this exact wait.
 */
export type ChatSurface = "conversation" | "skeleton" | "empty";

export function chatSurface(input: { messages: number; loading: boolean }): ChatSurface {
	if (input.messages > 0) return "conversation";
	if (input.loading) return "skeleton";
	return "empty";
}
