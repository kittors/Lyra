/**
 * On 「展开显示」 and 「收起」 the list's height transitions to its new height, rather than rows popping
 * in or vanishing at once.
 *
 * Unfolding: the height is measured on the press and again once the new rows are mounted, and a Web
 * Animation runs between the two, so the new rows are revealed from the top down. Folding: the rows
 * cannot go first — gone, there would be nothing to fold. So the height closes to the bottom of row
 * `keep` first and the list really folds once that has played. Both are started only by the press;
 * other changes in the row count, a new session or a search filtering, still appear directly.
 *
 * `ref` wraps only the rows, not the 「展开显示」 button: outside, the button can ride the bottom edge;
 * inside, it would be clipped during the animation. The animation uses `overflow: clip` rather than
 * `hidden` for the reason in `Collapsible`: `hidden` cuts off the sticky headings inside.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { DURATION, EASING } from "../../ui/motion/tokens.ts";

export function useUnfold(ref: RefObject<HTMLElement | null>) {
	const from = useRef<number | null>(null);
	const running = useRef<{ el: HTMLElement; animation: Animation } | null>(null);

	// Stop the animation in progress (without the fold it would end with); the height goes back to the content's own.
	const stop = () => {
		const current = running.current;
		if (!current) return;
		running.current = null;
		current.animation.cancel();
		current.el.style.overflow = "";
	};

	const play = (el: HTMLElement, start: number, end: number, done?: () => void) => {
		el.style.overflow = "clip";
		// Hold at the end until the fold is really committed: otherwise there is a frame at the full rows' height between the two.
		const animation = el.animate([{ height: `${start}px` }, { height: `${end}px` }], {
			duration: DURATION.slow,
			easing: EASING.out,
			fill: "forwards",
		});
		running.current = { el, animation };
		animation.onfinish = () => {
			if (running.current?.animation !== animation) return;
			if (done) flushSync(done);
			stop();
		};
	};

	useLayoutEffect(() => {
		const el = ref.current;
		const start = from.current;
		from.current = null;
		if (!el || start === null) return;

		// Pressed again while the last one plays: its start was measured from the height mid-animation, so stop it first and the end measured is the real one.
		stop();
		const end = el.offsetHeight;
		if (end > start) play(el, start, end);
	});

	return {
		/** Wraps the 「展开显示」 callback: note the current height first, then let the list grow. */
		unfold: (reveal: () => void) => () => {
			from.current = motionReduced() ? null : (ref.current?.offsetHeight ?? null);
			reveal();
		},
		/** Wraps the 「收起」 callback: close to the height of the first `keep` rows, fold once that has played. */
		fold: (keep: number, collapse: () => void) => () => {
			const el = ref.current;
			const last = el?.querySelectorAll<HTMLElement>("[data-ly-row]")[keep - 1];
			if (!el || !last || motionReduced()) {
				stop();
				collapse();
				return;
			}
			const start = el.offsetHeight;
			stop();
			const end = last.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
			if (end < start) play(el, start, end, collapse);
			else collapse();
		},
	};
}
