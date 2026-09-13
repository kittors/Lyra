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
import { fadeGeometry, heldBand, isPinned, type FadeGeometry, type StickyRow } from "./sticky.ts";

/** Marks a row the browser is currently holding at its rail. `.ly-pin` fills only while it is set. */
const STUCK = "data-ly-stuck";

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

		const last = written.current;
		if (last.top !== next.top || last.inset !== next.inset || last.room !== next.room || last.run !== next.run) {
			view.style.setProperty("--ly-hold-top", `${next.top}px`);
			view.style.setProperty("--ly-fade-inset", `${next.inset}px`);
			view.style.setProperty("--ly-hold-room", `${next.room}px`);
			view.style.setProperty("--ly-hold-run", `${next.run}px`);
			written.current = next;
		}

		/*
		 * And which rows are being held, so only those draw a fill.
		 *
		 * The fill exists to hide the list passing underneath a held row, and a row travelling with
		 * the list has nothing passing underneath it — so on a translucent pane it was a band of
		 * opaque colour sitting on every project name at rest, which is what the pane is translucent
		 * to avoid. CSS cannot ask "is this sticky element currently stuck", and this loop has just
		 * measured exactly that.
		 *
		 * After the reads and after the one style write, never between them: an attribute that only
		 * selects a background changes no geometry, so nothing below needs measuring again. Compared
		 * before writing because this runs on every frame of every scroll and the state flips once
		 * per row per pass.
		 */
		for (let i = 0; i < measured.length; i++) {
			const node = rows.current[i].node;
			const held = isPinned(measured[i]);
			if (node.hasAttribute(STUCK) !== held) node.toggleAttribute(STUCK, held);
		}
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
		 */
		const changes = new MutationObserver(() => {
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
	}, [measure, schedule, viewport]);

	// The list can be replaced without the viewport changing — switching tab, opening the archive.
	useEffect(() => {
		stale.current = true;
		schedule();
	});
}
