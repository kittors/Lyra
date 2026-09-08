/**
 * Carrying on when a turn stops before the work does.
 *
 * Two different endings, one answer. A turn is capped so that one runaway cannot spin forever, and
 * a big piece of work legitimately exceeds that cap — a full-stack project reaches it around the
 * point the frontend starts. And a turn can lose its connection outright, after twenty minutes of
 * reading files and running tools.
 *
 * What used to happen in both cases was that the run stopped and waited for someone to press
 * "continue", which is exactly the human intervention an unattended run exists to avoid. The
 * connection case was worse than the cap: `retryAttempts` covers the request, so once those are
 * spent the turn is over — and the work it had done, being already in the transcript, was thrown
 * away not because it was lost but because nobody asked for it back.
 *
 * So it starts another turn. That is all "continuing from where it stopped" needs to be: the
 * history is the progress, every finished reply and tool result is already committed to it, and a
 * fresh turn over that history resumes at the next step rather than the first one. Nothing is
 * replayed and nothing is re-run.
 *
 * Bounded in both cases, and safe to bound loosely for the cap, because the two ways a run can be
 * genuinely stuck are caught elsewhere: repetition ends a turn with `stalled`, and a model that has
 * stopped calling tools is nudged a few times and then left alone. Bounded tightly for the
 * connection, because nothing here can tell a network blip from an outage except by trying.
 *
 * A policy, not a mechanism — hence a module of its own, and a set of questions it asks rather than
 * a session it reaches into.
 */

import type { AgentRunResult } from "../agent/loop.ts";
import type { TodoItem } from "../tools/todo.ts";
import type { Message } from "../types.ts";

/**
 * How many times a turn may run out of rounds and be restarted.
 *
 * Loose on purpose: a backstop against a bug in the conditions below, not a judgement about how
 * much work is reasonable. Ten is two thousand rounds — far past anything a real task needs, and
 * long before it the repetition watch would have called a genuine loop.
 */
const MAX_CONTINUATIONS = 10;

/**
 * How many times a lost connection may be picked back up.
 *
 * Tight where the round cap is loose, and for the opposite reason. Running out of rounds is
 * evidence of progress — the turn did two hundred things — so continuing is nearly free. A
 * connection that has already exhausted every retry inside the request is evidence of the reverse,
 * and each attempt here costs a full context window to send. Three is enough to ride out a laptop
 * changing networks or a relay restarting; past that it is an outage, and the work is safe on disk
 * either way.
 */
const MAX_RESUMES = 3;

/**
 * How long to wait before picking the work back up, per attempt.
 *
 * Longer than the in-request backoff by an order of magnitude, because it starts where that one
 * gave up: every short wait has already been tried and failed. These are the intervals at which a
 * network is plausibly *different* — long enough for a VPN to reconnect or a relay to come back,
 * short enough that someone watching has not yet walked away.
 */
const RESUME_DELAYS_MS = [5_000, 20_000, 60_000];

export interface ContinuationDeps {
	/**
	 * A configured request budget must not be restarted by the outer turn continuation.
	 *
	 * 注意这在桌面会话里恒为真——`session-turn.ts` 无条件传 `true`，那里写了为什么——所以下面那段
	 * 连接恢复的逻辑在真实运行中不会执行。读到这里不必困惑：它没有被遗忘，是被请求那一层接管了，
	 * 而那一层受设置页管着。
	 */
	requestRetriesHandled?: boolean;
	/** Start another turn with the accumulated history. */
	run(messages: Message[]): Promise<AgentRunResult>;
	messages(): Message[];
	todos(): TodoItem[];
	aborted(): boolean;
	notify(message: string): Promise<void> | void;
	/**
	 * About to wait, then go back for the work.
	 *
	 * Separate from `notify` because the two have different lifetimes and the difference is the
	 * whole point. A notice is a toast: it says its piece and clears itself in a few seconds. This
	 * wait can be a minute long, and a minute of an idle window after a turn visibly ended is
	 * indistinguishable from a turn that failed — which is exactly the reading this exists to
	 * prevent. So it goes to the running line, where it can count down for as long as it takes.
	 */
	resuming(info: { attempt: number; delayMs: number; reason: string }): Promise<void> | void;
	/** Cuts the wait short when the turn is stopped; see `waitOrStop`. */
	signal?: AbortSignal;
	/** Injected in tests so they do not sleep. */
	sleep?(ms: number): Promise<void>;
}

export async function continueWhileWorkRemains(
	first: AgentRunResult,
	deps: ContinuationDeps,
): Promise<AgentRunResult> {
	const sleep = deps.sleep ?? ((ms: number) => waitOrStop(ms, deps.signal));
	let result = first;
	/*
	 * Counted separately from the loop, and never reset.
	 *
	 * A run that alternates — connection dies, one turn succeeds, connection dies again — is on a
	 * network that is not working, and resetting on each success would let it do that forever. The
	 * budget is for the run, not for the current streak.
	 */
	let resumes = 0;

	for (let extra = 0; extra < MAX_CONTINUATIONS; extra++) {
		if (deps.aborted()) break;

		if (result.reason === "max_turns") {
			const unfinished = deps.todos().filter((todo) => todo.status !== "completed");
			if (unfinished.length === 0) break;
			await deps.notify(`本轮步数用尽，清单里还有 ${unfinished.length} 项，继续执行。`);
			result = await deps.run(deps.messages());
			continue;
		}

		/*
		 * The connection went, and the work did not.
		 *
		 * Only `retryable` errors: a dropped socket or a relay that fell over is worth waiting out,
		 * while a rejected key or a model that does not exist would fail the same way three more
		 * times and say the same thing three minutes later.
		 *
		 * No check on the plan here, unlike the round cap. A turn is interrupted wherever the
		 * network chose, which is often before the model has written a plan down at all, and
		 * "there is no list" is not evidence that there is nothing left to do.
		 */
		if (deps.requestRetriesHandled || result.reason !== "error" || !result.retryable || resumes >= MAX_RESUMES) break;

		const delay = RESUME_DELAYS_MS[Math.min(resumes, RESUME_DELAYS_MS.length - 1)];
		resumes += 1;
		await deps.resuming({ attempt: resumes, delayMs: delay, reason: result.error ?? "连接中断" });
		await sleep(delay);
		/*
		 * Started even when the turn was stopped mid-wait, and that is deliberate.
		 *
		 * The wait was announced, and the announcement is still on screen counting down — it is on
		 * the running line rather than in a toast precisely so that it stays. Breaking out here
		 * would leave it there permanently: nothing further runs, so nothing further is emitted,
		 * and the last thing the window heard was "continuing in 60 seconds". A run started against
		 * an aborted signal sends no request and does no work; it ends, properly, and ending is
		 * what takes the line down. The loop stops on the check at the top.
		 */
		result = await deps.run(deps.messages());
	}
	return result;
}

/**
 * Wait, unless the turn is stopped first.
 *
 * A plain `setTimeout` cannot be interrupted, which would mean pressing stop during a sixty-second
 * resume did nothing visible for the best part of a minute — the one interaction that must always
 * feel immediate, on the one screen that is already asking for patience.
 */
function waitOrStop(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}
