/**
 * Keep the scroller's upper fade below the rows pinned over it.
 *
 * The rows are held by `position: sticky`; this only tells the mask where they currently are, as
 * the four lengths of `fadeGeometry`. How deeply to soften around them is `.ly-fade-y`'s, because
 * the depth being divided animates and a number frozen here cannot follow it. `sticky.ts` has the
 * reasoning, including why the mask being a frame behind is harmless.
 *
 * The other thing written here is how deep each group's heading pins (`--ly-band-edge`), which is
 * the line that group's rows fade out against. That one is *not* per frame, and why is the comment
 * on `writeBandEdge`.
 *
 * Reads on the frame, writes only on change: this runs on every frame of every scroll of the one
 * surface in the app that is always being scrolled.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { FADE_TOP } from "../../ui/scroll/Scroller.tsx";
import { fadeGeometry, heldBand, type FadeGeometry, type StickyRow } from "./sticky.ts";

/**
 * Where a group's rows stop being visible: the underside of its heading once that heading is held.
 *
 * Fixed by where a row sits rather than measured from where the pinned rows happen to be this frame.
 * A row inside a group can only reach the top of the pane while its own heading is held — the heading
 * comes first in the group and stays pinned until the whole group has scrolled past — so its line is
 * the rail plus that heading's height, on every frame. A row outside every group has only the strip
 * above it and falls back to the rail in CSS (`ly-under-pin` in `misc.css`).
 *
 * This used to be the measured underside of the pinned run, written each frame to the rows in the top
 * stretch of the pane. That is wrong exactly when it matters: on a fast fling a row, or a heading being
 * pushed out, travels from below that stretch to under the strip within two frames and arrives
 * carrying a stale line — or none, which is zero, and a row that only starts fading at the very top
 * edge is drawn whole across the tab strip. Measured at 5200px/s on a real sidebar: 27 of 364 frames
 * had one, in the recording as well as in the computed opacities. With the line fixed by structure it
 * is right on the first frame a row is drawn, and nothing is written while the list scrolls.
 *
 * The old version wrote to rows only because a variable changing on an ancestor recomputes the whole
 * subtree under it. That cost is per *write*, and this writes once per group and again only when the
 * heading's height changes (a font size, the compact layout) — a recompute of one group, not of the
 * list, and never during a scroll.
 */
function writeBandEdge(head: HTMLElement, height: number, rail: number, written: WeakMap<HTMLElement, number>): void {
	const band = head.parentElement;
	if (!band?.hasAttribute("data-ly-band")) return;
	const edge = Math.round((rail + height) * 2) / 2;
	if (written.get(band) === edge) return;
	band.style.setProperty("--ly-band-edge", `${edge}px`);
	written.set(band, edge);
}

/** Headings in or under a node that has just been added to the list. */
const headsWithin = (root: HTMLElement): HTMLElement[] => [
	...(root.matches("[data-ly-head]") ? [root] : []),
	...root.querySelectorAll<HTMLElement>("[data-ly-head]"),
];

/**
 * Attach to a scroll viewport. `rail` is the offset headings rest at, in pixels — the strip rests
 * at `gap`, and everything else under it.
 */
