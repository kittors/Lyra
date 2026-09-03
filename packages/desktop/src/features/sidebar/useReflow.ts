/**
 * Rows that travel to their new place instead of appearing in it.
 *
 * Writing to a conversation from yesterday moves it out of 「昨天」 and to the top of 「今天」 — a
 * change of parent, not a change of position, so no CSS transition can carry it: the row is removed
 * from one list and inserted into another, and what you see is it vanishing and something else
 * taking its place. In a pane of forty near-identical titles that reads as the list having
 * scrambled, and the one row you were watching is the one you lose.
 *
 * So: FLIP. Measure where everything is before the change, let React do the change, measure again,
 * and put each row back where it started with a transform before releasing it. The browser
 * animates the release, on the compositor, and nothing in the layout is asked to move twice.
 *
 * Only rows that actually moved get a transform, and only far enough to be worth watching — a
 * one-pixel drift from a scrollbar appearing is not a story worth telling.
 */

import { useLayoutEffect, useRef } from "react";

/** Below this, the move is noise rather than news. */
const MIN_TRAVEL_PX = 4;

/**
 * Longer than the app's `--ly-t-base`.
 *
 * A row crossing a band heading travels further than anything else in the window, and at 220ms a
 * long trip reads as a jump. This is the one motion that is about *where something went*, so it is
 * allowed the time to be followed.
 */
const TRAVEL_MS = 320;

/**
 * Animate `[data-ly-row]` descendants of `host` from wherever they were to wherever they now are.
 *
 * `key` is what the caller changes when the list changes — the row ids, joined. Measuring on every
 * render would be a `getBoundingClientRect` per row per keystroke in the filter box; measuring when
 * the composition changes is the same information for a fraction of the work.
 */
export function useReflow(host: React.RefObject<HTMLElement | null>, key: string): void {
	/** Where each row was, from the last time the list settled. */
	const seen = useRef(new Map<string, number>());
	/** Set while a reflow is playing, so the measurement it produces is not taken as a new resting place. */
	const playing = useRef(false);

	useLayoutEffect(() => {
		const element = host.current;
		if (!element) return;

		const rows = [...element.querySelectorAll<HTMLElement>("[data-ly-row]")];
		const previous = seen.current;
		const next = new Map<string, number>();

		/*
		 * Reduced motion means no motion.
		 *
		 * This is the one animation in the sidebar that moves something a long way, which is exactly
		 * the kind a person who asked for less of it does not want.
		 */
		const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

		for (const row of rows) {
			const id = row.dataset.lyRow;
			if (!id) continue;
			const top = row.offsetTop;
			next.set(id, top);
			if (still || playing.current) continue;

			const before = previous.get(id);
			// A row that was not here a moment ago has nowhere to travel from; it belongs to the
			// entrance animation the row itself owns.
			if (before === undefined) continue;
			const delta = before - top;
			if (Math.abs(delta) < MIN_TRAVEL_PX) continue;

			/*
			 * Put it back, then let go on the next frame.
			 *
			 * The transform has to land before the browser paints — hence the layout effect — and
			 * the release has to be a separate frame, or the two are coalesced into no animation at
			 * all.
			 */
			row.style.transition = "none";
			row.style.transform = `translateY(${delta}px)`;
			requestAnimationFrame(() => {
				row.style.transition = `transform ${TRAVEL_MS}ms var(--ly-e-out)`;
				row.style.transform = "";
			});
		}

		seen.current = next;
	}, [host, key]);

	/*
	 * Forget the positions while the pane is not showing any.
	 *
	 * Collapsing a project or switching to the other tab unmounts every row; remembering where they
	 * were would make the next mount animate every one of them from a layout that is no longer on
	 * screen.
	 */
	useLayoutEffect(() => {
		return () => {
			seen.current.clear();
			playing.current = false;
		};
	}, [host]);
}
