/**
 * A reply being written, let out at an even rate rather than drawn as fast as it arrives.
 *
 * The rhythm characters arrive in belongs to the provider: some send a token a frame, some save up a
 * few hundred milliseconds and pour out a couple of hundred characters at once. The latter draws in
 * jolts — a pause, a whole sentence at once, another pause. `ThinkingBlock`'s running line solves the
 * same thing with `useTyped`; this is the version for the reply body, and the difference is the speed
 * ceiling: the body has to keep up with a model writing a thousand characters a second, so there is
 * none, and how far it may lag is `CATCH_UP`'s to say.
 *
 * The rate is the larger of two:
 *
 * - the recent arrival rate (smoothed), which evens batch after batch into one line instead of each
 *   batch starting fast and slowing down;
 * - the backlog / `CATCH_UP`, so however fast upstream is, the screen is never more than about that far
 *   behind.
 *
 * **Finished writing is not finished showing.** When `live` turns false the characters not yet let out
 * still are, and `active: false` is given only once the last one has faded in — only then does the
 * caller switch back to the original text. A short reply needs this most: a sentence often arrives
 * whole and ends right after, and handing over the full text at that moment cut the fade, so the
 * characters popped in solid.
 */

import { useEffect, useRef, useState } from "react";
import { motionReduced } from "../../ui/motion/reduced.ts";

/** The backlog is let out over roughly this many seconds — which is how far the screen trails the model in steady output. */
const CATCH_UP = 0.15;
/** The minimum rate (characters per second) when the backlog is small, so the last few do not drag out. */
const FLOOR = 60;
/** A cap on the arrival rate (characters per second). A large block poured in at once has a meaningless momentary rate; it must not wash out the smoothing. */
const RATE_CAP = 1000;
/** This many characters at once is not output any more (a reconnect, a resend): the full text is given at once. */
const JUMP = 2000;
/**
 * How long after the last character is let out the showing counts as over: its appearance is scheduled at
 * most 160ms after it is let out, then fades for 180ms (see `FadeText`), plus a little room.
 */
const LINGER = 400;

export function useSmoothText(text: string, live: boolean): { text: string; active: boolean } {
	const motion = !motionReduced();
	const [shown, setShown] = useState(text);
	const [active, setActive] = useState(live && motion);
	const state = useRef({ target: text, position: text.length, rate: 0, arrived: 0, frame: 0, last: 0, live, active: live && motion, linger: 0 });

	useEffect(() => {
		const here = state.current;
		const now = performance.now();
		here.live = live;
		clearTimeout(here.linger);

		const settle = () => {
			here.linger = window.setTimeout(() => {
				here.active = false;
				setActive(false);
			}, LINGER);
		};

		// Not showing, not a continuation of what was there, or too much at once: the full text.
		if (!motion || !text.startsWith(here.target) || text.length - here.target.length > JUMP || (!live && !here.active)) {
			cancelAnimationFrame(here.frame);
			here.frame = 0;
			here.target = text;
			here.position = text.length;
			here.rate = 0;
			here.arrived = now;
			setShown(text);
			here.active = live && motion;
			setActive(here.active);
			return;
		}

		if (live && !here.active) {
			here.active = true;
			setActive(true);
		}

		if (text !== here.target) {
			const added = text.length - here.target.length;
			// The first batch has no previous one to compare with, so only the backlog term applies.
			if (here.arrived) {
				const instant = Math.min(RATE_CAP, added / Math.max(0.016, (now - here.arrived) / 1000));
				here.rate = here.rate * 0.7 + instant * 0.3;
			}
			here.arrived = now;
			here.target = text;
		}

		if (here.frame) return;
		if (here.position >= here.target.length) {
			if (!live) settle();
			return;
		}
		here.last = now;
		const step = (time: number) => {
			const current = state.current;
			// Clamped, so a window back from the background does not spend its whole absence in one frame.
			const delta = Math.min(0.1, Math.max(0, (time - current.last) / 1000));
			current.last = time;
			const backlog = current.target.length - current.position;
			if (backlog <= 0) {
				current.frame = 0;
				if (!current.live) settle();
				return;
			}
			current.position = Math.min(current.target.length, current.position + Math.max(FLOOR, current.rate, backlog / CATCH_UP) * delta);
			let cut = Math.floor(current.position);
			// Never cut inside a surrogate pair, or an emoji shows half of itself as garbage first.
			const code = current.target.charCodeAt(cut);
			if (code >= 0xdc00 && code <= 0xdfff) cut++;
			setShown(current.target.slice(0, cut));
			current.frame = requestAnimationFrame(step);
		};
		here.frame = requestAnimationFrame(step);
	}, [text, live, motion]);

	useEffect(
		() => () => {
			cancelAnimationFrame(state.current.frame);
			clearTimeout(state.current.linger);
		},
		[],
	);

	return active ? { text: shown, active } : { text, active };
}
