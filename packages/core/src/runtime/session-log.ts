/**
 * What a session has written down.
 *
 * The transcript in memory and the append-only log on disk are the same history seen twice, and
 * keeping them together is what stops them disagreeing: every message goes through `commit`, every
 * event that outlives its window goes through `emit`, and neither can be done by reaching past
 * this object.
 *
 * It is also where the two de-duplication rules live, both of which exist because the same thing
 * arrives twice by design rather than by accident.
 */

import type { AgentEvent, AgentEventSink, CommandRun } from "../agent/events.ts";
import type { SessionMeta, SessionRecordInput } from "../session/store.ts";
import type { SessionStorage } from "../session/storage.ts";
import type { Message } from "../types.ts";

/**
 * Events that outlive the window they were shown in.
 *
 * The log is meant to answer "what did the model actually see, and why did it do that" long after
 * the run — so anything that changes the model's input, or that happened out of view, is kept.
 * Token deltas and repeated partial output stay live-only; execution boundaries and nested
 * transcripts survive without bloating the model history.
 */
const PERSISTED_EVENTS = new Set<AgentEvent["type"]>(["command_status", "compacted", "context", "subagent", "subagent_done", "subagent_message", "subagent_event", "agent_start", "agent_end", "turn_start", "tool_start", "request", "approval_request", "retry", "retry_settled", "notice", "rule_triggered"]);

export class SessionLog {
	/**
	 * The transcript, in order, complete. Replaced wholesale only by `restore`.
	 *
	 * Complete even after compaction: what compaction changes is which of these the *model* is
	 * given, never what the session remembers. The window scrolls back through all of it, `recall`
	 * searches all of it, and a later replay of the log is unaffected.
	 */
	messages: Message[] = [];
	commandRuns: CommandRun[] = [];
	meta!: SessionMeta;

	/**
	 * Where the model's view of this session begins, and what stands in for everything before it.
	 *
	 * This is the whole of what makes compaction durable. It used to live in the running loop's own
	 * array and nowhere else, so the next prompt rebuilt its history from `messages` — every
	 * original message, in full — and compacted again from nothing. A conversation could not get
	 * smaller than the log, and the log only grows.
	 *
	 * `keptFrom` indexes into `messages`; `summary` is empty when history was dropped without one,
	 * which is a different thing to say and needs saying.
	 */
	compaction: { summary: string; keptFrom: number; at?: number } | null = null;

	/**
	 * Every place history was summarised, as positions in `messages` — the marks the window draws.
	 *
	 * Not the same thing as `compaction` above, despite the names sitting next to each other.
	 * That one is the model's view: the single newest boundary, because each summary stands in for
	 * the one before it. This is the reader's: every boundary the session has ever crossed, because
	 * scrolling back through a long transcript should show where each one happened.
	 *
	 * Kept here because a running session is read from memory, not from disk. `store.load` rebuilds
	 * the same list while replaying the log, but `snapshot` never opens the log — so without this
	 * the marks vanished the moment a session started running and came back when it stopped, which
	 * is exactly backwards from when a long turn most wants to show them.
	 */
	compactions: number[] = [];

	/**
	 * Messages already appended, tracked by identity.
	 *
	 * A prompt sent while the agent is idle is committed straight away; a steering message is
	 * queued instead and only reaches the transcript when the loop injects it. Both paths end at
	 * `message_end`, so committing there and de-duplicating by identity keeps steering messages in
	 * the log — and in the right position, after the turn they interrupted.
	 */
	private committed = new WeakSet<Message>();
	private readonly nestedCommitted = new Map<string, WeakSet<Message>>();

	/** What the last recorded context looked like, so an unchanged one is not written twice. */
	private lastContext: string | null = null;

	private readonly store: SessionStorage;
	private readonly sink: AgentEventSink;

	// Assigned here rather than as parameter properties: Node's type stripping runs the source
	// as-is and cannot rewrite a constructor parameter into a field.
	constructor(store: SessionStorage, sink: AgentEventSink, meta?: SessionMeta) {
		this.store = store;
		this.sink = sink;
		if (meta) this.meta = meta;
	}

	/** Append a message to the transcript and the log exactly once. */
	async commit(message: Message): Promise<void> {
		if (this.committed.has(message)) return;
		this.committed.add(message);
		this.messages.push(message);
		this.meta = await this.store.append(this.meta, { type: "message", message });
	}

