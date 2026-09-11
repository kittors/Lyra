/**
 * Keeping a turn's clock and its token count across a pause, and across a person interrupting.
 *
 * Stopping a turn and pressing 继续 is one piece of work with a gap in the middle, and it was being
 * reported as two. `agent_end` threw the meter away and the next send started a fresh one, so a task
 * that ran twenty minutes and was paused once reported the length of its second half — and the
 * tokens of its second half, which makes the tokens-per-second a rate for a stretch of work nobody
 * ran. The number was not merely reset; it described something untrue.
 *
 * Speaking while it runs is the same shape of mistake. Adding a requirement to a task in flight, or
 * sharpening one, does not begin a second task — but every send used to light a fresh meter, so the
 * line went back to `0s` and answered "how long since you added that", when what is being asked is
 * "how long have I been waiting on this". Two ways in, one rule: an interruption delivered into the
 * running turn keeps the meter that is already lit (`turn-slice`'s `send`), and one held back on the
 * queue picks up the meter `agent_end` froze for it (`apply-event`, then `queue-slice`). Only a
 * person opening their mouth to an idle session starts a new one.
 *
 * What survives the gap is *elapsed*, not the start time. Keeping `startedAt` would be the obvious
 * fix and it is the wrong one: the pause is time the user spent reading, and charging a turn for the
 * ten minutes somebody was at lunch is as wrong as charging it for none of them. So the clock is
 * frozen at the pause and re-lit behind `now` by however much it had already run.
 *
 * `grouping.ts` does the same arithmetic for the finished record on disk — a 继续 belongs to the turn
 * it continues, and its stats are added to it. This is the live half of that, and the two have to
 * agree or the number jumps the moment the turn ends.
 *
 * 它们有很长一段时间并不 agree，而这句话就写在这里。这半边数的一直是墙钟；那半边数的是每条回复
 * 的 `durationMs` 加起来，也就是**只有请求在飞的时候**才走的表。一轮跑了 13 分 02 秒、当中四个子
 * 代理和三条长命令占掉 10 分 48 秒，人盯着这一行看了十三分钟，`agent_end` 一到，数字当场变成 2 分
 * 14 秒——八成以上的时间不是被算错，是从来没进过账。跨 229 个真实会话的 309 个有记录的回合复核，
 * 中位少算 8.7%，九成位 59.6%。那半边现在也走墙钟，也跨过停顿，见 `grouping.ts` 的 `TurnStats`。
 *
 * 还剩一处故意分开的：**人在回合进行当中插的那句话**。它在那半边是新一轮的开头，在这半边不是。
 * 那半边的数字印在一条回复底下，按人每次开口切一刀，才对得上它所在的那条回复；这半边回答的是
 * 「我这件事等了多久」，补一句需求不是另起一件事。两个问题各自答对，不是同一个问题答了两遍。
 */

/** A turn in flight: when its clock was lit, and what it has spent since. */
export interface TurnMeter {
	startedAt: number;
	tokens: number;
}

/** A turn stopped part-way: how much it had run, and what it had spent. */
export interface CarriedTurn {
	elapsedMs: number;
	tokens: number;
}

const STORAGE_PREFIX = "ly:carried:";

/**
 * Load a frozen turn meter from local storage for cold restart or page reload persistence.
 */
export function loadCarried(sessionId: string): CarriedTurn | null {
	if (typeof window === "undefined" || !window.localStorage) return null;
	try {
		const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<CarriedTurn>;
		if (typeof parsed.elapsedMs === "number" && typeof parsed.tokens === "number") {
			return { elapsedMs: Math.max(0, parsed.elapsedMs), tokens: Math.max(0, parsed.tokens) };
		}
	} catch {
		// Invalid JSON or storage error is treated as empty
	}
	return null;
}

/**
 * Persist a frozen turn meter to local storage, or clear it if null.
 */
export function saveCarried(sessionId: string, carried: CarriedTurn | null): void {
	if (typeof window === "undefined" || !window.localStorage) return;
	try {
		if (carried) {
			window.localStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(carried));
		} else {
			window.localStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`);
		}
	} catch {
		// Storage quota exceeded or unavailable
	}
}

/**
 * Freeze a running meter at the moment the turn stopped.
 *
 * `null` when there was no turn to freeze, which is what says there is nothing to carry — a
 * conversation that has never run must not offer to resume a meter it does not have.
 */
export function freeze(meter: TurnMeter | undefined, now: number): CarriedTurn | null {
	if (!meter) return null;
	return {
		// Never negative: the clock can go backwards across a suspend or an NTP step, and an elapsed
		// time of -3s would re-light the meter in the future and count down.
		elapsedMs: Math.max(0, now - meter.startedAt),
		tokens: meter.tokens,
	};
}

/**
 * Light a meter that carries on from where a stopped one left off.
 *
 * With nothing carried this is an ordinary start, which is what makes it safe to call for every
 * send: "resume from nothing" and "begin" are the same meter.
 */
export function relight(carried: CarriedTurn | undefined | null, now: number): TurnMeter {
	if (!carried) return { startedAt: now, tokens: 0 };
	return { startedAt: now - carried.elapsedMs, tokens: carried.tokens };
}

/**
 * What the running line will read off a relit meter, for the tests to state plainly.
 *
 * The whole point is that this is the total across the gap, not the length of the second leg.
 */
export function elapsedOf(meter: TurnMeter, now: number): number {
	return Math.max(0, now - meter.startedAt);
}
