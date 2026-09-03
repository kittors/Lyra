/**
 * The tool records for a delegated run, rebuilt from its own transcript.
 *
 * The main conversation's cards look themselves up in the app store, which is filled by
 * `tool_start` / `tool_end` as they arrive. A sub-agent's never get there: `runSubAgent` emits the
 * messages it produced and nothing else, deliberately — a delegated run that read forty files
 * would otherwise put forty tool events on the parent's wire for work the parent did not do.
 *
 * So the records are derived instead, from what the transcript already says: a call is running
 * from the reply that made it until its result arrives, and the result says how it ended. Without
 * this the cards find no record, fall back to "the turn is over, so the call must have failed",
 * and a panel full of successful work is drawn entirely in red.
 */

import type { Message } from "@lyra/core";
import { summarizeToolCall } from "../../lib/tool-summary.ts";
import type { ToolRun } from "../../store/index.ts";

export function subAgentRuns(messages: Message[]): Record<string, ToolRun> {
	const records: Record<string, ToolRun> = {};
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				records[block.id] = {
					toolCallId: block.id,
					toolName: block.name,
					summary: summarizeToolCall(block.name, block.arguments),
					args: block.arguments,
					status: "running",
					startedAt: message.timestamp,
				};
			}
		} else if (message.role === "toolResult") {
			const record = records[message.toolCallId];
			// A result for a call that was never announced belongs to no card, and inventing a record
			// for it would draw one that the transcript above does not contain.
			if (!record) continue;
			record.status = message.isError ? "error" : "done";
			record.result = {
				content: message.content,
				details: message.details,
				isError: message.isError,
			};
			record.finishedAt = message.timestamp;
		}
	}
	return records;
}
