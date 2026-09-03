/**
 * What a running tool does to the store.
 *
 * Its own file because a tool call has a life of its own: it starts, streams output, and settles —
 * three events that all edit the same record, keyed by call id, long after the reply that asked
 * for it has finished arriving. Folding them in beside the message events made it easy to miss
 * that they are a different clock.
 */

import type { AgentEvent, TodoItem } from "@lyra/core";
import type { AppState } from "./index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

/** Handles `tool_start`, `tool_update` and `tool_end`; anything else is ignored. */
export function applyToolEvent(event: AgentEvent, set: Set, get: Get): void {
  switch (event.type) {
case "tool_start":
    set({
      toolRuns: {
        ...get().toolRuns,
        [event.toolCallId]: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          summary: event.summary,
          args: event.args,
          status: "running",
          startedAt: Date.now(),
        },
      },
    });
    break;

  case "tool_update": {
    const run = get().toolRuns[event.toolCallId];
    if (run)
      set({
        toolRuns: {
          ...get().toolRuns,
          [event.toolCallId]: { ...run, result: event.partial },
        },
      });
    break;
  }

  case "tool_end": {
    const run = get().toolRuns[event.toolCallId];
    set({
      toolRuns: {
        ...get().toolRuns,
        [event.toolCallId]: {
          ...(run ?? {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            summary: event.toolName,
            args: {},
            startedAt: Date.now(),
          }),
          status: event.isError ? "error" : "done",
          result: event.result,
          finishedAt: Date.now(),
        },
      },
    });
    // The task list arrives as the result of writing it; nothing else announces it.
    const written = event.result.details as { kind?: string; todos?: TodoItem[] } | undefined;
    if (!event.isError && written?.kind === "todo" && Array.isArray(written.todos)) {
      set({ todos: written.todos });
    }
    break;
  }
}
}
