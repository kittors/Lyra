import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A scrollbar for a surface the app does not own the markup of.
 *
 * `Scroller` covers everything the app renders itself. This is for the two places it cannot
 * reach — CodeMirror's scroller and the diff's — where the element scrolls but its DOM belongs
 * to something else. Given a ref to that element, this draws the same thumb over it.
 *
 * Native bars are not an option here. They are hidden globally so that every surface goes
 * through `Scroller`, and re-enabling them per element does not give the same control back: on
 * macOS an overlay scrollbar ignores `::-webkit-scrollbar` styling entirely and appears only
 * while the wheel is turning, so a still pane looks like it has no scrollbar at all — which is
 * exactly how the editor read. Drawn here it follows the app's own rules, and never takes a
 * pixel of width from the content.
 *
 * The two directions are deliberately not shown the same way, matching the diff's reasoning:
 * vertical overflow announces itself, because the content is visibly cut off at the bottom edge,
 * so a thumb on hover is enough. A line that runs off to the right looks exactly like a line
 * that ended there, and nothing moves to say otherwise — so that one stays visible.
 *
 * Not shared with the diff's own sideways thumb, which needs `sticky` rather than `absolute`:
 * that one sits inside a much taller vertical scroller, where a bar pinned to the bottom of the
 * content would only come into view after you had scrolled past everything it was meant to help
 * with. Here the element being scrolled *is* the pane, so its bottom edge is the right place.
 */
export function OverlayScrollbar({
	viewport,
	orientation,
}: {
	viewport: React.RefObject<HTMLElement | null>;
	orientation: "vertical" | "horizontal";
}) {
	const vertical = orientation === "vertical";
	const track = useRef<HTMLDivElement>(null);
	const drag = useRef<{ start: number; from: number } | null>(null);
	const [metrics, setMetrics] = useState({ offset: 0, size: 0, overflow: false });
	const [active, setActive] = useState(false);

	const measure = useCallback(() => {
		const el = viewport.current;
		if (!el) return;
		const length = vertical ? el.clientHeight : el.clientWidth;
		const total = vertical ? el.scrollHeight : el.scrollWidth;
		const at = vertical ? el.scrollTop : el.scrollLeft;

		const overflow = total - length > 1;
		// Below about 28px a thumb is impossible to grab; it stops tracking exactly once the
		// content is very long, which is a fair trade for staying usable.
		const size = overflow ? Math.max(28, (length / total) * length) : 0;
		const travel = length - size;
		const progress = total - length <= 0 ? 0 : at / (total - length);
		setMetrics({ offset: travel * progress, size, overflow });
	}, [vertical, viewport]);

	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		measure();
		el.addEventListener("scroll", measure, { passive: true });

		// Both are needed: the box changes when the pane resizes, the content when a file is
		// edited or a grammar finishes loading and reflows it.
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		const mutations = new MutationObserver(measure);
		mutations.observe(el, { childList: true, subtree: true, characterData: true });

		return () => {
			el.removeEventListener("scroll", measure);
			observer.disconnect();
			mutations.disconnect();
		};
	}, [measure, viewport]);

	// Dragging continues outside the thumb, so the listeners live on the window.
	useEffect(() => {
		if (!active) return;
		const onMove = (event: MouseEvent) => {
			const el = viewport.current;
			const state = drag.current;
			if (!el || !state) return;
			const length = vertical ? el.clientHeight : el.clientWidth;
			const total = vertical ? el.scrollHeight : el.scrollWidth;
			const travel = length - metrics.size;
			if (travel <= 0) return;
			const ratio = ((vertical ? event.clientY : event.clientX) - state.start) / travel;
			const next = state.from + ratio * (total - length);
			if (vertical) el.scrollTop = next;
			else el.scrollLeft = next;
		};
		const onUp = () => {
			drag.current = null;
			setActive(false);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [active, metrics.size, vertical, viewport]);

	if (!metrics.overflow) return null;

	return (
		<div
			ref={track}
			className={`pointer-events-auto absolute z-[3] ${vertical ? "top-0 right-0 bottom-0 w-[10px]" : "right-0 bottom-0 left-0 h-[10px]"}`}
			onMouseDown={(event) => {
				// Clicking the track jumps to that spot, then hands over to the drag.
				if (event.target !== track.current) return;
				const el = viewport.current;
				if (!el || !track.current) return;
				const rect = track.current.getBoundingClientRect();
				const length = vertical ? el.clientHeight : el.clientWidth;
				const total = vertical ? el.scrollHeight : el.scrollWidth;
				const travel = length - metrics.size;
				const from = vertical ? event.clientY - rect.top : event.clientX - rect.left;
				const ratio = (from - metrics.size / 2) / Math.max(1, travel);
				const next = Math.min(1, Math.max(0, ratio)) * (total - length);
				if (vertical) el.scrollTop = next;
				else el.scrollLeft = next;
			}}
		>
			{/*
			 * Hidden from assistive technology on purpose.
			 *
			 * The thing that actually scrolls is the viewport underneath, and that is what a screen
			 * reader should be driving. Declaring `role="scrollbar"` here without a value announces
			 * a control that reports nothing — worse than not being there at all.
			 */}
			<div
				aria-hidden
				tabIndex={-1}
				onMouseDown={(event) => {
					event.preventDefault();
					const el = viewport.current;
					if (!el) return;
					drag.current = {
						start: vertical ? event.clientY : event.clientX,
						from: vertical ? el.scrollTop : el.scrollLeft,
					};
					setActive(true);
				}}
				style={
					vertical
						? { top: metrics.offset, height: metrics.size }
						: { left: metrics.offset, width: metrics.size }
				}
				className={`absolute rounded-full bg-ink-faint ${
					vertical
						? `ly-thumb right-[2px] w-[6px] ${active ? "ly-thumb-active" : ""}`
						: `ly-hthumb bottom-[2px] h-[6px] ${active ? "ly-hthumb-active" : ""}`
				}`}
			/>
		</div>
	);
}
