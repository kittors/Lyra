/**
 * The draggable boundary between two conversation panes.
 *
 * Copied from the dock's handle rather than imported: that one is typed on panel kinds, and
 * pulling it across the feature door would couple tiling to the tool dock. The behaviour is
 * the same — one update per frame, measure the container once, freeze motion while dragging —
 * because those were measured, not guessed.
 */

import { translate } from "../../i18n/translate.ts";
import { useEffect, useRef, useState } from "react";
import { freezeMotion } from "../../ui/motion/freeze.ts";
import { GRIP_SPAN, SPLITTER_HIT, SPLITTER_STEP, pct, shareFromPointer, type SplitterBox } from "./layout.ts";
import { holdSplitPersist } from "./persist.ts";

export function Splitter({
	handle,
	containerRef,
	onResize,
	onEven,
}: {
	handle: SplitterBox;
	containerRef: React.RefObject<HTMLElement | null>;
	onResize: (share: number) => void;
	onEven: () => void;
}) {
	const row = handle.dir === "row";
	const [active, setActive] = useState(false);
	const current = useRef(handle);
	current.current = handle;
	const dragging = useRef(false);
	const report = useRef(onResize);
	report.current = onResize;
	const [grip, setGrip] = useState<number | null>(null);
	const track = useRef<HTMLDivElement>(null);
	const dock = useRef<DOMRect | null>(null);

	useEffect(() => {
		if (!active) return;
		document.body.style.cursor = row ? "col-resize" : "row-resize";
		const thaw = freezeMotion();
		const release = holdSplitPersist();
		document.documentElement.dataset.resizing = "";
		return () => {
			document.body.style.cursor = "";
			thaw();
			release();
			delete document.documentElement.dataset.resizing;
		};
	}, [active, row]);

	useEffect(() => {
		if (!active) return;
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
			if (frame) cancelAnimationFrame(frame);
		};
	}, [active, row, containerRef]);

	return (
		<div
			ref={track}
			data-ly-split-handle
			onPointerEnter={(event) => {
				const box = event.currentTarget.getBoundingClientRect();
				const next = row ? event.clientY - box.top : event.clientX - box.left;
				setGrip((current) => (current !== null && Math.round(current) === Math.round(next) ? current : next));
			}}
			onPointerMove={(event) => {
				if (dragging.current) return;
				const box = event.currentTarget.getBoundingClientRect();
				const next = row ? event.clientY - box.top : event.clientX - box.left;
				setGrip((current) => (current !== null && Math.round(current) === Math.round(next) ? current : next));
			}}
			onPointerLeave={() => {
				if (!dragging.current) setGrip(null);
			}}
			role="separator"
			aria-orientation={row ? "vertical" : "horizontal"}
			aria-label={translate("splitter.resizePane")}
			aria-valuenow={Math.round((handle.share / handle.pair) * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			tabIndex={0}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
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
			<span
				aria-hidden
				className={`pointer-events-none absolute bg-line ${
					row ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"
				}`}
			/>
			{grip !== null && (
				<span
					aria-hidden
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
