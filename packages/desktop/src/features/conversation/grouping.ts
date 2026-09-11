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
	/**
	 * 这一轮实际跑了多久。
	 *
	 * 墙上的钟，不是请求耗时之和。模型在想、工具在跑、子代理在跑，对等在外面的人来说都是同一件
	 * 事还没做完——这些时间全在里面。
	 *
	 * 从前这里是把每条回复的 `durationMs` 加起来，那是**只有请求在飞的时候**才走的表：一轮真实
	 * 跑了 13 分 02 秒、其中四次子代理和三次长命令占掉 10 分 48 秒，报出来是 2 分 14 秒。八成
	 * 以上的时间不是被算错，是从来没被算过。而运行中那一行（`RunningIndicator`）读的一直是墙钟，
	 * 所以回合一结束，数字当场从 13 分掉到 2 分——同一个问题的两个答案，差了近六倍。
	 *
	 * 唯一不算进来的是停下来之后那一段：见 `halted`。
	 */
	durationMs: number;
	/**
	 * 其中模型在应答的时间——工具、子代理、中间的调度间隙都不在里面。
	 *
	 * 就是从前 `durationMs` 装的那个数。它没有错，错的是拿它回答「这一轮花了多久」；留在这里，
	 * 是因为「13 分钟里模型只说了 2 分钟」本身是句有用的话，界面把它放进了悬浮说明。
	 */
	requestMs: number;
	/** 纯出字的时间，tok/s 的分母：去掉了排队、首字延迟和连接往返。 */
	sseDurationMs: number;
	outputTokens: number;
	requestCount: number;
};

/**
 * 一轮的表，边读转录边走。
 *
 * 可变对象，只在这个文件里用；要交出去的时候 `snapshot` 出一份不可变的 `TurnStats`——那是要塞进
 * memo 过的行里的东西，原地改的总数 React 有权当作没变过。
 */
type Clock = {
	/** 当前这一段从哪儿起表；`null` 是这一轮还没有任何消息。 */
	from: number | null;
	/** 当前这一段已知走到了哪儿。 */
	to: number;
	/** 之前那些结清了的段加起来有多长。 */
	closedMs: number;
	/**
	 * 上一条回复是停下的（出错，或者被人按停），下一条消息来之前这段不算。
	 *
	 * 这是唯一一处「时间不算数」的地方，也正是 `turn-meter` 那半边 `freeze` 的两个理由：停在那里
	 * 等人回来看一眼的十分钟，是人的时间，不是这一轮的时间。人一开口（或者重试一发出），表重新
	 * 起走，中间那段就这么被跨过去了。
	 */
	halted: boolean;
	requestMs: number;
	sseDurationMs: number;
	outputTokens: number;
	requestCount: number;
};

/** 一轮还什么都没发生。 */
function newClock(): Clock {
	return { from: null, to: 0, closedMs: 0, halted: false, requestMs: 0, sseDurationMs: 0, outputTokens: 0, requestCount: 0 };
}

/**
 * 一条消息在时间轴上占到哪儿为止。
 *
 * 回复的 `timestamp` 是流开始的时刻，加上 `durationMs` 才是它收尾的时刻。工具结果的 `timestamp`
 * 本身就已经是工具跑完的时刻了（它自己的 `durationMs` 是往回算的），再加一次等于把工具时长记两遍。
 */
function endOf(message: Message): number {
	if (message.role === "assistant" && typeof message.durationMs === "number" && message.durationMs > 0) {
		return message.timestamp + message.durationMs;
	}
	return message.timestamp;
}

/**
 * 把一条消息记进表里。
 *
 * 每一条都记，包括画不出行的那些——工具结果、自动继续的那句话。它们占的是真实时间：一条 `task`
 * 跑四分钟，这一轮就是过了四分钟，哪怕这四分钟里一个 token 都没产出。
 *
 * 取 `max` 而不是直接赋值，是因为工具是边流边派的：一条回复的 `toolCall` 块一落地就发出去了，
 * 不等整个流收尾，所以工具结果的时刻可以比派它的那条回复的结束时刻更早。
 */
