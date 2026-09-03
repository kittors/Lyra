import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How deep the softening reaches. The bottom is the edge content moves through — a list grows
 *  downwards, a transcript streams into it — and a shallow fade there reads as a cut.
 *
 *  The top is exported because a scroller with rows pinned in it has to know: a row within this
 *  distance of its rail is already inside the softening, and holding it whole from there is what
 *  keeps it from dissolving on the way up. See `sidebar/sticky.ts`. */
export const FADE_TOP = 36;
const FADE_BOTTOM = 48;

/**
 * The app's only scrolling surface.
 *
 * Three things the native scroller does not do, and which the reference has everywhere:
 *
 *   - a scrollbar that overlays the content instead of reserving a gutter, so nothing
 *     reflows sideways the moment a list grows past its box;
 *   - an edge that says more is hidden that way, drawn as whatever the boundary actually is:
 *     a fade where content dissolves into empty space, a hairline where it slides under
 *     something solid. See `top` — picking the wrong one is what makes a list look broken.
 *
 * `overscroll-contain` keeps a wheel that reaches the end here rather than passing it to the
 * window behind — a nested list would otherwise scroll its parent as soon as it bottomed out.
 */
export function Scroller({
	children,
	className = "",
	contentClassName = "",
	top = "fade",
	bottom = "fade",
	onScroll,
	onResize,
	scrollRef,
}: {
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
	/**
	 * How the top edge ends.
	 *
	 * `"fade"` softens the last rows away, which says "there is more this way" without drawing
	 * anything. It works whatever is above — empty pane or opaque nav — because it takes the
	 * content's own alpha down rather than painting over it; see `.ly-fade-y` in styles.css for
	 * why that distinction is the whole story.
	 *
	 * `"line"` is a hairline instead: the boundary stated rather than the content softened. For
	 * places where the edge itself is the point — a toolbar you should read as a fixed rail.
	 *
	 * Either only appears once something has actually gone under, so a short list has no edge
	 * treatment at all: a boundary is worth drawing when it is doing something.
	 */
	top?: "fade" | "line" | "none";
	/** Same question at the bottom, minus the hairline: nothing is ever pinned below the content. */
	bottom?: "fade" | "none";
	onScroll?: (element: HTMLDivElement) => void;
	/** Called whenever content or viewport dimensions change. */
	onResize?: (element: HTMLDivElement) => void;
	/** Exposed for callers that drive the scroll position themselves, like the transcript. */
	scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
	const own = useRef<HTMLDivElement>(null);
	const viewport = scrollRef ?? own;
	const drag = useRef<{ startY: number; startTop: number } | null>(null);

	const [metrics, setMetrics] = useState({ thumbTop: 0, thumbHeight: 0, overflow: false, atTop: true, atBottom: true });
	const [active, setActive] = useState(false);

	const measure = useCallback(() => {
		const el = viewport.current;
		if (!el) return;
		const { scrollTop, scrollHeight, clientHeight } = el;
		const overflow = scrollHeight - clientHeight > 1;
		// A thumb shorter than this is impossible to grab; it stops tracking exactly once the
		// content is very long, which is a fair trade for staying usable.
		const thumbHeight = overflow ? Math.max(28, (clientHeight / scrollHeight) * clientHeight) : 0;
		const travel = clientHeight - thumbHeight;
		const progress = scrollHeight - clientHeight <= 0 ? 0 : scrollTop / (scrollHeight - clientHeight);
		const newThumbTop = travel * progress;
		const newAtTop = scrollTop <= 1;
		const newAtBottom = scrollTop >= scrollHeight - clientHeight - 1;

		setMetrics((prev) => {
			if (
				Math.abs(prev.thumbTop - newThumbTop) < 0.5 &&
				Math.abs(prev.thumbHeight - thumbHeight) < 0.5 &&
				prev.overflow === overflow &&
				prev.atTop === newAtTop &&
				prev.atBottom === newAtBottom
			) {
				return prev;
			}
			return {
				thumbTop: newThumbTop,
				thumbHeight,
				overflow,
				atTop: newAtTop,
				atBottom: newAtBottom,
			};
		});
	}, [viewport]);

	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		measure();
		onResize?.(el);

		let frame = 0;
		const scheduleMeasure = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				measure();
				if (viewport.current) onResize?.(viewport.current);
			});
		};

		/*
		 * The content is watched, not just the box — they are different measurements.
		 *
		 * `observe(el)` alone reports the *viewport's* size, and the viewport is a flex item: its
		 * height is decided by the layout above it and does not move when what is inside grows or
		 * shrinks. So collapsing a tool group — which animates an inner height to zero without
		 * touching a single node — changed `scrollHeight` by hundreds of pixels and fired nothing.
		 * Measured: shrinking a child from 900px to 200px produced zero callbacks.
		 *
		 * Watching the direct children fixes it, because height propagates outward through ordinary
		 * block flow: a group three levels down collapses, its ancestors shorten, and the child of
		 * the viewport shortens with them.
		 *
		 * The mutation observer stays, and now has a second job: children come and go as messages
		 * arrive, and a new one has to be picked up by the size observer too.
		 */
		const observer = new ResizeObserver(scheduleMeasure);
		const watch = () => {
			observer.disconnect();
			observer.observe(el);
			for (const child of el.children) observer.observe(child);
		};
		watch();

		const mutations = new MutationObserver(() => {
			watch();
			scheduleMeasure();
		});
		mutations.observe(el, { childList: true, subtree: false });

		return () => {
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			mutations.disconnect();
		};
	}, [measure, onResize, viewport]);

	// Dragging continues outside the thumb, so the listeners live on the window.
	useEffect(() => {
		if (!drag.current && !active) return;
		let frame = 0;
		let latestEvent: MouseEvent | null = null;

		const updateScroll = () => {
			frame = 0;
			const event = latestEvent;
			if (!event) return;
			const el = viewport.current;
			const state = drag.current;
			if (!el || !state) return;
			const travel = el.clientHeight - metrics.thumbHeight;
			if (travel <= 0) return;
			const ratio = (event.clientY - state.startY) / travel;
			el.scrollTop = state.startTop + ratio * (el.scrollHeight - el.clientHeight);
		};

		const onMove = (event: MouseEvent) => {
			latestEvent = event;
			if (!frame) {
				frame = requestAnimationFrame(updateScroll);
			}
		};
		const onUp = () => {
			drag.current = null;
			setActive(false);
			if (frame) cancelAnimationFrame(frame);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [active, metrics.thumbHeight, viewport]);

	// Both only mean anything once something is actually hidden that way.
	const hiddenAbove = metrics.overflow && !metrics.atTop;
	const showTopFade = top === "fade" && hiddenAbove;
	const showTopLine = top === "line" && hiddenAbove;
	const showBottomFade = bottom === "fade" && metrics.overflow && !metrics.atBottom;
	const fades = top === "fade" || bottom === "fade";

	return (
		<div className={`ly-scroll-host relative flex min-h-0 flex-col ${className}`}>
			<div
				ref={viewport}
				onScroll={(event) => {
					measure();
					onScroll?.(event.currentTarget);
				}}
				/*
				 * A flex child, not `height: 100%`.
				 *
				 * `height: 100%` needs a parent with a *resolved* height. Given one bounded by
				 * `max-height` instead — which is how every menu here is sized — it resolves to
				 * `auto`, the viewport grows with its content, and nothing scrolls: the branch
				 * list simply ran off the bottom of its own menu. Percentage `max-height` fails
				 * the same way, for the same reason. Making the host a flex column and this its
				 * item hands the sizing to the flex algorithm, which honours both a fixed height
				 * and a `max-height` — so one Scroller works in a pane and in a popover.
				 */
				/*
				 * The fade is a mask on this element, and the depths are the whole of its state —
				 * zero means no fade, so the same declaration covers both ends and both directions
				 * and the transition between them is one interpolating length. Only mounted with the
				 * class where a fade is possible: a mask promotes the scroller to its own composited
				 * layer, and there is no reason to pay that on a scroller that will never soften.
				 */
				/*
				 * Vertical only, and `overflow-x` stated rather than left to the browser.
				 *
				 * `overflow-y: auto` with `overflow-x: visible` is not a combination CSS has: the
				 * spec makes the visible one `auto` too. So every scroller in the app was quietly
				 * able to scroll sideways, and one over-wide child — a code block holding a commit
				 * hash, a table — dragged the whole column with it. What you saw was the transcript
				 * itself shifted left, headings and prose and all, to make room for something that
				 * has its own way of handling being too wide.
				 *
				 * Which is the actual fix: `pre` already scrolls itself (see `.prose-dw pre`), and
				 * clipping here is what lets it. A reading column has no meaning off to the right —
				 * anything genuinely wider than the window is wide *inside* its own box.
				 */
				className={`ly-scroll-view min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain ${
					fades ? "ly-fade-y" : ""
				} ${contentClassName}`}
				style={
					fades
						? ({
								"--ly-fade-top": showTopFade ? `${FADE_TOP}px` : "0px",
								"--ly-fade-bottom": showBottomFade ? `${FADE_BOTTOM}px` : "0px",
							} as React.CSSProperties)
						: undefined
				}
			>
				{children}
			</div>

			{top === "line" && (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 h-px bg-line transition-opacity duration-[var(--ly-t-base)]"
					style={{ opacity: showTopLine ? 1 : 0 }}
				/>
			)}

			{metrics.overflow && (
				<div
					/*
					 * On the edge, above everything on it, and taking no clicks of its own.
					 *
					 * Two things want this strip: the thumb, and — in a resizable pane — the drag handle
					 * that widens it. They used to be at the same depth with the handle on top, so the
					 * thumb was drawn, could be seen, and could never be grabbed. Insetting the track
					 * past the handle did fix that and cost more than it was worth: a scrollbar floating
					 * nine pixels off the edge it belongs to, in every pane in the app.
					 *
					 * They are not really competing, though, because the track is not a control. It has
					 * no fill and nothing to hit — only the thumb inside it does. So the track goes above
					 * the handle to keep the thumb visible over sticky headers and hands every press
					 * straight through; the thumb takes its own back. What is left is a thumb-shaped
					 * hole in the resize strip, at a spot the pointer can see, rather than a scrollbar
					 * moved out of position everywhere to make room for a handle in one pane.
					 *
					 * Clicking the track to jump goes with it. It was never discoverable on a 10px strip
					 * with no visible track, and it is not worth an edge you cannot drag.
					 */
					className="pointer-events-none absolute top-0 right-0 bottom-0 z-40 w-[10px]"
				>
					{/* Hidden from assistive technology: the viewport underneath is what scrolls. */}
					<div
						aria-hidden
						tabIndex={-1}
						onMouseDown={(event) => {
							event.preventDefault();
							const el = viewport.current;
							if (!el) return;
							drag.current = { startY: event.clientY, startTop: el.scrollTop };
							setActive(true);
						}}
						style={{ top: metrics.thumbTop, height: metrics.thumbHeight }}
						className={`ly-thumb absolute right-[2px] w-[6px] rounded-full bg-ink-faint ${active ? "ly-thumb-active" : ""}`}
					/>
				</div>
			)}
		</div>
	);
}
