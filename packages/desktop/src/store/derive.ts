/**
 * Reading state back out of a transcript.
 *
 * When a stored conversation is opened there are no events to replay — only messages. Everything
 * the UI needs beyond the messages themselves (the tool cards, the plan, whether the run was cut
 * short) is derived here, from the same source the model saw.
 *
 * The session cache lives here too, for the same reason: it is a pure function of transcripts.
 */

import type { Message, TodoItem } from "@lyra/core";
import type { SessionMeta } from "@lyra/core";
import { summarizeToolCall } from "../lib/tool-summary.ts";
import type { AppState, ToolRun } from "./index.ts";

export type CachedSessionState = Pick<AppState, "running" | "todos" | "compactions" | "approvals" | "stopped" | "retrying" | "capabilities">;

export type Cache = Record<
  string,
  {
    meta: SessionMeta;
    messages: Message[];
    toolRuns: Record<string, ToolRun>;
    state?: CachedSessionState;
    scrollTop?: number;
    pinnedToBottom?: boolean;
  }
>;

/** How many transcripts to hold. Enough to cover switching around a project, not a whole day. */
const CACHE_LIMIT = 12;

/** Drop the least recently used entries, never the one being opened. */
export function prune(cache: Cache, keep: string): Cache {
  const ids = Object.keys(cache);
  if (ids.length <= CACHE_LIMIT) return cache;
  const next = { ...cache };
  // Insertion order is recency order here: entries are re-added as sessions are visited.
  let excess = ids.length - CACHE_LIMIT;
  for (const id of ids) {
    if (excess === 0) break;
    if (id === keep) continue;
    delete next[id];
    excess--;
  }
  return next;
}

export function without<T>(cache: Record<string, T>, id: string): Record<string, T> {
  if (!(id in cache)) return cache;
  const next = { ...cache };
  delete next[id];
  return next;
}


/**
 * How the last turn ended, when it ended somewhere short of the end.
 *
 * `"user"` is the stop button: the work is fine, it is just not moving. `"interrupt"` is
 * everything that took the turn away without being asked — a crash, a quit, a machine going to
 * sleep. `"error"` is a request that failed: the relay was out of credentials, the key was
 * refused, the model was gone. `null` is a turn that finished.
 *
 * Three states rather than one because the offer reads differently in each. Being told
 * 「上次执行被中断」 about a pause you performed yourself a second ago is the app describing your
 * own click back to you as an accident; being told it about an HTTP 503 says nothing about the one
 * thing worth knowing, which is that the work is still there.
 */
export type TurnStop = "user" | "interrupt" | "error" | null;

/**
 * The reason lives in two places, and both are needed.
 *
 * `agent_end` carries it exactly, but only while it is happening; the transcript carries it
 * afterwards, in a `stopReason` that survives being written to disk and read back next week. The
 * event wins where they differ, because a turn stopped while a tool was running has already had
 * its last reply settled as `toolUse` and leaves nothing in the log to say who stopped it.
 *
 * A failed request is the case this used to miss entirely, and it was the most common one. The
 * turn ends with an assistant message carrying `stopReason: "error"` and no tool calls, which
 * `wasCutShort` reads as a turn that finished — so nothing was offered, and a turn that had spent
 * a minute reading files could only be started over from the top. The work is on disk either way;
 * the only question is whether anything says so.
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

/**
 * Whether there is anything to re-ask.
 *
 * `retryFrom` walks back to the nearest message a person actually typed; with none in the
 * transcript it is a button that does nothing, which is worse than a button that is not there.
 */
export function hasRetryPoint(messages: Message[]): boolean {
	return messages.some((message) => message.role === "user" && !message.synthetic);
}

/**
 * Whether the conversation was left mid-turn.
 *
 * Two shapes mean the same thing. A reply still marked `pending` never reached its end; a
 * finished reply whose tool calls have no results was cut off between asking for the tools and
 * running them. Either way the work stopped somewhere it did not choose to.
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
 * The last task list written in a conversation.
 *
 * Searched backwards because `todo_write` sends the whole list every time — the newest one is
 * the only one that matters, and the ones before it are its earlier drafts.
 */
export function todosFrom(messages: Message[]): TodoItem[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "toolResult" || message.toolName !== "todo_write" || message.isError) continue;
		const details = message.details as { kind?: string; todos?: TodoItem[] } | undefined;
		if (details?.kind === "todo" && Array.isArray(details.todos)) return details.todos;
	}
	return [];
}

/** Reconstruct tool cards when opening a stored session. */
export function rebuildToolRuns(messages: Message[]): Record<string, ToolRun> {
  const runs: Record<string, ToolRun> = {};
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        runs[block.id] = {
          toolCallId: block.id,
          toolName: block.name,
          summary: summarizeToolCall(block.name, block.arguments),
          args: block.arguments,
          status: "running",
          startedAt: message.timestamp,
        };
      }
    } else if (message.role === "toolResult") {
      const run = runs[message.toolCallId];
      if (run) {
        run.status = message.isError ? "error" : "done";
        run.result = {
          content: message.content,
          details: message.details,
          isError: message.isError,
        };
        run.finishedAt = message.timestamp;
      }
    }
  }

  /*
   * A call with no result did not survive; it is not still running.
   *
   * Tool state is rebuilt from the log, and a call is only marked finished when its result is
   * written. Quit the app — or lose the renderer — while a command is running and no result is
   * ever recorded, so re-opening that session showed a spinner counting up from a process that
   * stopped existing minutes ago. Nine minutes on a `git status` is not a slow command, it is a
   * lie about what is happening.
   *
   * Only when the turn itself has settled: a session that is genuinely mid-turn in the
   * background has calls that legitimately have no result yet.
   */
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const turnInFlight = lastAssistant?.role === "assistant" && lastAssistant.stopReason === "pending";
  if (!turnInFlight) {
    for (const run of Object.values(runs)) {
      if (run.status !== "running") continue;
      run.status = "error";
      run.result = { content: [{ type: "text", text: "这次调用没有结果：应用在它结束之前退出了。" }], isError: true };
      run.finishedAt = run.startedAt;
    }
  }

  return runs;
}
