/**
 * A number that travels to its new value instead of arriving at it.
 *
 * Token counts do not tick — they land. Usage is reported per message, so the total sits still and
 * then jumps by tens of thousands at once, and formatted to one decimal that reads as the figure
 * flickering between two unrelated numbers. The count is honest either way; what is missing is any
 * sense that the second number came from the first.
 *
 * So the *display* is interpolated while the value itself is not. Nothing here rounds or smooths
 * what is reported — the target is always the true number, and it is always reached. The only
 * thing invented is the path between two of them.
 *
 * Deliberately not a general animation utility. It is for readings that arrive in steps and want
 * to look continuous; a label that changes should use `RollingText`, and a value that genuinely
 * ticks once a second should just be rendered.
 */

import { useEffect, useRef, useState } from "react";

/** Long enough to read as movement, short enough that a burst of updates does not queue up. */
const TRAVEL_MS = 520;

export function useCountUp(target: number, ms = TRAVEL_MS): number {
	const [shown, setShown] = useState(target);
	const frame = useRef(0);
	/**
	 * Where the next journey starts from.
	 *
	 * Updated every frame rather than read from state, for two reasons: an effect that depended on
	 * `shown` would restart itself on its own output, and a target arriving mid-flight should
	 * continue from wherever the number has actually got to rather than snapping back to where the
	 * last one began.
	 */
	const from = useRef(target);

	useEffect(() => {
		cancelAnimationFrame(frame.current);

		/*
		 * Downwards is not a journey, it is a different conversation.
		 *
		 * The count only ever grows within a turn; it drops when the turn ends or the session
		 * changes. Animating that would show the number counting *down* through values it never
		 * had, which says something false about what happened.
		 */
		if (target <= from.current) {
			from.current = target;
			setShown(target);
			return;
		}

		const begin = from.current;
		const started = performance.now();
		const step = (now: number) => {
			/*
			 * Clamped at both ends, and the lower one is not theoretical.
			 *
			 * A frame callback is stamped with the time the *frame* began, not the time it ran. When
			 * the main thread is busy — laying out two hundred diff rows, say — the effect that
			 * starts this journey runs well after that instant, so the first callback arrives with a
			 * timestamp earlier than `started` and `progress` is negative. Cubed, that overshoots
			 * backwards: the Git panel's change count was measured going 0 → −31 → −11 → 27 on its
			 * way to 200, which reads as the number being broken rather than as it counting.
			 */
			const progress = Math.min(1, Math.max(0, (now - started) / ms));
			// The same curve as everything else that decelerates here — see `--ly-e-out`.
			const eased = 1 - (1 - progress) ** 3;
			const value = begin + (target - begin) * eased;
			from.current = value;
			setShown(value);
			if (progress < 1) frame.current = requestAnimationFrame(step);
		};

		frame.current = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame.current);
	}, [target, ms]);

	return shown;
}
