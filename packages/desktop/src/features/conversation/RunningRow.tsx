import { useLayoutEffect, useState } from "react";

import { motionReduced } from "../../ui/motion/reduced.ts";
import { RunningIndicator } from "./RunningIndicator.tsx";

/**
 * The 「运行中」 line under the transcript, folding in and out with the turn.
 *
 * What it shows outlives the turn by one fold. The row's `data-open` and its content used to be the
 * same condition, so a turn that ended without prose — only tools, stopped, failed — or a compaction
 * starting emptied the row in the frame the fold began: the fold had nothing left to animate, and a
 * transcript pinned to the bottom dropped the row's whole height at once. Now the indicator stays
 * until the fold has finished, and only then goes.
 *
 * The answer arriving is the deliberate exception, and keeps its instant fold — see the note where
 * this is rendered in `Conversation`. Nothing is retained for it: with no transition there is no
 * `transitionend` to release it, and the indicator stays mounted for the rest of the turn anyway.
 */
export function RunningRow({ running, answering, compacting }: { running: boolean; answering: boolean; compacting: boolean }) {
	const open = running && !answering && !compacting;
	const [retained, setRetained] = useState(open);
	useLayoutEffect(() => {
		if (open) setRetained(true);
		else if (answering || motionReduced()) setRetained(false);
	}, [open, answering]);
	// A hidden `Activity` cancels the fold before its `transitionend`; see the same release in `Collapse`.
	useLayoutEffect(() => () => setRetained(false), []);
	return (
		<div
			className="ly-reveal"
			data-open={open}
			aria-hidden={!open}
			style={answering ? { transition: "none" } : undefined}
			onTransitionEnd={(event) => {
				if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !open) setRetained(false);
			}}
		>
			<div>
				<div>{((running && !compacting) || retained) && <RunningIndicator />}</div>
			</div>
		</div>
	);
}
