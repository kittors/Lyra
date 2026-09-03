import { useEffect, useRef, useState } from "react";

import { motionReduced } from "../../theme.ts";
import { typingFrames } from "../../lib/typing.ts";

/**
 * How long one character sits on screen before the next one moves.
 *
 * Slow enough that the rewrite is legible as a rewrite and not as a flicker, fast enough that the
 * whole thing is over before it becomes something being waited on. `typingFrames` caps the number
 * of steps, so this is also the answer to "how long can this possibly take": 26 × 26ms.
 */
const FRAME_MS = 26;

/**
 * A string that rewrites itself into the next one, character by character.
 *
 * Returns what should be on screen this frame. The first value is not animated — there was nothing
 * there to replace — and neither is any change while motion is switched off.
 *
 * A hook rather than a component because the text usually has somewhere else to be: the sidebar
 * feeds it to `ScrollText`, which measures the string to decide whether the row scrolls on hover.
 * Handing that a rendered element instead would mean measuring a moving target.
 */
export function useTypedText(text: string): string {
	const [shown, setShown] = useState(text);
	const target = useRef(text);

	useEffect(() => {
		if (text === target.current) return;
		target.current = text;

		if (motionReduced()) {
			setShown(text);
			return;
		}

		const frames = typingFrames(shown, text);
		let index = 0;
		const timer = window.setInterval(() => {
			setShown(frames[index]);
			index += 1;
			if (index >= frames.length) window.clearInterval(timer);
		}, FRAME_MS);

		return () => {
			window.clearInterval(timer);
			/*
			 * Land on the value that was being typed towards, not wherever the interval stopped.
			 *
			 * This runs when a *newer* title arrives mid-rewrite. Leaving the half-typed string in
			 * state would make the next rewrite start from a prefix that was never a real title,
			 * and if the newer value happened to be the same one, from a truncation of itself.
			 */
			setShown(text);
		};
		// `shown` is the starting point, deliberately read at the moment the target changes rather
		// than tracked: re-running this on every frame it sets would restart the animation.
		// oxlint-disable-next-line exhaustive-deps
	}, [text]);

	return shown;
}
