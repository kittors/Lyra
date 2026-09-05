/**
 * Every sub-agent this session has dispatched, and the handle to the ones still running.
 *
 * Delegated work used to be write-only: `runSubAgent` emitted "started" and "finished" and threw
 * the rest away, so a sub-agent reading forty files was three words on a notice line and then a
 * paragraph of answer. Which is exactly the shape of the problem — the context isolation that makes
 * delegation worth doing is the same thing that makes it opaque, and an agent you cannot see is one
 * you cannot correct.
 *
 * So the registry keeps three things a viewer needs and a live one can act on:
 *
 *   - the transcript, message by message, as it happens;
 *   - enough of a reading (elapsed, tool calls, last activity) to answer "is this stuck?";
 *   - a way in — `steer` puts a message into a running sub-agent, `abort` ends one.
 *
 * `steer` is the same mechanism the main session already uses for a message typed mid-turn: the
 * message is spliced in between the sub-agent's turns, so it reads it with its context intact and
 * carries on rather than starting over. It is deliberately not a second conversation running
 * alongside — one agent, one thread, one thing being asked of it at a time.
 *
 * What this is *not*: a scheduler. `runSubAgent` still owns running the thing, and the parent's
 * `task` call still waits for the answer. This only makes what happens in between visible and
 * reachable.
 */

import { addUsage, emptyUsage, type Message, type Usage } from "../types/message.ts";

/**
 * Where a sub-agent is in its life.
 *
 * Four, and the last three are all terminal — which is the distinction that matters to everything
 * reading this: `running` is the only state you can steer, and the difference between the other
 * three is what the transcript should say happened.
 */
export type SubAgentStatus = "running" | "done" | "failed" | "aborted";

/** What the tab strip and the tip need to describe one sub-agent without opening it. */
export interface SubAgentSummary {
	id: string;
	/** Which definition it is running under — `general`, `explore`, a workspace one. */
	agent: string;
	/** The parent's own 3-5 word summary of what it delegated. */
	description: string;
	status: SubAgentStatus;
	startedAt: number;
	endedAt?: number;
	/** How much it has done, for "is this stuck?" — the question a viewer actually has. */
	toolCalls: number;
	/**
	 * The last thing it did, in the words the tool used to describe itself.
	 *
	 * One line rather than a history: this is for a tip, and a sub-agent that has read thirty files
	 * is thirty lines of "读取文件" that say less than the newest one alone.
	 */
	lastActivity?: string;
	/**
	 * The sub-agent that dispatched this one, by registry id; absent when the main conversation did.
	 *
	 * Enough to draw the lineage: every record names its parent, so the tree is a fold over the
	 * list rather than a second structure to keep in step with it.
	 */
	parentId?: string;
	/** 1 for a sub-agent the main conversation dispatched; each nested dispatch adds one. */
	depth: number;
	/**
	 * Tokens and cost across every request this sub-agent has made, summed as its messages arrive.
	 *
	 * Cost is the brake on orchestration. Fanning out eight sub-agents feels free from the
	 * parent's side — none of their context comes back — and this is where the bill for it shows.
	 */
	usage: Usage;
	/** Set on `done`; the only part the parent ever sees. */
	answer?: string;
	/**
	 * The validated object, when this agent declared an output schema and yielded against it.
	 *
	 * Kept beside the prose rather than instead of it, because they answer different questions:
	 * the text is what a person reads in the pane, and this is what `agent://<id>/<field>` indexes
	 * into so the parent can take one value without re-reading the whole reply.
	 */
	output?: Record<string, unknown>;
	/** Schema problems that were accepted rather than rejected. */
	warnings?: string[];
	/** Set on `failed`. */
	error?: string;
}

/** A summary plus everything it said, for the pane showing one of them. */
export interface SubAgentDetail extends SubAgentSummary {
	messages: Message[];
}

/**
 * One sub-agent's record, and the levers the run itself installs.
 *
 * `steering` and `abort` are set by `runSubAgent` while it is running and cleared when it is not —
 * which is what makes "can this be steered?" a property of the record rather than a guess from
 * `status`.
 */
interface SubAgentRecord extends SubAgentDetail {
	/** Drained by the running loop between turns; see `drainSteering` in `agent/loop.ts`. */
	steering: Message[];
	abort?: () => void;
}

/**
 * How many finished sub-agents are kept.
 *
 * They are worth keeping — the point of the pane is being able to read what a delegated run
 * actually did, and that question is usually asked after it finished. Bounded because a long
 * session can dispatch dozens and each carries its whole transcript; the oldest finished one goes
 * first, and a running one is never retired.
 */
const MAX_KEPT = 24;

export class SubAgentRegistry {
	private readonly records = new Map<string, SubAgentRecord>();
	private readonly onChange: () => void;

	/** `onChange` is how the host learns to re-broadcast; the registry does no IPC of its own. */
	constructor(onChange: () => void = () => {}) {
		this.onChange = onChange;
	}

	/** Newest last, which is the order a tab strip reads in. */
	list(): SubAgentSummary[] {
		return [...this.records.values()].map(({ messages: _messages, steering: _steering, abort: _abort, ...rest }) => rest);
	}

	detail(id: string): SubAgentDetail | null {
		const record = this.records.get(id);
		if (!record) return null;
		const { steering: _steering, abort: _abort, ...rest } = record;
		return rest;
	}

	get running(): number {
		let count = 0;
		for (const record of this.records.values()) if (record.status === "running") count += 1;
		return count;
	}