	/**
	 * Send an event on, and write it down if it is one of the few that has to survive.
	 *
	 * What the model was told, what was summarised away, what a sub-agent was sent off to do —
	 * none of it can be recovered from the messages alone, so it is written as it happens.
	 */
	async emit(event: AgentEvent): Promise<void> {
		if (event.type === "subagent_message") {
			let seen = this.nestedCommitted.get(event.id);
			if (!seen) { seen = new WeakSet(); this.nestedCommitted.set(event.id, seen); }
			if (seen.has(event.message)) return;
			seen.add(event.message);
		}
		if (event.type === "command_status") {
			const at = this.commandRuns.findIndex((run) => run.id === event.command.id);
			if (at < 0) this.commandRuns.push(event.command); else this.commandRuns[at] = event.command;
		}
		if (PERSISTED_EVENTS.has(event.type) && this.meta) {
			this.meta = await this.store.append(this.meta, { type: "event", event });
		}
		await this.sink(event);
	}

	/**
	 * Write down what the model is about to be given, the first time it looks like this.
	 *
	 * Returns the prompt so it can wrap the call that produced it — the point is that there is no
	 * way to build a prompt and forget to record it. Unchanged context is not re-recorded: a
	 * hundred-turn run would otherwise carry a hundred copies of the same system prompt.
	 */
	async recordContext(systemPrompt: string, toolNames: string[], skillNames: string[], schemas?: import("../types/tool.ts").ToolSpec[]): Promise<string> {
		const tools = [...toolNames].sort();
		const skills = [...skillNames].sort();
		const fingerprint = `${systemPrompt}\0${tools.join(",")}\0${skills.join(",")}\0${JSON.stringify(schemas)}`;
		if (fingerprint === this.lastContext) return systemPrompt;
		this.lastContext = fingerprint;
		await this.emit({ type: "context", systemPrompt, tools, skills, ...(schemas ? { schemas } : {}) });
		return systemPrompt;
	}

	/**
	 * Append anything else the log carries — a new title, a chosen model.
	 *
	 * The returned meta replaces the one held here, because appending is what advances it.
	 */
	async append(record: SessionRecordInput): Promise<void> {
		this.meta = await this.store.append(this.meta, record);
	}

	/**
	 * Record where history was summarised, so the next turn starts from the summary.
	 *
	 * Takes a count rather than an index because the array compaction worked on is the running
	 * loop's — already compacted, possibly more than once — while the boundary belongs to this log,
	 * which holds every original message. "The last N still apply" is the one statement that means
	 * the same thing in both.
	 */
	markCompaction(summary: string, kept: number): void {
		this.compaction = { at: Date.now(), summary, keptFrom: Math.max(0, this.messages.length - kept) };
		/*
		 * Counted before the `compacted` event is written, which is what keeps this in step with the
		 * list `store.load` builds while replaying: there the mark is `entries.length` at the moment
		 * the event is read back, and every message committed before it is already in both.
		 */
		this.compactions.push(this.messages.length);
	}

	/**
	 * Adopt a history read back from disk.
	 *
	 * These messages are already in the log — that is where they came from — so they are not
	 * committed again, and nothing here is written.
	 */
	restore(messages: Message[], compaction: { summary: string; keptFrom: number; at?: number } | null = null, compactions: number[] = []): void {
		this.messages = messages;
		this.committed = new WeakSet(messages);
		this.compaction = compaction;
		// Positions into the array being adopted, so anything past its end is a mark for messages
		// that are no longer here — a rewound tail, or a log the caller read only part of.
		this.compactions = compactions.filter((at) => at <= messages.length);
	}

	/**
	 * Discard everything from `index` on — in the log first.
	 *
	 * If the run that follows fails, the history is still the shortened, consistent one rather than
	 * a mix of old and new. Null when there was nothing there to cut.
	 */
	async truncateFrom(index: number): Promise<boolean> {
		const truncated = await this.store.truncateFrom(this.meta.projectId, this.meta.id, index);
		if (!truncated) return false;
		this.meta = truncated.meta;
		/*
		 * A rewind past the compaction boundary retires it.
		 *
		 * The boundary says "the model sees the summary, then everything from here on". Cut the
		 * history back to before that point and there is no "from here on" left — the summary would
		 * be standing in for messages that are themselves now gone, and the kept tail it was paired
		 * with no longer exists. Going back to the full history is correct and costs one compaction
		 * next time the window fills.
		 */
		const boundary = this.compaction && index > this.compaction.keptFrom ? this.compaction : null;
		this.commandRuns = this.commandRuns.filter((run) => run.at <= index);
		// The marks live at positions too, so a cut tail takes the ones inside it — same rule as the runs above.
		this.restore(truncated.messages, boundary, this.compactions.filter((at) => at <= index));
		return true;
	}
}
