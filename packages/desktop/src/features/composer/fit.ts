/**
 * How much of the composer's toolbar has to be given up, decided by measuring rather than guessing.
 *
 * The row along the bottom of the field holds more than always fits: an access mode, a context
 * meter, the model, the reasoning level, send. When it runs out of room something has to go, and
 * the question is what tells you it has run out.
 *
 * It used to be the width of the field — `@max-[480px]` dropped the meter, `@max-[420px]` dropped
 * the words next to the access mark. Two fixed numbers standing in for "does this fit", and they
 * cannot: what fits depends on the model's name, and those run from `gpt-5` to
 * `claude-opus-4-6-thinking`. Measured on a real window the meter was being dropped at 479px while
 * the two groups still had 54px of clear air between them — and dropping it freed another 24px that
 * nothing then claimed, because a breakpoint cannot see what its own decision made room for.
 *
 * So: give everything up in a fixed order, one step at a time, and stop at the first step that
 * fits. What "fits" means is `tight` below.
 */

/**
 * What may be given up, in the order it is given up. Higher levels include the lower ones.
 *
 * The order is a ranking of what the row is *for*. The meter and the model name answer questions
 * about the reply you are about to ask for — how much room is left, and who is going to answer —
 * and they change from turn to turn. 「完全访问」 is a mode you set once and leave set, and its mark
 * is red and keeps its tooltip, so the four characters beside it are the cheapest thing in the row.
 * They go first.
 */
export const FIT_LEVELS = {
	/** Everything is drawn. */
	all: 0,
	/** 「完全访问」 loses its words. The mark stays, and it is red — see the note at its call site. */
	noAccessLabel: 1,
	/** The context meter goes: it is a glance at a number the model chip's tooltip also gives. */
	noMeter: 2,
} as const;

export const MAX_FIT_LEVEL = FIT_LEVELS.noMeter;

/** The handle on the element that yields; `ComposerShell` looks for this inside the toolbar row. */
export const FIT_PROBE = "ly-fit-probe";

/**
 * How narrow the model's name may get before the row starts giving other things up.
 *
 * Not "before it truncates". The name truncating is normal and nearly free — it ends in an ellipsis
 * and its tooltip carries the whole thing — so treating the first cut pixel as an emergency spends
 * something real to buy back something that costs nothing. Measured on a 424px field: showing
 * everything cut `claude-opus-4-6-thinking` by 4px, and dropping 「完全访问」 to avoid that returned
 * 58px of blank space to a row that had asked for 4. That trade is the fault, in one number.
 *
 * 88px holds about a dozen characters — `claude-opus-4…`, `gemini-3.7-f…` — which is enough to say
 * which model this is at a glance. Below that the name stops being an identification and the space
 * is better spent on the marks beside it.
 */
export const MIN_NAME_WIDTH = 88;

/**
 * Whether the row is out of room, read off the one element that yields.
 *
 * Everything in the row is `shrink-0` except the model's name, which truncates — so the name is
 * where a shortage shows up, and it is the only reading that does not depend on knowing what else
 * is in the row.
 *
 * Both halves matter. Truncation alone fires on a 4px shortfall; a narrow box alone fires for
 * `gpt-5`, whose name is 40px wide because that is all it needs. Together they mean what they are
 * meant to: this name is being cut, and cut past the point of being readable.
 *
 * The pixel of slack is for sub-pixel layout — a name that fits exactly can measure 171.3 against
 * 171, and a row that flickered between two states on a rounding error would be worse than either.
 */
export function tight(probe: { scrollWidth: number; clientWidth: number } | null | undefined): boolean {
	if (!probe) return false;
	const truncated = probe.scrollWidth > probe.clientWidth + 1;
	return truncated && probe.clientWidth < MIN_NAME_WIDTH;
}

/**
 * The next level to try, or `null` when there is nothing left to try.
 *
 * Separated from the component because the loop it drives is the part worth being sure of: it walks
 * up from `all` on every resize, so widening the window brings things back in the order they went,
 * and it stops at `MAX_FIT_LEVEL` rather than counting for ever when even the barest row is too
 * narrow for the name in it.
 */
export function nextLevel(level: number, isTight: boolean): number | null {
	if (!isTight) return null;
	if (level >= MAX_FIT_LEVEL) return null;
	return level + 1;
}

/**
 * Walk up from "everything shown" and stop at the first level that fits.
 *
 * `measureAt` is handed a level, is expected to put the row into it, and answers whether the row is
 * still too tight. That indirection is the whole reason this is a function rather than four lines
 * in an effect: the caller's version reads the live DOM, and a test's version is a lookup table.
 *
 * Always from `all`, never adjusted from wherever it happened to be. A level is a decision made
 * under a width, and it has to be void the moment the width changes — dropping the meter frees
 * space that only a fresh walk can offer back, which is precisely what the fixed breakpoints this
 * replaced could never do.
 */
export function settle(measureAt: (level: number) => boolean): number {
	let level: number = FIT_LEVELS.all;
	for (;;) {
		const step = nextLevel(level, measureAt(level));
		if (step === null) return level;
		level = step;
	}
}