	/** Called by `runSubAgent` as it starts one. */
	start(input: {
		id: string;
		agent: string;
		description: string;
		abort: () => void;
		parentId?: string;
		/** Defaults to 1: dispatched by the main conversation. */
		depth?: number;
	}): void {
		this.retire();
		this.records.set(input.id, {
			id: input.id,
			agent: input.agent,
			description: input.description,
			status: "running",
			startedAt: Date.now(),
			toolCalls: 0,
			...(input.parentId ? { parentId: input.parentId } : {}),
			depth: input.depth ?? 1,
			usage: emptyUsage(),
			messages: [],
			steering: [],
			abort: input.abort,
		});
		this.onChange();
	}

	/** Everything the sub-agent said, as it says it. */
	record(id: string, message: Message): void {
		const found = this.records.get(id);
		if (!found) return;
		found.messages.push(message);
		// Each assistant message is one request, and arrives once — see `message_end` in `runSubAgent`.
		if (message.role === "assistant") found.usage = addUsage(found.usage, message.usage);
		this.onChange();
	}

	/** One tool call, for the reading a viewer uses to judge progress. */
	activity(id: string, summary: string): void {
		const found = this.records.get(id);
		if (!found) return;
		found.toolCalls += 1;
		found.lastActivity = summary;
		this.onChange();
	}

	finish(
		id: string,
		outcome: {
			status: Exclude<SubAgentStatus, "running">;
			answer?: string;
			error?: string;
			output?: Record<string, unknown>;
			warnings?: string[];
		},
	): void {
		const found = this.records.get(id);
		if (!found) return;
		found.status = outcome.status;
		found.endedAt = Date.now();
		found.answer = outcome.answer;
		found.output = outcome.output;
		found.warnings = outcome.warnings;
		found.error = outcome.error;
		// The levers go with the run: a finished sub-agent must not look steerable.
		found.steering.length = 0;
		found.abort = undefined;
		this.onChange();
	}

	/**
	 * Put a message into a running sub-agent.
	 *
	 * Queued rather than delivered: the loop drains this between turns, so the sub-agent finishes
	 * the step it is on, reads the message with its context intact, and carries on. Interrupting
	 * mid-tool-call would mean abandoning a write half-done, which is a worse answer to "you are
	 * going the wrong way" than arriving one step late.
	 *
	 * Recorded in the transcript on the way past, so the pane shows what was said to it rather than
	 * a reply appearing out of nowhere.
	 */
	steer(id: string, text: string): Message | null {
		const found = this.records.get(id);
		if (!found || found.status !== "running" || !text.trim()) return null;
		const message: Message = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
		found.steering.push(message);
		found.messages.push(message);
		this.onChange();
		/*
		 * Returned, not just recorded, because `onChange` carries the roster and the roster has no
		 * transcripts in it — a window watching this sub-agent would not learn of the message until
		 * it happened to re-read the whole thing. The caller emits it; see `AgentSession.steerSubAgent`.
		 */
		return message;
	}

	/** Emptied by the running loop between turns — see `drainSteering`. */
	drainSteering(id: string): Message[] {
		const found = this.records.get(id);
		if (!found) return [];
		return found.steering.splice(0, found.steering.length);
	}

	/**
	 * Stop one.
	 *
	 * The run's own `finally` is what marks it aborted; this only pulls the trigger, so a sub-agent
	 * that was already finishing is not recorded as killed.
	 */
	abort(id: string): boolean {
		const found = this.records.get(id);
		if (!found || found.status !== "running" || !found.abort) return false;
		found.abort();
		return true;
	}

	/**
	 * Take one off the roster.
	 *
	 * Stopping first is not a convenience, it is the whole of what makes this safe: the record is
	 * the only handle there is. Dropping a running sub-agent would leave it running with nothing
	 * able to reach it — not steerable, not stoppable, still spending tokens and still holding the
	 * parent's `task` call open. So dismissing one that is running stops it, and the row stays until
	 * the run's own teardown files it as aborted; the second dismiss is what removes it.
	 *
	 * Returns what it did, because the two outcomes need different words on screen.
	 */
	dismiss(id: string): "removed" | "stopping" | "unknown" {
		const found = this.records.get(id);
		if (!found) return "unknown";
		if (found.status === "running") {
			found.abort?.();
			return "stopping";
		}
		this.records.delete(id);
		this.onChange();
		return "removed";
	}

	/**
	 * Take every finished one off, leaving whatever is still running.
	 *
	 * What the bar's own dismiss does: the roster is a record of this conversation's delegated work
	 * and at some point you are done reading it. Never touches a running sub-agent — clearing the
	 * list is not a way to stop things.
	 */
	dismissFinished(): number {
		let removed = 0;
		for (const [id, record] of this.records) {
			if (record.status === "running") continue;
			this.records.delete(id);
			removed += 1;
		}
		if (removed > 0) this.onChange();
		return removed;
	}

	/** Everything still running, for a session being torn down. */
	abortAll(): void {
		for (const record of this.records.values()) {
			if (record.status === "running") record.abort?.();
		}
	}

	/** Make room, oldest finished first. A running sub-agent is never retired. */
	private retire(): void {
		while (this.records.size >= MAX_KEPT) {
			let oldest: SubAgentRecord | null = null;
			for (const record of this.records.values()) {
				if (record.status === "running") continue;
				if (!oldest || (record.endedAt ?? record.startedAt) < (oldest.endedAt ?? oldest.startedAt)) oldest = record;
			}
			if (!oldest) return;
			this.records.delete(oldest.id);
		}
	}
}