export function useStickyFade(viewport: React.RefObject<HTMLDivElement | null>, gap: number, rail: number): void {
	/** Found once per change to the list rather than once per frame. */
	const rows = useRef<{ node: HTMLElement; rail: number; head: boolean }[]>([]);
	const stale = useRef(true);
	const written = useRef<FadeGeometry>({ top: -1, inset: -1, room: -1, run: -1 });
	const frame = useRef(0);
	/** The edge last written on each group, so an unchanged one costs nothing. */
	const bandEdges = useRef(new WeakMap<HTMLElement, number>());

	const measure = useCallback(() => {
		const view = viewport.current;
		if (!view) return;

		if (stale.current) {
			const strip = view.querySelector<HTMLElement>("[data-ly-rail]");
			rows.current = [
				...(strip ? [{ node: strip, rail: gap, head: false }] : []),
				...[...view.querySelectorAll<HTMLElement>("[data-ly-head]")].map((node) => ({ node, rail, head: true })),
			];
			stale.current = false;
		}

		/*
		 * Every read, then the writes.
		 *
		 * `getBoundingClientRect` flushes pending layout, and a style written between two of them
		 * makes the next flush again — so interleaving would mean a forced reflow per pinned row,
		 * every frame.
		 */
		const origin = view.getBoundingClientRect().top;
		const measured: StickyRow[] = rows.current.map(({ node, rail: at }) => {
			const box = node.getBoundingClientRect();
			return { top: box.top - origin, bottom: box.bottom - origin, rail: at };
		});
		/*
		 * The depth the softening allows for is the depth it is about to eat into.
		 *
		 * Zero while the scroller is at its top: nothing is being softened then, so no row needs
		 * protecting from it, and a strip sitting a hundred pixels down is not "nearly held".
		 */
		const band = heldBand(measured, view.scrollTop > 0 ? FADE_TOP : 0);
		/*
		 * Where the held rows are, and nothing about how deep to soften.
		 *
		 * That split is the fix rather than a refactor. How deep is `--ly-fade-top`, it animates,
		 * and the sidebar's mask reaches it only through the lengths derived in `.ly-fade-y` — so
		 * a depth written from here is a transition overwritten with one of its own frames. It was
		 * also arithmetic that had the single-run case backwards: with one run `nextTop` equals
		 * `bottom`, so the gap it wrote was zero, every stop of that gradient landed on the same
		 * offset, and the sidebar went from opaque to transparent in no pixels at all. Which is to
		 * say it had no top fade — the reported defect, on every frame but the handful where a
		 * heading happened to be approaching its rail.
		 */
		const next = fadeGeometry(band);

		const last = written.current;
		if (last.top !== next.top || last.inset !== next.inset || last.room !== next.room || last.run !== next.run) {
			view.style.setProperty("--ly-hold-top", `${next.top}px`);
			view.style.setProperty("--ly-fade-inset", `${next.inset}px`);
			view.style.setProperty("--ly-hold-room", `${next.room}px`);
			view.style.setProperty("--ly-hold-run", `${next.run}px`);
			written.current = next;
		}
		// A heading's height from the box just read; written only when it differs (`writeBandEdge`).
		rows.current.forEach(({ node, head }, index) => {
			if (head) writeBandEdge(node, measured[index].bottom - measured[index].top, rail, bandEdges.current);
		});
	}, [viewport, gap, rail]);

	const schedule = useCallback(() => {
		if (frame.current) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			measure();
		});
	}, [measure]);

	useLayoutEffect(() => {
		const view = viewport.current;
		if (!view) return;
		stale.current = true;
		measure();

		view.addEventListener("scroll", schedule, { passive: true });

		/*
		 * A project folding shut changes heights without touching the DOM — CSS is animating a grid
		 * track — so only a `ResizeObserver` sees it, and it has to watch the blocks that shrink
		 * rather than the viewport, whose own size never changes.
		 */
		const sizes = new ResizeObserver(schedule);
		const watch = () => {
			sizes.disconnect();
			sizes.observe(view);
			for (const child of view.children) sizes.observe(child);
		};
		watch();

		/*
		 * Marks the cached rows stale and asks for a frame; it does not go looking for them here.
		 * Titles type themselves out a character at a time, which is a mutation per frame per
		 * running conversation, and re-querying the list on each one is work done many times over
		 * to reach the same answer. The next measurement needs it once.
		 *
		 * A heading that has just arrived is the exception, and it is taken from the records: its
		 * group needs its edge before the first frame it is drawn, not one frame after, or that frame
		 * fades its rows against the strip instead. Typing adds text nodes, which carry no headings.
		 */
		const changes = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue;
					for (const head of headsWithin(node)) writeBandEdge(head, head.getBoundingClientRect().height, rail, bandEdges.current);
				}
			}
			stale.current = true;
			watch();
			schedule();
		});
		changes.observe(view, { childList: true, subtree: true });

		return () => {
			view.removeEventListener("scroll", schedule);
			sizes.disconnect();
			changes.disconnect();
			if (frame.current) cancelAnimationFrame(frame.current);
		};
	}, [measure, schedule, viewport, rail]);

	// The list can be replaced without the viewport changing — switching tab, opening the archive.
	useEffect(() => {
		stale.current = true;
		schedule();
	});
}
