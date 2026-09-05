/**
 * Where one row of the transcript ends and the next begins, decided on plain data.
 *
 * The transcript is not the message list. A stretch of tool work is one line however many
 * messages it took, and it has to be the *same* line from the first call to the last. A group
 * that only forms once the model stops talking is a group that appears mid-turn, pushes what is
 * under it down, and then hands its contents to the row above and vanishes — which is what made
 * the transcript move while the agent worked.
 *
 * So the rule here never asks whether a message has finished. It reads what has arrived, and
 * what has arrived only ever grows.
 */

import type { AssistantContent, AssistantMessage, Message, UserContent } from "@lyra/core";

type ToolCallBlock = Extract<AssistantContent, { type: "toolCall" }>;

/** A call together with the state of the message that made it: a call is live only while its turn is. */
export type Call = { block: ToolCallBlock; stopReason: AssistantMessage["stopReason"] };

export type Run =
	| { kind: "compaction" }
	/**
	 * A message, and how much of it is this row's.
	 *
	 * `upTo` is a count of content blocks: everything from there to the end is tool work, which
	 * belongs to the run below rather than to the reply. It is the whole message whenever the
	 * message has no trailing calls, which is most of them.
	 *
	 * `from` is the other end, and is only ever set on the reply the thinking row is showing: its
	 * reasoning is drawn up there, above the work, so the reply's own row starts after it. Without
	 * it the same reasoning would appear twice in one turn, once at each end of the work.
	 *
	 * `turnStats` rides along for assistant rows. It used to be computed where the row is drawn,
	 * which meant a fresh object per render — so `MessageRow`'s memo compared unequal every time
	 * and every visible reply was rebuilt whenever anything re-rendered the transcript. Computed
	 * here it is derived from the messages alone, which is what it is a fact about, and its
	 * identity changes exactly when the transcript does.
	 */
	| { kind: "message"; message: Message; index: number; upTo: number; from?: number; turnStats?: TurnStats; key?: string }
	/**
	 * A stretch of tool work, and whether it is the stretch being worked on right now.
	 *
	 * `live` is set on at most one run in the transcript — see `liveWork` for which. It is a fact
	 * about the shape of the conversation, not about whether the agent is currently running, so the
	 * caller still asks that separately: a run can be the newest work in a turn that has since ended.
	 */
	| { kind: "tools"; calls: Call[]; live?: boolean };

/** The runtime's "carry on" message, recognised by what it says as well as by its flag. */
export function isNudge(message: Message | undefined): boolean {
	if (message?.role !== "user") return false;
	return message.content.some((c) => c.type === "text" && c.text.startsWith("（自动继续）"));
}

/** A split reply has two identities; neither identity changes when more text arrives. */
export function runKey(run: Exclude<Run, { kind: "compaction" }>): string {
	if (run.kind === "tools") return `tools-${run.calls[0].block.id}`;
	return run.key ?? `${run.message.role}-${run.message.timestamp}-${run.index}`;
}

export type TurnStats = {
	durationMs: number;
	sseDurationMs: number;
	outputTokens: number;
	requestCount: number;
};

/**
 * Calculates accumulated turn statistics (total duration in ms, sse output duration in ms, total output tokens, total requests)
 * for the turn that ends at or before `endMessageIndex`.
 *
 * A turn consists of:
 * - Assistant messages (including toolUse calls, intermediate thought steps, and the final response).
 * - Tool result messages and continuation nudges between them.
 * The turn starts immediately after the previous real (non-synthetic, non-nudge) user message.
 */
/** A turn that has spent nothing yet. */
function noStats(): TurnStats {
	return { durationMs: 0, sseDurationMs: 0, outputTokens: 0, requestCount: 0 };
}

/**
 * Add one reply's cost to a running total, and hand back a new object.
 *
 * New rather than mutated: these are handed to a memoised row, and a total that changes in place
 * is one React is entitled to decide has not changed at all.
 */
function accumulate(into: TurnStats, message: AssistantMessage): TurnStats {
	const duration = typeof message.durationMs === "number" && message.durationMs > 0 ? message.durationMs : 0;
	const sse = typeof message.sseDurationMs === "number" && message.sseDurationMs > 0 ? message.sseDurationMs : 0;
	const output = typeof message.usage?.output === "number" && message.usage.output > 0 ? message.usage.output : 0;
	return {
		durationMs: into.durationMs + duration,
		// Fallback when sseDurationMs was not recorded (e.g. older messages on disk).
		sseDurationMs: into.sseDurationMs + (sse || duration),
		outputTokens: into.outputTokens + output,
		requestCount: into.requestCount + 1,
	};
}

