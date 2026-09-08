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

import { translate } from "../../i18n/translate.ts";
import type { AssistantContent, AssistantMessage, CommandRun, Message, UserContent } from "@lyra/core";
import { CARRY_ON_PROMPTS } from "../../store/derive.ts";
import type { Hiccup } from "../../lib/hiccup.ts";

type ToolCallBlock = Extract<AssistantContent, { type: "toolCall" }>;

/** A call together with the state of the message that made it: a call is live only while its turn is. */
export type Call = { block: ToolCallBlock; stopReason: AssistantMessage["stopReason"] };

export type Run =
	| { kind: "compaction" }
	| { kind: "command"; command: CommandRun }
	/** 连接抖了一下，画在它抖的那个位置上。见 `lib/hiccup.ts` 的 `at`。 */
	| { kind: "hiccup"; hiccup: Hiccup }
	/**
	 * A message, and how much of it is this row's.
	 *
	 * `upTo` is a count of content blocks: everything from there to the end is tool work, which
	 * belongs to the run below rather than to the reply. It is the whole message whenever the
	 * message has no trailing calls, which is most of them.
	 *
	 * `from` is the other end, and is set on a reply whose opening reasoning got a row of its own
	 * just above: the prose row starts after it, so the same reasoning is not drawn twice. Both
	 * rows are the same message, which is why `lead` exists — the timestamp, the delivery card and
	 * the copy button belong to the reply, not to the reasoning in front of it.
	 *
	 * `turnStats` rides along for assistant rows. It used to be computed where the row is drawn,
	 * which meant a fresh object per render — so `MessageRow`'s memo compared unequal every time
	 * and every visible reply was rebuilt whenever anything re-rendered the transcript. Computed
	 * here it is derived from the messages alone, which is what it is a fact about, and its
	 * identity changes exactly when the transcript does.
	 */
	| { kind: "message"; message: Message; index: number; upTo: number; from?: number; lead?: boolean; newest?: boolean; turnStats?: TurnStats; key?: string }
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
	return message.content.some((c) => c.type === "text" && c.text.startsWith(translate("grouping.autoContinue")));
}

