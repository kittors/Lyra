/**
 * A box's width as it will be once whatever is sliding beside it comes to rest.
 *
 * The sidebar folds and unfolds by easing its frame's margin (`NavPane` in `app/panes.tsx`), so the
 * content beside it is a different width on every frame of the fold. Prose reflowing through that
 * reads as the page making room. A layout computed *from* the width does not: the gallery's rows were
 * laid out again on each of those frames — 13 sizes per picture in 200ms, every time 创作 was opened —
 * and the album squirmed into place instead of arriving.
 *
 * So while a slide runs, the width reported is the one it ends at, read on its first frame: the layout
 * is made once, for where the panel is going, and travels with the panel while it gets there.
 */

import { useLayoutEffect, useState } from "react";

/**
 * Marks an element whose easing size or margin moves everything beside it — the sidebar's frame.
 * An attribute rather than a ref, because the two sit in different trees and neither owns the other.
 */
export const SLIDING_EDGE = "data-ly-sliding-edge";

/** The transitions under way on the marked elements. `getAnimations` flushes style, so one committed a moment ago is already here. */
function slides(): Animation[] {
	const running: Animation[] = [];
	for (const edge of document.querySelectorAll(`[${SLIDING_EDGE}]`)) {
		if (typeof edge.getAnimations !== "function") continue;
		for (const animation of edge.getAnimations()) if (animation.playState !== "finished") running.push(animation);
	}
	return running;
}

/**
 * The box's width with every slide moved to its end, each put back where it was before anything is drawn.
 *
 * Measured in Electron's Chromium before relying on it: the slide carries on from the frame it was on,
 * `finished` is not announced early — the finish notification checks the play state again before it
 * fires, and by then it is running — and no `transitionend` is dispatched.
 */
function widthAtEnd(el: HTMLElement, moving: readonly Animation[]): number {
	const moved: [Animation, CSSNumberish][] = [];
	try {
		for (const animation of moving) {
			const was = animation.currentTime;
			const end = animation.effect?.getComputedTiming().endTime;
			// An unresolved time cannot be put back, and an endless one has no end to read.
			if (was === null || typeof end !== "number" || !Number.isFinite(end)) continue;
			moved.push([animation, was]);
			animation.currentTime = end;
		}
		return el.clientWidth;
	} finally {
		for (const [animation, was] of moved) animation.currentTime = was;
	}
}

/** The box's `clientWidth` — or, while something beside it slides, the width the slide will leave it at. 0 until measured. */
export function useSettledWidth(box: React.RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		let live = true;
		let sliding = false;
		const measure = () => {
			if (!live) return;
			const moving = slides();
			if (moving.length === 0) {
				setWidth(el.clientWidth);
				return;
			}
			// Once per slide: its end is known from its first frame, and each frame after would only ask again.
			if (sliding) return;
			sliding = true;
			setWidth(widthAtEnd(el, moving));
			// Settled, not all: a slide reversed halfway is cancelled, and its replacement is then the one to follow.
			void Promise.allSettled(moving.map((animation) => animation.finished)).then(() => {
				sliding = false;
				measure();
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			live = false;
			observer.disconnect();
		};
	}, [box]);
	return width;
}
