/**
 * The draggable boundary between two panes: the gap the cards leave between them.
 *
 * What appears is a short grip *at the pointer*, not a rule down the whole edge — the same
 * treatment the sidebar's handle uses, and for the same reason. A full-length line reads as a
 * border, a permanent piece of the layout, when what it means is "this particular spot can be
 * dragged". A grip that follows the pointer says that and nothing else, and leaves the boundary
 * looking the same whether or not you happen to be near it.
 *
 * The target is a nine-pixel strip centred on the seam, the narrowest a pointer finds reliably.
 *
 * It reports a *share*, not a delta. Summing deltas accumulates the clamping error — drag past
 * the floor, come back, and the boundary is short by however far past it you went.
 */

import { useEffect, useRef, useState } from "react";
import { freezeMotion } from "../../ui/motion/freeze.ts";
import { GRIP_SPAN, SPLITTER_HIT, SPLITTER_STEP } from "./geometry.ts";
import { shareFromPointer, type SplitterBox } from "./layout.ts";
import { pct } from "./css.ts";

export function Splitter({
	handle,
	containerRef,
	onResize,
	onEven,
}: {
	handle: SplitterBox;
	containerRef: React.RefObject<HTMLElement | null>;
	onResize: (share: number) => void;
	/** Double-click: give the two panes either side of this boundary equal room. */
	onEven: () => void;
}) {
	const row = handle.dir === "row";
	const [active, setActive] = useState(false);
	/** The live handle, so the move listener is not rebuilt (and the drag not dropped) per frame. */
	const current = useRef(handle);
	current.current = handle;
	/**
	 * The same fact as `active`, readable synchronously.
	 *
	 * A `pointermove` can arrive in the same task as the `pointerdown` that started the drag, and
	 * at that moment the state has not re-rendered yet — so a listener gated on `active` alone
	 * drops the first moves, and a short drag is dropped entirely.
	 */
	const dragging = useRef(false);
	/**
	 * The callback, held rather than depended on.
	 *
	 * It is rebuilt on every render of the dock, and resizing re-renders the dock — so listing it
	 * as a dependency tore the window listeners down and put them back on every frame of a drag.
	 * Which mostly worked, and intermittently did not: the drag would take the first move and then
	 * stop responding, because a `pointermove` arriving between the teardown and the re-attach has
	 * nothing listening for it.
	 */
	const report = useRef(onResize);
	report.current = onResize;
	/**
	 * Where along the seam the grip sits, in pixels from the strip's start.
	 *
	 * Null until the pointer arrives, so nothing is drawn on a boundary nobody is reaching for.
	 * Held as state rather than read from CSS because it also has to survive the drag: once the
	 * pointer leaves the nine-pixel strip this element stops receiving moves, and a grip that
	 * vanished mid-drag would leave you dragging an invisible edge.
	 */
	const [grip, setGrip] = useState<number | null>(null);
	const track = useRef<HTMLDivElement>(null);
	/**
	 * The dock's box, measured on the press and reused for the drag.
	 *
	 * The first `getBoundingClientRect` after the DOM has been touched is not a read: the browser
	 * lays the document out again, synchronously, to answer it. Pressing here changes the DOM —
	 * the grip appears, the panes are frozen — so the first measurement of the drag was paying for
	 * a full layout of the transcript behind it. Measured on a real session it took 61ms while
	 * every later frame of the same drag took under two.
	 *
	 * The dock does not move while one of its own boundaries is dragged, so this is the same
	 * rectangle every frame would have measured.
	 */
	const dock = useRef<DOMRect | null>(null);

	/*
	 * The cursor and the selection guard go on <body>, not on this element.
	 *
	 * Once a drag is under way the pointer spends most of its time over the panes either side, and
	 * a `cursor` here would only apply while it is over these nine pixels — so it would flicker
	 * back to a text caret the moment the drag left the strip. Same reasoning as `ResizeHandle`.
	 */
	useEffect(() => {
		if (!active) return;
		document.body.style.cursor = row ? "col-resize" : "row-resize";
		// Freezes the panes' own transitions, so they track the pointer instead of easing towards
		// each intermediate share and never arriving — and refuses the text selection a drag across
		// the panes would otherwise start. Both by naming things rather than by a flag above the
		// transcript; see `motion-freeze.ts`.
		const thaw = freezeMotion();
		document.documentElement.dataset.resizing = "";
		return () => {
			document.body.style.cursor = "";
			thaw();
			delete document.documentElement.dataset.resizing;
		};
	}, [active, row]);

	/*
	 * The drag listens on the window, not on this element.
	 *
	 * It used to rely on pointer capture and React's own `onPointerMove`, and that had two faults.
	 * `setPointerCapture` throws for a pointer id the browser does not know — which is every
	 * synthesised event, so the whole handler aborted before it could even mark the drag as
	 * started. And capture is not what makes a drag work here anyway: the pointer spends the drag
	 * over the panes either side, which do not deliver events to this element at all.
	 */
	useEffect(() => {
		if (!active) return;
		/*
		 * One update per frame — same reasoning as `ResizeHandle`.
		 *
		 * Pointer events outrun the display, and each one here measured two elements and set state
		 * twice. Several of those per frame is a layout thrash, and it is felt as the panes
		 * juddering while the seam itself tracks the pointer perfectly.
		 */
		let frame = 0;
		let pending: PointerEvent | null = null;

		const apply = () => {
			frame = 0;
			const event = pending;
			pending = null;
			if (!event || !dragging.current) return;

			const container = dock.current ?? containerRef.current?.getBoundingClientRect();
			if (!container) return;
			report.current(shareFromPointer(current.current, row ? event.clientX : event.clientY, container));
		};

		const onMove = (event: PointerEvent) => {
			if (!dragging.current) return;
			pending = event;
			if (!frame) frame = requestAnimationFrame(apply);
		};
		const stop = (event: PointerEvent) => {
			dragging.current = false;
			dock.current = null;
			setActive(false);
			// A drag almost always ends somewhere else — that is the point of it — so the grip is
			// only kept if the pointer happens to have come to rest back on the seam.
			const box = track.current?.getBoundingClientRect();
			const over =
				box &&
				event.clientX >= box.left &&
				event.clientX <= box.right &&
				event.clientY >= box.top &&
				event.clientY <= box.bottom;
			if (!over) setGrip(null);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			// Nothing left scheduled against a seam that is no longer being dragged.
			if (frame) cancelAnimationFrame(frame);
		};
	}, [active, row, containerRef]);

	return (
		<div
			ref={track}
			onPointerEnter={(event) => {
				const box = event.currentTarget.getBoundingClientRect();
				setGrip(row ? event.clientY - box.top : event.clientX - box.left);
			}}
			onPointerMove={(event) => {
				if (dragging.current) return;
				const box = event.currentTarget.getBoundingClientRect();
				setGrip(row ? event.clientY - box.top : event.clientX - box.left);
			}}
			// Stays put while dragging: by then the pointer is usually well outside the strip.
			onPointerLeave={() => {
				if (!dragging.current) setGrip(null);
			}}
			role="separator"
			aria-orientation={row ? "vertical" : "horizontal"}
			aria-label="调整面板大小"
			aria-valuenow={Math.round((handle.share / handle.pair) * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			tabIndex={0}
			onPointerDown={(event) => {
				// Left button only: a right-click here should not start a silent drag.
				if (event.button !== 0) return;
				event.preventDefault();
				// While the layout is still clean, before the freeze and the grip change it.
				dock.current = containerRef.current?.getBoundingClientRect() ?? null;
				dragging.current = true;
				setActive(true);
			}}
			onDoubleClick={onEven}
			onKeyDown={(event) => {
				const step = (event.shiftKey ? SPLITTER_STEP * 4 : SPLITTER_STEP) * handle.pair;
				const grow = row ? "ArrowRight" : "ArrowDown";
				const shrink = row ? "ArrowLeft" : "ArrowUp";
				if (event.key === grow) onResize(handle.share + step);
				else if (event.key === shrink) onResize(handle.share - step);
				else if (event.key === "Home") onEven();
				else return;
				event.preventDefault();
			}}
			style={
				row
					? {
							left: pct(handle.left),
							top: pct(handle.top),
							height: pct(handle.height),
							width: SPLITTER_HIT,
							marginLeft: -SPLITTER_HIT / 2,
						}
					: {
							left: pct(handle.left),
							top: pct(handle.top),
							width: pct(handle.width),
							height: SPLITTER_HIT,
							marginTop: -SPLITTER_HIT / 2,
						}
			}
			className={`ly-splitter absolute z-20 ${row ? "cursor-col-resize" : "cursor-row-resize"}`}
		>
			{/*
			 * A short rounded bar at the pointer, on the seam itself.
			 *
			 * Clamped away from the ends so it never rides up into a title bar or out of the pane
			 * below — at those extremes it stops travelling rather than sliding out of view.
			 */}
			{grip !== null && (
				<span
					aria-hidden
					/*
					 * Sized inline rather than with utilities: the length is a shared constant, and a
					 * class name built from a template is not something the CSS build can see.
					 */
					style={
						row
							? {
									top: `clamp(${GRIP_SPAN / 2 + 8}px, ${grip}px, calc(100% - ${GRIP_SPAN / 2 + 8}px))`,
									left: "50%",
									height: GRIP_SPAN,
									width: 3,
								}
							: {
									left: `clamp(${GRIP_SPAN / 2 + 8}px, ${grip}px, calc(100% - ${GRIP_SPAN / 2 + 8}px))`,
									top: "50%",
									width: GRIP_SPAN,
									height: 3,
								}
					}
					className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-[var(--ly-t-quick)] ${
						active ? "bg-accent" : "bg-ink-faint/45"
					}`}
				/>
			)}
		</div>
	);
}