function saw(clock: Clock, message: Message): void {
	if (clock.from === null) {
		clock.from = message.timestamp;
		clock.to = message.timestamp;
	} else if (clock.halted) {
		clock.closedMs += Math.max(0, clock.to - clock.from);
		clock.from = message.timestamp;
		clock.to = message.timestamp;
	}
	clock.halted = false;
	clock.to = Math.max(clock.to, endOf(message));
	if (message.role !== "assistant") return;
	const duration = typeof message.durationMs === "number" && message.durationMs > 0 ? message.durationMs : 0;
	const sse = typeof message.sseDurationMs === "number" && message.sseDurationMs > 0 ? message.sseDurationMs : 0;
	const output = typeof message.usage?.output === "number" && message.usage.output > 0 ? message.usage.output : 0;
	clock.requestMs += duration;
	// 没记 sse 的旧消息（磁盘上的老数据）退回整条请求的耗时，至少分母不会是 0。
	clock.sseDurationMs += sse || duration;
	clock.outputTokens += output;
	clock.requestCount += 1;
	// 这两种收场是「停下了」，不是「做完了」——和 `apply-event` 里冻结那块表的条件是同一对。
	if (message.stopReason === "error" || message.stopReason === "aborted") clock.halted = true;
}

/** 此刻为止这一轮的账，一份定下来的副本。 */
function snapshot(clock: Clock): TurnStats {
	const open = clock.from === null ? 0 : Math.max(0, clock.to - clock.from);
	return {
		durationMs: clock.closedMs + open,
		requestMs: clock.requestMs,
		sseDurationMs: clock.sseDurationMs,
		outputTokens: clock.outputTokens,
		requestCount: clock.requestCount,
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

/**
 * 截至 `endMessageIndex` 的那一轮花了多少。
 *
 * 一轮从人开口的那条消息**本身**起算，不是从它的下一条起算：表要从人按下回车那一刻走，那正是
 * `turn-slice` 给在线那块表定的起点，两边差一点点都会让数字在回合结束的瞬间跳一下。中间的工具
 * 结果和自动继续都属于这一轮，一并记进去。
 */
export function computeTurnStats(messages: Message[], endMessageIndex: number): TurnStats {
	// Walk backwards from endMessageIndex until we hit a real user message or index 0
	let startIndex = 0;
	for (let i = endMessageIndex; i >= 0; i--) {
		// A 继续 after a failure belongs to the turn it is continuing, so the walk goes on past it
		// to the question that actually started the work.
		if (opensTurn(messages[i]) && !resumesTurn(messages, i)) {
			startIndex = i;
			break;
		}
	}

	const clock = newClock();
	for (let i = startIndex; i <= endMessageIndex && i < messages.length; i++) saw(clock, messages[i]);
	return snapshot(clock);
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
	 * The same answer `computeTurnStats` gives — the same `saw` — arrived at in one pass instead of
	 * one backward scan per row. On a session of several thousand messages that difference is the
	 * whole cost: the scan was being run for every visible reply, on every render of the transcript.
	 */
	let clock = newClock();

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
		if (opensTurn(message) && !resumesTurn(messages, index)) clock = newClock();
		/*
		 * 每一条都记进表里，包括下面那两种画不出行的。
		 *
		 * 它们不出现在转录上，可是它们占的时间是真的：一条工具结果背后是一次四分钟的子代理，一句
		 * 「自动继续」后面是模型接着往下干。这一句要排在下面所有 `continue` 前面——从前那些 continue
		 * 是纯粹的渲染决定，把统计一起跳过去，正是时间丢掉的地方。
		 */
		saw(clock, message);

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
			out.push({ kind: "message", message, index, upTo: own, from: think, turnStats: snapshot(clock) });
		} else if (think === 0 && calls.length === 0 && message.stopReason !== "pending") {
			/*
			 * Nothing thought, nothing said, nothing done, and the turn is over: a failure with no
			 * output. This message's only chance to show it, so it gets a row.
			 */
			out.push({ kind: "message", message, index, upTo: message.content.length, turnStats: snapshot(clock) });
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

/**
 * 一整轮的过程，和它最后说出口的那句话，分开。
 *
 * 一轮读下来是「想 → 做 → 说」：模型先推理，然后调命令、读文件、跑技能，全部做完了才给出真正的
 * 回答。前两步是过程——它值得看，但看过一次之后，翻回一段旧对话时四十行工具卡片挡在答案前面，
 * 就只是噪音了。所以过程可以收成一行，而那句回答永远在外面。
 *
 * 「最后那句话」的定义就是字面意思：这一轮里**最后一条带正文的助手消息**。中间那些「我先看一下
 * 配置」属于过程——它们是在解说自己正在做什么，不是结论。
 *
 * 在 Run 这一层分，不在渲染时分：这是一条关于转录形状的规则，规则性的东西要能单独测。
 */
export interface TurnBlock {
	/** 一整轮的过程，收得起来。 */
	kind: "process" | "plain";
	runs: Run[];
	/** 过程里有什么，用来写那一行摘要。 */
	counts: { tools: number; thinking: number };
	/**
	 * 这一块属于第几轮。
	 *
	 * 「过程要不要收起来」问的是**这一轮跑完没有**，不是「这一块是不是最后一块」。模型一开始流式
	 * 输出正文，过程块就不再排在末尾了——按位置判会让折叠行在回合中途冒出来，把正在进行的工作收
	 * 起来，而那正是人盯着看的时候。
	 */
	turn: number;
}

/** 这一条 run 是不是「过程」——相对于「最后说出口的那句话」。 */
function isProcess(run: Run): boolean {
	if (run.kind === "tools" || run.kind === "hiccup" || run.kind === "compaction") return true;
	// `lead` 的那一条是开头的推理被单独拆出来的行，见 `leadingThinking`。
	return run.kind === "message" && run.lead === true;
}

/** 一条 run 是不是「人开的口」——新一轮从这里开始。 */
function opensBlock(run: Run): boolean {
	return run.kind === "command" || (run.kind === "message" && run.message.role === "user");
}

export function turnBlocks(list: Run[]): TurnBlock[] {
	const out: TurnBlock[] = [];
	let turn = 0;
	const plain = (run: Run) => out.push({ kind: "plain", runs: [run], counts: { tools: 0, thinking: 0 }, turn });

	let at = 0;
	while (at < list.length) {
		if (opensBlock(list[at])) {
			turn++;
			plain(list[at++]);
			continue;
		}
		/*
		 * 从这里到这一轮结束，先框出来，再决定哪一段是过程。
		 *
		 * 边界是下一次「人开的口」——不是下一条助手消息：一轮里助手会说很多次话。
		 */
		let end = at;
		while (end < list.length && !opensBlock(list[end])) end++;

		/*
		 * 最后一条带正文的助手消息，就是这一轮的回答。它和它后面的一切都留在外面。
		 *
		 * 找不到（还在跑、或者这一轮只有工具活）时，过程就一直延伸到边界——正在跑的那一轮本来就
		 * 该全程看得见，而 `TurnProcess` 只在收起时才折叠。
		 */
		let answer = end;
		for (let n = end - 1; n >= at; n--) {
			const run = list[n];
			if (run.kind === "message" && run.message.role === "assistant" && !isProcess(run)) {
				answer = n;
				break;
			}
		}

		/*
		 * 过程之间夹着的助手解说（「我先看一下配置」）也归过程。
		 *
		 * 它们是在说自己正在做什么，不是结论——所以整段按位置原样收进去，只有计数只算真正的过程行。
		 */
		const body = list.slice(at, answer);
		const process = body.filter(isProcess);
		if (process.length > 0) {
			out.push({
				kind: "process",
				runs: body,
				counts: {
					tools: process.reduce((n, run) => n + (run.kind === "tools" ? run.calls.length : 0), 0),
					thinking: process.filter((run) => run.kind === "message" && run.lead === true).length,
				},
				turn,
			});
		} else for (const run of body) plain(run);

		for (let n = answer; n < end; n++) plain(list[n]);
		at = end;
	}
	return out;
}