/** A split reply has two identities; neither identity changes when more text arrives. */
export function runKey(run: Exclude<Run, { kind: "compaction" }>): string {
	if (run.kind === "command") return `command-${run.command.id}`;
	if (run.kind === "hiccup") return `hiccup-${run.hiccup.id}`;
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

/*
 * The sentences 「继续」 sends live in `store/derive.ts`, next to the stop reasons that choose
 * between them — three places need them now (this file to recognise them, the row under the
 * transcript and the composer's button to send them), and only one of the three is here.
 */

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

/**
 * Whether the opening reasoning has any words in it yet.
 *
 * A reply announces its reasoning block before the first token of it arrives, and a row for an
 * empty one is a margin with nothing in it — drawn under the work of a turn that is between
 * batches, then filled a moment later. Waiting costs nothing: the row appears at the bottom of
 * the transcript, where appearing pushes nothing down.
 */
function written(content: AssistantContent[], think: number): boolean {
	for (let at = 0; at < think; at++) {
		const block = content[at];
		if (block.type === "thinking" && block.thinking.length > 0) return true;
	}
	return false;
}

/**
 * Where the reply's trailing run of calls begins — everything before it is the reply's own row.
 *
 * Counted back from the end rather than forward from the last sentence. The two agree for the
 * common shape (think, speak, call) and part company when a model goes back to reasoning after
 * speaking: measured from the sentence, that closing reasoning fell outside every row and was
 * drawn nowhere at all.
 */
function beforeTrailingCalls(content: AssistantContent[]): number {
	let end = content.length;
	while (end > 0 && content[end - 1].type === "toolCall") end--;
	return end;
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
export function runs(messages: Message[], compactions?: { at: number }[]): Exclude<Run, { kind: "command" } | { kind: "hiccup" }>[];
export function runs(messages: Message[], compactions: { at: number }[], commands: CommandRun[], hiccups?: Hiccup[]): Run[];
export function runs(messages: Message[], compactions: { at: number }[] = [], commands: CommandRun[] = [], hiccups: Hiccup[] = []): Run[] {
	const out: Run[] = [];
	// Sorted so the marks can be consumed in order as the transcript is walked.
	const marks = [...compactions].map((c) => c.at).sort((a, b) => a - b);
	let nextMark = 0;
	const commandMarks = [...commands].sort((a, b) => a.at - b.at);
	let nextCommand = 0;
	/*
	 * 断线也是一个标记，和上面两种一样按位置插。
	 *
	 * 它们从前一律画在转录最下面、运行指示器底下，于是一轮跑四十分钟、中间断过两次又接上的那句
	 * 「重连 2 次后恢复」贴在最后一行 loading 下面——说的是某个时刻的事，站的却是「此刻」的位置。
	 * 断线是这段工作当中的一件事，就该待在它发生的那一段旁边。见 `lib/hiccup.ts` 的 `at`。
	 */
	const hiccupMarks = [...hiccups].sort((a, b) => a.at - b.at);
	let nextHiccup = 0;
	/** The reply being made, if one is: the last assistant message, whatever state it is in. */
	let live = -1;
	for (let at = messages.length - 1; at >= 0 && live < 0; at--) {
		if (messages[at].role === "assistant") live = at;
	}
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
		// Commands are visible boundaries, including between an interrupted tool run and its resume.
		while (nextCommand < commandMarks.length && commandMarks[nextCommand].at <= index) {
			out.push({ kind: "command", command: commandMarks[nextCommand++] });
		}
		while (nextHiccup < hiccupMarks.length && hiccupMarks[nextHiccup].at <= index) {
			out.push({ kind: "hiccup", hiccup: hiccupMarks[nextHiccup++] });
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

		const think = leadingThinking(message.content);
		const own = beforeTrailingCalls(message.content);
		const calls: Call[] = [];
		for (const block of message.content.slice(own)) {
			if (block.type === "toolCall") calls.push({ block, stopReason: message.stopReason });
		}

		/*
		 * The reasoning that opens a reply gets a row of its own, where it was written.
		 *
		 * One row per stretch of reasoning, in the order the model produced it, so a turn reads
		 * think, work, think, work — the shape it actually ran in. This used to be a single row
		 * for the whole turn, holding only the newest reasoning and pinned above the work: every
		 * thought a turn had before its last one was never drawn at all, which on a long turn is
		 * nearly all of them.
		 *
		 * Pushing it here is also what keeps the work below from swallowing it. `work` only ever
		 * extends a run that is still the last row, so a reasoning row landing between two batches
		 * is exactly what ends the first and starts the second.
		 */
		if (think > 0 && written(message.content, think)) {
			out.push({
				kind: "message", message, index, upTo: think,
				/*
				 * A lead-in only when the reply has a row of its own below this one.
				 *
				 * Otherwise this row is the whole message, and what belongs to the message —
				 * a failure, the delivery card — belongs to it. A dropped connection during the
				 * reasoning is exactly that case, and it is the one where the failure has to show.
				 */
				lead: own > think || undefined,
				/*
				 * The newest reasoning in the transcript, which is the only one that can be arriving.
				 *
				 * `stopReason` cannot answer this on its own. A provider that batches — a relay
				 * flushing a whole block at once — delivers the reasoning and the call that follows
				 * it in the same breath, so the message has already settled by the first render and
				 * a line with four hundred characters in it appears fully written. That is the case
				 * the typing exists for, and the case the reply's own state cannot see.
				 */
				newest: index === live || undefined,
				// Its own identity, distinct from the prose row of the same message. See `runKey`.
				key: `thinking-${message.timestamp}-${index}`,
			});
		}

		if (own > think) {
			out.push({ kind: "message", message, index, upTo: own, from: think, turnStats: turn });
		} else if (think === 0 && calls.length === 0 && message.stopReason !== "pending") {
			/*
			 * Nothing thought, nothing said, nothing done, and the turn is over: a failure with no
			 * output. This message's only chance to show it, so it gets a row.
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
	while (nextCommand < commandMarks.length) out.push({ kind: "command", command: commandMarks[nextCommand++] });
	// 还在等的那一条数出来正好落在这里——它确实正在此刻发生，末尾就是它的位置。
	while (nextHiccup < hiccupMarks.length) out.push({ kind: "hiccup", hiccup: hiccupMarks[nextHiccup++] });

	/*
	 * Which run is being pushed forward, answered once the whole transcript is known.
	 *
	 * Rows are only ever appended by the walk above — nothing is inserted after the fact any more —
	 * so the indices `work` recorded still point where they did.
	 */
	const working = liveWork(messages, live, rowOfCalls);

	if (working >= 0) {
		const row = out[working];
		if (row.kind === "tools") row.live = true;
	}
	return out;
}
