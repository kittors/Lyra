/**
 * A number that travels when it changes, and simply appears when it arrives.
 *
 * The distinction is the whole reason this is a component rather than a bare `useCountUp` at the
 * call site. A hook has to be called before its caller's early returns, so it was being given a
 * zero while the real figure was still being read — and then animating up from that zero when it
 * landed. The Git panel counted 0 → 200 over half a second on open, as though two hundred files
 * had been changed while you watched; the composer's change bar did the same with its line counts.
 *
 * Mounting where the value is known makes "the first value" mean the first *real* value. Callers
 * render this only once they have something to show, so its initial state is the true figure and
 * there is nothing to travel from. Every reading after that is a genuine change, which is what the
 * movement is for. See `useCountUp` for the curve and for why it refuses to travel downwards.
 */

import { useCountUp } from "./useCountUp.ts";

/** Declared out here so it is one function rather than a new one on every render. */
const plain = (shown: number): string => String(Math.round(shown));

export function CountUp({
	value,
	className,
	/** How the travelling figure is written. Defaults to a plain rounded integer. */
	format = plain,
}: {
	value: number;
	className?: string;
	format?: (shown: number) => string;
}) {
	return <span className={className}>{format(useCountUp(value))}</span>;
}