/**
 * The wordings 「继续」 sends, which are the same act as an automatic nudge.
 *
 * Exported and imported by `ResumeRow` rather than written out twice: two copies of a sentence
 * that has to match exactly is a mismatch waiting for the day somebody improves the wording.
 */
export const CARRY_ON_PROMPTS = [
	"继续，从暂停的地方接着做。",
	"继续，从中断的地方接着做。",
	"继续，把清单里没做完的做完。",
] as const;

/** The text of a user message, joined. */
function userText(message: Message): string {
	if (message.role !== "user") return "";
	return message.content
		.filter((c): c is Extract<UserContent, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

/**
 * Whether this message is picking up a turn that stopped, rather than beginning one.
 *
 * Pressing 继续 after a failure is not a new question — it is the same piece of work, carried on
 * across the break. Counting it as a new turn is what made the timings meaningless: a task that
 * took twenty minutes and was interrupted twice reported the length of its last leg, and the tokens
 * of its last leg, so neither the elapsed time nor the tokens-per-second described anything that
 * actually happened.
 *
 * Only when the reply before it actually stopped. The same sentence typed into a conversation that
 * ended normally is a new instruction and starts a new turn, which is the honest reading of it.
 */
function resumesTurn(messages: Message[], index: number): boolean {
	const message = messages[index];
	if (!message || message.role !== "user") return false;
	if (!CARRY_ON_PROMPTS.includes(userText(message) as (typeof CARRY_ON_PROMPTS)[number])) return false;
	for (let i = index - 1; i >= 0; i--) {
		const previous = messages[i];
		if (previous.role === "toolResult") continue;
		if (previous.role !== "assistant") return false;
		// The two ways a reply stops short: it failed, or it was stopped. Both leave work unfinished
		// and are what 继续 exists to pick up.
		return previous.stopReason === "error" || previous.stopReason === "aborted";
	}
	return false;
}

/** Whether this message is a person starting a turn, rather than the runtime keeping one going. */
function opensTurn(message: Message): boolean {
	return message.role === "user" && !message.synthetic && !isNudge(message);
}

export function computeTurnStats(messages: Message[], endMessageIndex: number): TurnStats {
	// Walk backwards from endMessageIndex until we hit a real user message or index 0
	let startIndex = 0;
	for (let i = endMessageIndex; i >= 0; i--) {
		// A 继续 after a failure belongs to the turn it is continuing, so the walk goes on past it
		// to the question that actually started the work.
		if (opensTurn(messages[i]) && !resumesTurn(messages, i)) {
			startIndex = i + 1;
			break;
		}
	}

	let stats = noStats();
	for (let i = startIndex; i <= endMessageIndex && i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "assistant") stats = accumulate(stats, msg);
	}
	return stats;
}

/**
 * How far into a reply the model was still addressing you.
 *
 * Counted to the end of the last block of actual text. Everything after it is the model working,
 * and work joins the work around it — the sentence that introduces a batch of calls and the calls
 * themselves are one thought, and the next batch continues it. Text is the one thing that ends a
 * run, because that is the model stopping to say something and a group must not swallow it.
 *
 * Whether the message is still streaming is deliberately not consulted. That answer changes
 * halfway through a turn, and any grouping derived from it changes with it.
 */
/** Whether any reasoning has arrived — the live ticker's reason to have a row. */
function reasoning(content: AssistantContent[]): boolean {
	return content.some((block) => block.type === "thinking" && block.thinking.length > 0);
}

/**
 * Which reply's reasoning the thinking row shows, or -1 for none.
 *
 * Not simply the last reply's. A reply begins as an empty message, and its reasoning follows a
 * beat later — with a real model, often several hundred milliseconds later. Keyed to the last
 * reply, the row emptied for exactly that beat at the start of every reply in the turn: the
 * previous reasoning gone, the next not yet there, and everything below it flinching up and
 * back. So the row shows the newest reasoning the turn actually has, walking back from the
 * last reply past any that have none yet.
 *
 * The walk stops at the start of the turn (a real user message; the runtime's own are passed
 * over), at a reply that has said something, and at a finished reply with no calls (that one
 * has a row of its own already).
 */
function liveReasoning(messages: Message[], live: number): number {
	if (live < 0) return -1;
	const last = messages[live];
	if (last.role !== "assistant") return -1;
	/*
	 * The answer has started, and the reasoning that produced it stays where it is.
	 *
	 * This used to give up here. That was right while the row sat *under* the work: the answer
	 * lands in the same place, so it took the row's position over and nothing moved. Above the
	 * work there is no such handover — withdrawing the row would pull everything below it up by
	 * a line at the exact moment the reader is watching the answer arrive. So the turn keeps its
	 * one thinking row until the turn itself is over, and `runs` gives the reply's own row a
	 * `from` so the reasoning is not drawn a second time underneath.
	 */
	if (spoken(last.content) > 0) return leadingThinking(last.content) > 0 ? live : -1;
	for (let at = live; at >= 0; at--) {
		const message = messages[at];
		if (message.role === "user") {
			if (message.synthetic || isNudge(message)) continue;
			return -1;
		}
		if (message.role !== "assistant") continue;
		if (spoken(message.content) > 0) return -1;
		const calls = message.content.some((block) => block.type === "toolCall");
		if (reasoning(message.content) && (calls || message.stopReason === "pending")) return at;
		if (!calls && message.stopReason !== "pending") return -1;
	}
	return -1;
}

/**
 * The run of tool work being pushed forward right now, or -1 for none.
 *
 * Not "the last run in the transcript", which is what this used to be and is a different claim
 * entirely. The two agree for as long as a turn keeps calling tools, and part company the moment
 * you ask something else: the newest run is then a piece of finished work from the turn before,
 * and calling it current lit it back up — a line describing work that ended minutes ago, gliding
 * for the whole of a reply that never touched a tool.
 *
 * So it is answered from the replies rather than from the rows. Walking back from the newest one:
 *
 * - a reply that made calls is the answer, and the row those calls landed in is the run;
 * - a reply that has *said* something and made no calls ends the search — the answer is being
 *   written, and the work above it is over;
 * - a reply that has done neither yet is passed over, which is the beat between `message_start`
 *   and the first block of a new reply. Stopping there would drop the highlight for a few hundred
 *   milliseconds between every batch of a turn, which reads as a flicker rather than as an end;
 * - anything the person actually said ends the search. Their question is the boundary: whatever
 *   was done before it belongs to what they asked before it.
 *
 * Where the walk *starts* is what separates two transcripts that look identical — a person's
 * message at the end, a reply before it. If that reply is still `pending` the message is
 * steering typed into a turn that is running, and the work it is doing goes on; if it has settled,
 * the message is a new question and there is nothing in flight to point at.
 */
function liveWork(messages: Message[], live: number, rowOfCalls: Map<number, number>): number {
	if (live < 0) return -1;
	const latest = messages[live];
	const inFlight = latest.role === "assistant" && latest.stopReason === "pending";
	for (let at = inFlight ? live : messages.length - 1; at >= 0; at--) {
		const message = messages[at];
		if (message.role === "user") {
			// The runtime's own messages are not the person speaking; see `opensTurn`.
			if (message.synthetic || isNudge(message)) continue;
			return -1;
		}
		// A tool result is the contents of a card, not a step of its own.
		if (message.role !== "assistant") continue;
		const row = rowOfCalls.get(at);
		if (row !== undefined) return row;
		if (spoken(message.content) > 0) return -1;
	}
	return -1;
}

/**
 * How many blocks at the front are reasoning — the thinking row's whole content.
 *
 * Counted from the front rather than "everything before the first call", which is the same answer
 * for a reply that thinks and then works and a different one for a reply that has already spoken:
 * the looser reading would put the prose in the thinking row as well as in the reply's own.
 */
function leadingThinking(content: AssistantContent[]): number {
	let count = 0;
	for (const block of content) {
		if (block.type !== "thinking") break;
		count++;
	}
	return count;
}

function spoken(content: AssistantContent[]): number {
	let end = 0;
	for (const [index, block] of content.entries()) {
		if (block.type === "text" && block.text.trim()) end = index + 1;
	}
	return end;
}

/**
 * Whether a drawn run has anything new to show — the memo comparison behind `ToolRun`.
 *
 * It lives here, in a file the tests can load, rather than inline in the component. That is not
 * tidiness: the rule this guards was verified twice against a *copy* of itself written into the
 * test, and a copy agrees with whatever it was copied from, including the mistakes. The component
 * cannot be imported by the unit tests at all (they strip types, they do not compile JSX), so the
 * only way for a test to check the real comparison is for the real comparison to be plain data.
 *
 * Structural on purpose: `runs` is a store type, and nothing in this file should know about the
 * store. Identity is all that is asked of it.
 *
 * Returns true when React may skip the render.
 */
export function sameRun(
	before: { calls: Call[]; live?: boolean; runs?: object },
	after: { calls: Call[]; live?: boolean; runs?: object },
): boolean {
	if (before.live !== after.live) return false;
	// Injected records are rebuilt whenever their transcript grows, and a new map is the only sign
	// that a call in this group has finished — nothing there subscribes to them.
	if (before.runs !== after.runs) return false;
	if (before.calls.length !== after.calls.length) return false;
	return before.calls.every(
		(call, i) => call.block.id === after.calls[i].block.id && call.stopReason === after.calls[i].stopReason,
	);
}

/**
 * A message list, as rows.
 *
 * `compactions` are indices into `messages`: the marker goes where the summary was taken, not at
 * the end, because everything above it is a summary as far as the model is concerned.
 */
export function runs(messages: Message[], compactions: { at: number }[] = []): Run[] {
	const out: Run[] = [];
	// Sorted so the marks can be consumed in order as the transcript is walked.
	const marks = [...compactions].map((c) => c.at).sort((a, b) => a - b);
	let nextMark = 0;
	/** The reply being made, if one is: the last assistant message, whatever state it is in. */
	let live = -1;
	for (let at = messages.length - 1; at >= 0 && live < 0; at--) {
		if (messages[at].role === "assistant") live = at;
	}
	const reasoningRow = liveReasoning(messages, live);

	/**
	 * Which row each reply's calls ended up in.
	 *
	 * A run gathers calls from several replies, so "the row this reply is working in" is not
	 * something the rows can be asked afterwards — it is only known here, as they are placed.
	 * `liveWork` walks back through the replies and reads it off.
	 */
	const rowOfCalls = new Map<number, number>();

	/** Extend the run this lands in, or start one. Empty batches leave the transcript alone. */
	const work = (calls: Call[], from: number) => {
		if (calls.length === 0) return;
		const last = out[out.length - 1];
		if (last?.kind === "tools") last.calls.push(...calls);
		else out.push({ kind: "tools", calls });
		rowOfCalls.set(from, out.length - 1);
	};

	/*
	 * What the turn in progress has spent, carried down the transcript as it is walked.
	 *
	 * The same answer `computeTurnStats` gives, arrived at in one pass instead of one backward
	 * scan per row. On a session of several thousand messages that difference is the whole cost:
	 * the scan was being run for every visible reply, on every render of the transcript.
	 */
	let turn = noStats();

	for (const [index, message] of messages.entries()) {
		while (nextMark < marks.length && marks[nextMark] === index) {
			out.push({ kind: "compaction" });
			nextMark++;
		}

		// A person speaking starts a new turn; the runtime's own messages continue the one running.
		if (opensTurn(message) && !resumesTurn(messages, index)) turn = noStats();

		/*
		 * Tool results are not entries in the transcript; they are the contents of a card.
		 *
		 * This is what kept the runs from ever forming. Every call is answered by a `toolResult`
		 * message, and treating those as ordinary messages put one between every pair of calls —
		 * so a run of seven arrived as seven runs of one. They render nothing on their own, so
		 * passing over them changes only the grouping.
		 */
		if (message.role === "toolResult") continue;

		/*
		 * The runtime talking to the model is invisible, including the fact that it happened —
		 * so it must not divide what it sits between. The work either side of a nudge is one
		 * continuous stretch, and a row drawn through the middle of it would break the run in
		 * two at a line nobody can see.
		 *
		 * A rule correction is the exception, and it is not machinery. It cut the reply off and
		 * made the model start again, so the two halves either side of it are *not* one continuous
		 * stretch — hiding the seam leaves a transcript where the model appears to have changed
		 * its mind unprompted, which is the one thing a reader needs explained.
		 */
		if (message.role === "user" && (message.synthetic || isNudge(message)) && !message.ruleMatch) continue;

		if (message.role !== "assistant") {
			out.push({ kind: "message", message, index, upTo: message.content.length });
			continue;
		}

		turn = accumulate(turn, message);

		const said = spoken(message.content);
		const calls: Call[] = [];
		for (const block of message.content.slice(said)) {
			if (block.type === "toolCall") calls.push({ block, stopReason: message.stopReason });
		}

		if (said > 0) {
			// `from` is set afterwards, and only if the reasoning above this actually got a row of
			// its own — which is not known until the whole transcript has been walked.
			out.push({ kind: "message", message, index, upTo: said, turnStats: turn });
		} else if (calls.length === 0 && message.stopReason !== "pending") {
			/*
			 * Nothing said, nothing done, and the turn is over.
			 *
			 * What is left is reasoning, or a failure with no output — this message's only chance
			 * to show it, so it gets a row. The same message still streaming is handled below.
			 */
			out.push({ kind: "message", message, index, upTo: message.content.length, turnStats: turn });
		}

		work(calls, index);
	}

	// A compaction recorded after the last message still belongs at the end.
	while (nextMark < marks.length) {
		out.push({ kind: "compaction" });
		nextMark++;
	}

	/*
	 * Marked before the thinking row is placed, because placing it moves the rows below it.
	 *
	 * Rows are only ever appended by the walk above, so the indices `work` recorded still point
	 * where they did — and the answer depends on the whole transcript, which is not known until
	 * that walk is done.
	 */
	let working = liveWork(messages, live, rowOfCalls);

	/*
	 * What this turn is thinking, above the work it is driving.
	 *
	 * One row for the whole turn, in one place. A reply's reasoning is never given a row of its own
	 * once it is done — a turn of thirty calls would be thirty lines of thinking with a run between
	 * each — so the turn shows its newest reasoning and nothing else. `liveReasoning` picks which.
	 *
	 * Anchored to the run this turn's work is in rather than to the reply the reasoning came from.
	 * Those are the same place while the turn works, and they part company at the end: the reply
	 * that finally speaks has no calls of its own, so anchoring to it would drop the row back under
	 * the work for the last stretch of the turn — a jump at the moment the answer arrives. Anchored
	 * to the run, the row does not move from the first call to the last word.
	 *
	 * Placed after the walk rather than during it, so a call from a newer reply still joins the run
	 * above it, and a message the user sends mid-turn still comes after the row.
	 */
	if (reasoningRow >= 0) {
		const shown = messages[reasoningRow] as AssistantMessage;
		const think = leadingThinking(shown.content);
		const work = turnWork(messages, live, rowOfCalls);
		const own = out.findIndex((row) => row.kind === "message" && row.index === reasoningRow);
		/*
		 * Only when there is work for it to stand in front of, or nothing else to show it.
		 *
		 * A turn that answered without touching a tool has its reasoning and its answer next to each
		 * other already; splitting them there would spend a row and a margin to change nothing.
		 */
		if (think > 0 && (work >= 0 || own < 0)) {
			const at = work >= 0 ? work : out.length;
			let start = live;
			while (start > 0 && !opensTurn(messages[start])) start--;
			out.splice(at, 0, {
				kind: "message", message: shown, index: reasoningRow, upTo: think, turnStats: turn,
				key: `thinking-${messages[start].timestamp}-${start}`,
			});
			if (working >= at) working += 1;
			// And the reply's own row now starts after the reasoning drawn above. See `Run.from`.
			if (own >= 0) {
				const row = out[own >= at ? own + 1 : own];
				if (row.kind === "message") row.from = think;
			}
		}
	}

	if (working >= 0) {
		const row = out[working];
		if (row.kind === "tools") row.live = true;
	}
	return out;
}

/**
 * The row this turn's tool work is in, whether or not the turn is still pushing it forward.
 *
 * `liveWork` answers a different question — which run is *being worked on* — and gives up as soon
 * as a reply has spoken, because nothing should glide once the answer is being written. The
 * thinking row needs the run either way: it sits above the work for the whole turn, including the
 * part of it spent writing the answer.
 *
 * Walked back from the last reply and stopped by anything a person actually said, so a turn that
 * has done no work of its own never attaches its reasoning to the run above someone else's
 * question. The runtime's own messages are not a person speaking; see `opensTurn`.
 */
function turnWork(messages: Message[], live: number, rowOfCalls: Map<number, number>): number {
	for (let at = live; at >= 0; at--) {
		const message = messages[at];
		if (message.role === "user") {
			if (message.synthetic || isNudge(message)) continue;
			return -1;
		}
		if (message.role !== "assistant") continue;
		const row = rowOfCalls.get(at);
		if (row !== undefined) return row;
	}
	return -1;
}
