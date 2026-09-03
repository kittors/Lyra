/**
 * Asking again, without being asked to.
 *
 * A review list is a queue other people write to. Left alone for twenty minutes it is not "the
 * list" any more, it is a photograph of one — and the way that failed was quiet: the arrow at the
 * top was there to press, so a stale pane looked exactly like a current one.
 *
 * Three things wake it, and they are three different ways of saying "the answer may have changed
 * since you last looked":
 *
 *   - a timer, while the window is actually on screen;
 *   - the window becoming visible again, which is where the largest gaps happen — a laptop shut
 *     over lunch is one `visibilitychange` and an hour of missed activity;
 *   - the network coming back, since the refreshes made while it was gone all failed.
 *
 * Nothing runs while the window is hidden. A background window polling GitHub is a cost with no
 * reader, and the first thing that happens on the way back is a refresh anyway.
 */

import { useEffect, useRef } from "react";

/** Why the refresh is happening, so the caller can throttle a wake and not a tick. */
export type RefreshReason = "timer" | "wake";

export function useLiveRefresh(refresh: (reason: RefreshReason) => void, everyMs: number): void {
	/*
	 * The callback is read through a ref rather than depended on.
	 *
	 * It is rebuilt on most renders of the hook that owns it, and an effect keyed on it would tear
	 * down the interval and start a new one each time — which for a 45s timer in a component that
	 * re-renders while you type in the search field means the timer never reaches the end of a
	 * cycle, and the list never refreshes itself at all.
	 */
	const latest = useRef(refresh);
	latest.current = refresh;

	useEffect(() => {
		let timer = 0;
		const visible = () => document.visibilityState === "visible";

		const start = () => {
			if (!timer && visible()) timer = window.setInterval(() => latest.current("timer"), everyMs);
		};
		const stop = () => {
			if (timer) window.clearInterval(timer);
			timer = 0;
		};

		const onVisibility = () => {
			if (!visible()) return stop();
			start();
			latest.current("wake");
		};
		const onOnline = () => {
			if (visible()) latest.current("wake");
		};

		start();
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("online", onOnline);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("online", onOnline);
		};
	}, [everyMs]);
}
