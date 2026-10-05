/**
 * Keep the scroller's upper fade below the rows pinned over it.
 *
 * The rows are held by `position: sticky`; this only tells the mask where they currently are, as
 * the four lengths of `fadeGeometry`. How deeply to soften around them is `.ly-fade-y`'s, because
 * the depth being divided animates and a number frozen here cannot follow it. `sticky.ts` has the
 * reasoning, including why this being a frame behind is harmless when the placement was not.
 *
 * Reads on the frame, writes only on change: this runs on every frame of every scroll of the one
 * surface in the app that is always being scrolled.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { FADE_TOP } from "../../ui/scroll/Scroller.tsx";
import { fadeGeometry, heldBand, type FadeGeometry, type StickyRow } from "./sticky.ts";

/** Elements that fade out against the pinned rows' underside — the readers of `--ly-held-edge` (`ly-under-pin` in `misc.css`). */
const EDGE_READERS = "[data-ly-row], [data-ly-fades], [data-ly-band]";

/*
 * The line is written only to the elements in the top stretch: a quarter screen above the viewport down
 * to its middle.
 *
 * It used to be set on the scroller and inherited by every row. When an inherited variable changes, the
 * whole list's styles are recomputed, at a cost that grows with the number of mounted elements — 100ms
 * at two hundred projects, still 10ms at twenty — and while scrolling past a project heading's handover
 * it changes nearly every frame. Only the few rows about to slide under a pinned row actually need the
 * line: rows further down are far from it and stay opaque with a stale value; rows past the top edge
 * are already at 0. So the variable is registered as not inherited and written to the few dozen
 * elements in this stretch.
 *
 * The quarter screen above is for rows coming back in at the top on a scroll back up:
 * `IntersectionObserver` reports a frame late, and they have to be written before they show.
 */
const NEAR_TOP = "25% 0px -50% 0px";

/*
 * Groups are chosen more tightly than rows: only those whose bottom edge is within this distance of the
 * line are written.
 *
 * A group carries a scroll timeline (its heading fades out by it), and each write recomputes the group's
 * whole subtree, over half a millisecond a time; collapsed projects are one heading tall, a dozen of
 * them fit in the top stretch, and writing them all every frame was ten-odd milliseconds again. A heading
 * only fades within 36px of its group's bottom edge reaching the line, so groups further down are fine
 * with a stale value. The extra stretch is for the distance one frame can scroll: they must be written
 * before their bottom edge comes within 36px.
 */
const BAND_LEAD = FADE_TOP + 48;

function writeEdge(node: HTMLElement, edge: number, written: WeakMap<HTMLElement, number>): void {
	if (written.get(node) === edge) return;
	node.style.setProperty("--ly-held-edge", `${edge}px`);
	written.set(node, edge);
}

/**
 * Attach to a scroll viewport. `rail` is the offset headings rest at, in pixels — the strip rests
 * at `gap`, and everything else under it.
 */
export function useStickyFade(viewport: React.RefObject<HTMLDivElement | null>, gap: number, rail: number): void {
	/** Found once per change to the list rather than once per frame. */
	const rows = useRef<{ node: HTMLElement; rail: number }[]>([]);
	const stale = useRef(true);
	const written = useRef<FadeGeometry>({ top: -1, inset: -1, room: -1, run: -1 });
	const frame = useRef(0);
	/** The readers in the top stretch, and the value currently written on each. See `NEAR_TOP`. */
	const near = useRef(new Set<HTMLElement>());
	const edgeOn = useRef(new WeakMap<HTMLElement, number>());
	const edge = useRef(0);

	const measure = useCallback(() => {
		const view = viewport.current;
		if (!view) return;

		if (stale.current) {
			const strip = view.querySelector<HTMLElement>("[data-ly-rail]");
			rows.current = [
				...(strip ? [{ node: strip, rail: gap }] : []),
				...[...view.querySelectorAll<HTMLElement>("[data-ly-head]")].map((node) => ({ node, rail })),
			];
			stale.current = false;
		}

		/*
		 * Every read, then the one write.
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

		// Still in the reading phase: measure first, write after, for the reason above.
		const bands: HTMLElement[] = [];
		for (const node of near.current) {
			if (!node.hasAttribute("data-ly-band")) continue;
			const bottom = node.getBoundingClientRect().bottom - origin;
			if (bottom >= 0 && bottom <= next.inset + BAND_LEAD) bands.push(node);
		}

		const last = written.current;
		if (last.top !== next.top || last.inset !== next.inset || last.room !== next.room || last.run !== next.run) {
			view.style.setProperty("--ly-hold-top", `${next.top}px`);
			view.style.setProperty("--ly-fade-inset", `${next.inset}px`);
			view.style.setProperty("--ly-hold-room", `${next.room}px`);
			view.style.setProperty("--ly-hold-run", `${next.run}px`);
			written.current = next;
		}
		/*
		 * The same underside again, for the list's rows: they fade out against it before sliding under a
		 * pinned row. Written only to the top stretch — see `NEAR_TOP` and `BAND_LEAD`. Done even when the
		 * line has not moved: groups are chosen by position, and one that has just slid in needs it.
		 */
		edge.current = next.inset;
		for (const node of near.current) if (!node.hasAttribute("data-ly-band")) writeEdge(node, next.inset, edgeOn.current);
		for (const node of bands) writeEdge(node, next.inset, edgeOn.current);
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
		// The set itself is never replaced, only its members change; taken once for the cleanup rather than read from the ref there.
		const nearby = near.current;
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
		 * A reader that has just mounted gets the current value at once rather than when it reaches the top
		 * stretch: switching tabs or opening the archive swaps the whole list in at the top, and one frame of
		 * waiting is one frame of rows not faded against the line.
		 */
		const readers = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const node = entry.target as HTMLElement;
					if (!entry.isIntersecting) {
						near.current.delete(node);
						continue;
					}
					near.current.add(node);
					// Groups wait for `measure` to choose them by position; writing here would make every group that slides in pay a recompute.
					if (!node.hasAttribute("data-ly-band")) writeEdge(node, edge.current, edgeOn.current);
				}
			},
			{ root: view, rootMargin: NEAR_TOP },
		);
		const within = (root: HTMLElement) => [...(root.matches(EDGE_READERS) ? [root] : []), ...root.querySelectorAll<HTMLElement>(EDGE_READERS)];
		const adopt = (root: HTMLElement) => {
			for (const node of within(root)) {
				writeEdge(node, edge.current, edgeOn.current);
				readers.observe(node);
			}
		};
		const drop = (root: HTMLElement) => {
			for (const node of within(root)) {
				readers.unobserve(node);
				near.current.delete(node);
			}
		};
		adopt(view);

		/*
		 * Marks the cached rows stale and asks for a frame; it does not go looking for them here.
		 * Titles type themselves out a character at a time, which is a mutation per frame per
		 * running conversation, and re-querying the list on each one is work done many times over
		 * to reach the same answer. The next measurement needs it once. Readers that came or went are
		 * the one thing taken from the records: typing adds text nodes, which carry none.
		 */
		const changes = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.removedNodes) if (node instanceof HTMLElement) drop(node);
				for (const node of record.addedNodes) if (node instanceof HTMLElement) adopt(node);
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
			readers.disconnect();
			nearby.clear();
			if (frame.current) cancelAnimationFrame(frame.current);
		};
	}, [measure, schedule, viewport]);

	// The list can be replaced without the viewport changing — switching tab, opening the archive.
	useEffect(() => {
		stale.current = true;
		schedule();
	});
}
