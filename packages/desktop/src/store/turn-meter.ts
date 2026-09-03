/**
 * Keeping a turn's clock and its token count across a pause.
 *
 * Stopping a turn and pressing 继续 is one piece of work with a gap in the middle, and it was being
 * reported as two. `agent_end` threw the meter away and the next send started a fresh one, so a task
 * that ran twenty minutes and was paused once reported the length of its second half — and the
 * tokens of its second half, which makes the tokens-per-second a rate for a stretch of work nobody
 * ran. The number was not merely reset; it described something untrue.
 *
 * What survives the gap is *elapsed*, not the start time. Keeping `startedAt` would be the obvious
 * fix and it is the wrong one: the pause is time the user spent reading, and charging a turn for the
 * ten minutes somebody was at lunch is as wrong as charging it for none of them. So the clock is
 * frozen at the pause and re-lit behind `now` by however much it had already run.
 *
 * `grouping.ts` does the same arithmetic for the finished record on disk — a 继续 belongs to the turn
 * it continues, and its stats are added to it. This is the live half of that, and the two have to
 * agree or the number jumps the moment the turn ends.
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
