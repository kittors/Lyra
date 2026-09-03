/**
 * Keep something in step with a working agent, rather than with the end of its turn.
 *
 * Every surface that reports on the working tree had the same shape — re-read when `running` goes
 * false — and the same fault: a turn that spends four minutes editing files leaves the git panel
 * and the change counter showing what was true four minutes ago. The number that says how much has
 * piled up unreviewed was the last thing in the window to know.
 *
 * Polled rather than driven off tool results, and that is deliberate. The tools are not the only
 * writer: a `bash` step running a formatter, a script the agent wrote and then executed, an editor
 * open beside this window. Asking git is one cheap call and it is right about all of them, where a
 * list of "tools that write" is a guess that goes stale the next time a tool is added.
 *
 * Refreshes once on mount and once more when the turn settles, so the final state is never a
 * poll's width out of date.
 */

import { useEffect } from "react";

/** How often to re-read while a turn is running. Fast enough to read as live, cheap enough to keep. */
export const LIVE_POLL_MS = 1500;

export function useLiveRefresh(refresh: () => void | Promise<void>, running: boolean, ms = LIVE_POLL_MS): void {
	/*
	 * `refresh` is a dependency, so it has to be stable — `useCallback` at every call site.
	 *
	 * Deliberately not held in a ref: what it closes over is which repository is being read, and a
	 * ref would keep polling the old one after the workspace changed. Depending on it means the
	 * switch re-reads immediately, which is also the behaviour anyone would expect. The cost is
	 * that an unstable callback rebuilds the interval every render, which is why this says so.
	 */
	useEffect(() => {
		/*
		 * Two guards, both about not letting the work pile up behind itself.
		 *
		 * `inFlight`: `git status` on a large repository can take longer than the interval, and
		 * without this each tick would start another one on top of the last — a queue that grows
		 * for as long as the turn runs, which is how a poll becomes a leak.
		 *
		 * `alive`: nothing new is started once the effect is torn down. Anything already in flight
		 * settles into a `setState` that React drops on an unmounted component, which is a no-op
		 * rather than a warning — but starting *new* work after unmount is ours to prevent.
		 */
		let alive = true;
		let inFlight = false;

		const tick = async () => {
			if (!alive || inFlight) return;
			inFlight = true;
			try {
				await refresh();
			} catch {
				// A failed read is not worth interrupting a turn over; the next tick tries again.
			} finally {
				inFlight = false;
			}
		};

		void tick();
		if (!running) return () => {
			alive = false;
		};

		const timer = setInterval(() => void tick(), ms);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [refresh, running, ms]);
}
