/**
 * A section that folds shut, with the fold actually animating.
 *
 * `max-height` is the usual way and it is a guess: too small clips a long list, too large makes
 * the transition finish early and the last part of the fold happen with nothing moving. A grid
 * whose single row goes from `1fr` to `0fr` interpolates against the content's real height, so a
 * project with three sessions and one with thirty both take the same time and neither is cut off.
 *
 * Collapsed content stays mounted but is taken out of the tab order — a fold is a visual state,
 * and a list nobody can see is a list nobody should be able to tab into.
 */

import { useEffect, useState } from "react";

export function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
	/*
	 * Clipped while it is shut or moving, and not once it is open.
	 *
	 * `overflow: hidden` is what makes the fold visible — the grid track is what shrinks, and the
	 * child has to be willing to be smaller than its content for that to show. But it is also what
	 * breaks `position: sticky` for everything inside, and a section here holds project names that
	 * are meant to pin. A pinned project in 「置顶」 simply scrolled away with the list, and it did
	 * so only when the section existed at all, which is what took a while to see.
	 *
	 * An open section has nothing to clip, so it does not need to.
	 */
	const [clipped, setClipped] = useState(!open);
	useEffect(() => {
		if (!open) setClipped(true);
	}, [open]);

	return (
		<div
			/*
			 * `minmax(0, 1fr)`, not the implicit `auto`.
			 *
			 * A grid column sized `auto` is at least as wide as its widest item, so one long
			 * conversation title pushed this track past the pane and the rows drew outside it. The
			 * clip hid that for as long as there was one; taking it away for `sticky` is what
			 * revealed a second thing it had been covering.
			 */
			className="grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-[var(--ly-t-base)] ease-out"
			style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
			// The track has finished growing, so there is nothing left hanging outside the box.
			onTransitionEnd={(event) => {
				if (open && event.propertyName === "grid-template-rows") setClipped(false);
			}}
		>
			<div className={clipped ? "overflow-hidden" : ""} inert={!open}>
				{children}
			</div>
		</div>
	);
}
