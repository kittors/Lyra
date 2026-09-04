import type { AssistantMessage, Message, StreamEvent, ToolResult, ToolResultMessage } from "../types.ts";
import type { SubAgentSummary } from "../runtime/sub-agents.ts";

/**
 * Everything the UI needs to render a live session. The desktop renderer, the mobile app
 * and the session log all consume this one event type.
 */
export type AgentEvent =
	| { type: "agent_start"; sessionId: string }
	| { type: "turn_start"; turn: number }
	| { type: "message_start"; message: Message }
	| { type: "message_update"; message: AssistantMessage; delta: StreamEvent }
	| { type: "message_end"; message: Message }
	| { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown>; summary: string }
	| { type: "tool_update"; toolCallId: string; partial: ToolResult }
	| { type: "tool_end"; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }
	| {
			type: "approval_request";
			requestId: string;
			toolCallId: string;
			kind: string;
			title: string;
			detail: string;
			/** The asker's own sentence on why — the model's words when it is requesting an escalation. */
			reason?: string;
			/** What an "always" answer would be remembered against, so the prompt can say so. */
			subject: string;
		}
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	/** `stalled`: the turn kept making the same call for the same answer and was stopped. */
	| { type: "agent_end"; reason: "done" | "aborted" | "error" | "max_turns" | "stalled"; error?: string }
	| { type: "notice"; level: "info" | "warn" | "error"; message: string }
	/**
	 * A rule matched the model's output and the turn was restarted.
	 *
	 * Carries what matched as well as which rule, because the useful question when a rule fires is
	 * not "which rule" but "on what" — a pattern written too broadly is only visible next to the
	 * text it caught.
	 */
	| {
			type: "rule_triggered";
			rules: {
				name: string;
				path: string;
				excerpt: string;
				source: "text" | "thinking" | "tool";
				toolName?: string;
				/** True when the turn was not interrupted and the reminder rides the next one. */
				deferred?: boolean;
			}[];
	  }
	/**
	 * A correction the runtime thinks could become a rule.
	 *
	 * Emitted after a turn, never during one. The offer is not part of the work, and a choice
	 * presented mid-action is one people dismiss to get it out of the way.
	 */
	| {
			type: "rule_suggested";
			name: string;
			body: string;
			condition?: string;
			scope?: string;
	  }
	/**
	 * 磁盘上的技能、规则或子代理定义变了，这个会话已经重新读过了。
	 *
	 * 说清楚变了什么，而不只是「有变化」：一次 `git checkout` 会换掉半个目录，一句
	 * 「能力已更新」对着那种情况说了等于没说。数字是重载前后的差，所以「改了一个文件的内容」
	 * 三个数都是 0——那也是对的，因为改的确实不是名单。
	 */
	| {
			type: "capabilities_changed";
			skills: number;
			rules: number;
			agents: number;
			/** 新出现的名字，最多几个，给通知用。 */
			added: string[];
	  }
	/**
	 * What the model was given at the start of a turn.
	 *
	 * The transcript records what the model said; this records what it was told — the system
	 * prompt, the tools it could reach, the skills it knew about. Without it a session cannot be
	 * read back honestly: the same messages produce different behaviour under a different prompt
	 * or a different tool set, and nothing in the log would say which one was in force.
	 *
	 * Written when it changes rather than every turn, because it rarely changes and a log that
	 * repeats itself is one nobody reads.
	 */
	| { type: "context"; systemPrompt: string; tools: string[]; skills: string[] }
	/**
	 * A sub-agent was dispatched, and what came back.
	 *
	 * The parent's transcript shows the `task` call and the paragraph it returned — which is the
	 * point of delegation, and also the problem: the work itself happened somewhere the log could
	 * not see. Recording the dispatch (which definition, which tools, what it was asked) and the
	 * steps it took makes a delegated turn as readable afterwards as one done in the open.
	 *
	 * Steps are summaries, not transcripts. A sub-agent exists so its forty file reads stay out of
	 * the parent context; copying them into the parent log would give that back with interest.
	 */
	| { type: "subagent"; id: string; agent: string; description: string; prompt: string; tools: string[] }
	/**
	 * One message from inside a sub-agent, as it is written.
	 *
	 * Delegated work used to be write-only — dispatched, then a paragraph of answer — which is the
	 * shape of the problem: the context isolation that makes delegation worth doing is what makes
	 * it opaque, and a run you cannot see is one you cannot correct. These carry the sub-agent's
	 * own id and are never written to the session log; the parent's transcript is unchanged by
	 * anyone watching one.
	 */
	| { type: "subagent_message"; id: string; message: Message }
	/**
	 * The whole roster changed — one started, finished, made a tool call, or was steered.
	 *
	 * A list rather than a diff: it is a dozen rows at most, it is sent only when something
	 * actually moved, and a window that has been away is correct on the first one it receives
	 * instead of having to have seen every event since it left.
	 */
	| { type: "subagents"; agents: SubAgentSummary[] }
	| { type: "subagent_done"; id: string; steps: string[]; answer: string }
	/**
	 * History was summarised to fit the window.
	 *
	 * Its own event rather than a notice, because it is a fact about the conversation that
	 * outlives the moment: everything before it is a summary now, and someone reading the
	 * transcript later needs to know that. Notices are transient by design and this is not.
	 *
	 * It carries the summary and the boundary because this event *is* where compaction is stored.
	 * Before, it recorded only that compaction had happened and the summary lived in the running
	 * loop's own array — so the next prompt rebuilt its history from the log, got every original
	 * message back, and compacted again. A conversation could not get smaller than the log, which
	 * only grows: that is the whole of "stuck at 80%, compacting every turn".
	 *
	 * `kept` counts the real messages that survived, newest-first, so the boundary can be resolved
	 * against the log rather than against the loop's array — the two are not the same once a run
	 * has compacted, and an index into one is meaningless in the other.
	 */
	| { type: "compacted"; before: number; after: number; summary?: string; kept?: number }
	/**
	 * The connection dropped and the turn is being retried.
	 *
	 * Its own event rather than a notice, because it describes what this turn is doing right now
	 * — the same class of fact as "thinking" or "running a tool" — and belongs beside the turn
	 * rather than in the corner of the window with things that outlive it. It also expires on its
	 * own: once the turn is over, whether it was retried is history nobody needs.
	 *
	 * `resume` marks the far rarer kind: not a request being sent again, but a turn being picked
	 * back up after every retry inside it was already spent. The difference is worth carrying
	 * because it is the difference the person waiting cares about — one is a hiccup measured in
	 * seconds, the other means the turn ended and the work is being resumed from the transcript.
	 * It also arrives *after* `agent_end`, which is the one thing a client must not read as "so
	 * nothing is running".
	 */
	| { type: "retry"; attempt: number; delayMs: number; reason: string; resume?: boolean }
	/**
	 * The session got its name from the first prompt.
	 *
	 * Announced rather than left for the next list refresh: the title is set the instant the
	 * first message lands, but clients only re-read the session index when a turn ends, so the
	 * sidebar sat on "New session" for the whole first reply.
	 */
	| { type: "title"; title: string }
	/**
	 * History was rewritten: keep the first `messageCount` messages and drop the rest.
	 *
	 * Sent when a message is edited. Clients cannot infer this from the messages that follow —
	 * the replacement looks like an ordinary new message — so the discard is announced.
	 */
	| { type: "rewound"; messageCount: number }
	/**
	 * The task queue changed.
	 *
	 * Carries the whole queue rather than a delta. It is a handful of short entries, and a
	 * client that missed one event would otherwise hold a queue that is quietly wrong — the
	 * one thing a "what is it going to do next" list must never be.
	 */
	| { type: "tasks"; tasks: QueuedTask[] };

/**
 * Work handed to a session from somewhere other than its own composer.
 *
 * The side chat has no tools: it cannot touch the workspace itself. When it decides something
 * needs doing, it queues it here and the main session runs it after whatever it is already
 * doing. One executor per workspace, so two agents can never fight over the same files.
 */
export interface QueuedTask {
	id: string;
	/** What to do, phrased as an instruction — this becomes the prompt verbatim. */
	text: string;
	origin: "side-chat";
	status: "queued" | "running" | "done" | "failed" | "cancelled";
	createdAt: number;
	startedAt?: number;
	finishedAt?: number;
	/** Why it failed, when it did. */
	error?: string;
	/**
	 * Who cancelled it, because the two cases mean opposite things to the person watching.
	 *
	 * `user` is the withdraw button: you took it back, you know what happened, and the row saying
	 * 「已取消」 afterwards is a receipt for a decision you just made.
	 *
	 * `stop` is the task going down with the main session — pressing pause there cancels whatever it
	 * was running, this included. That one has to be said. A task dispatched from the side chat,
	 * shown as running, and then simply gone from the list because the main conversation was paused
	 * reads as the work having been lost.
	 */
	cancelledBy?: "user" | "stop";
}

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;
