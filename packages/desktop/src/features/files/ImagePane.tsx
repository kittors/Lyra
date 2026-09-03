/**
 * An image in the file pane, at a size you choose.
 *
 * It used to be an `<img>` that fitted the pane and nothing else, which is fine right up until the
 * thing you need to see is a 12-pixel icon or one corner of a screenshot. Neither is a rare case in
 * a repository — icons and screenshots are most of the images anybody commits.
 *
 * So: wheel to zoom about the pointer, drag to pan, double-click to toggle between fitting the
 * pane and actual size. The same gestures every image viewer has, which is the point — this is not
 * a place to invent any.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Text } from "../../ui/primitives/Text.tsx";

/** Far enough in to inspect a single pixel, far enough out to see a poster whole. */
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export function ImagePane({ src, name }: { src: string; name: string }) {
	const viewport = useRef<HTMLDivElement>(null);
	const image = useRef<HTMLImageElement>(null);
	/** null means "fit the pane", which is a different state from any particular number. */
	const [scale, setScale] = useState<number | null>(null);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
	const [fitted, setFitted] = useState(1);

	// A different file starts over, rather than inheriting the last one's zoom.
	useEffect(() => {
		setScale(null);
		setOffset({ x: 0, y: 0 });
		setNatural(null);
	}, [src]);

	/** What "fit" currently means, in the same units as an explicit zoom. */
	const measureFit = useCallback(() => {
		const box = viewport.current?.getBoundingClientRect();
		if (!box || !natural) return 1;
		// Never enlarge to fit: a 16px icon blown up to fill the pane is not what fitting means.
		return Math.min(1, (box.width - 24) / natural.width, (box.height - 24) / natural.height);
	}, [natural]);

	useEffect(() => {
		setFitted(measureFit());
	}, [measureFit]);

	const effective = scale ?? fitted;

	/**
	 * Zoom about the pointer rather than about the centre.
	 *
	 * Zooming about the centre means the thing you were looking at slides away exactly when you
	 * lean in on it. Keeping the point under the cursor still is what makes a wheel usable for
	 * inspecting one corner of a large picture.
	 */
	const zoomAt = useCallback(
		(factor: number, clientX?: number, clientY?: number) => {
			const box = viewport.current?.getBoundingClientRect();
			const from = scale ?? fitted;
			const to = clamp(from * factor);
			if (to === from) return;

			if (box && clientX !== undefined && clientY !== undefined) {
				// Where the cursor is, relative to the pane's centre, before and after.
				const dx = clientX - (box.left + box.width / 2);
				const dy = clientY - (box.top + box.height / 2);
				const ratio = to / from;
				setOffset((current) => ({
					x: dx - (dx - current.x) * ratio,
					y: dy - (dy - current.y) * ratio,
				}));
			}
			setScale(to);
		},
		[scale, fitted],
	);

	useEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			// Trackpad pinch arrives as ctrl+wheel; a plain wheel over an image means zoom here too,
			// because there is nothing else in this pane to scroll.
			event.preventDefault();
			zoomAt(Math.exp(-event.deltaY / 320), event.clientX, event.clientY);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [zoomAt]);

	const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

	const reset = () => {
		setScale(null);
		setOffset({ x: 0, y: 0 });
	};

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
			<div
				ref={viewport}
				className="ly-checker relative min-h-0 flex-1 overflow-hidden"
				style={{ cursor: drag.current ? "grabbing" : effective > fitted ? "grab" : "default" }}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const from = drag.current;
					if (!from) return;
					setOffset({ x: from.ox + (event.clientX - from.x), y: from.oy + (event.clientY - from.y) });
				}}
				onPointerUp={(event) => {
					drag.current = null;
					event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onDoubleClick={(event) => {
					// Actual size, or back to fitting — the two sizes anybody actually wants.
					if (scale === null) zoomAt(1 / Math.max(fitted, MIN_SCALE), event.clientX, event.clientY);
					else reset();
				}}
			>
				<img
					ref={image}
					src={src}
					alt={name}
					draggable={false}
					onLoad={(event) => {
						const element = event.currentTarget;
						setNatural({ width: element.naturalWidth, height: element.naturalHeight });
					}}
					className="absolute top-1/2 left-1/2 max-w-none origin-center select-none"
					style={{
						transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${effective})`,
						// Nearest-neighbour once past 3×: at that point the interesting question is
						// which pixel is which, and smoothing is actively in the way.
						imageRendering: effective >= 3 ? "pixelated" : "auto",
						transition: drag.current ? "none" : "transform 90ms linear",
					}}
				/>
			</div>

			{/* The controls, and the two numbers worth knowing: how big it is, and how big you made it. */}
			<div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
				<IconButton icon={<Minus size={12} strokeWidth={1.9} />} label="缩小" size="sm" onClick={() => zoomAt(1 / 1.4)} />
				<IconButton icon={<Plus size={12} strokeWidth={1.9} />} label="放大" size="sm" onClick={() => zoomAt(1.4)} />
				<IconButton
					icon={<Maximize2 size={12} strokeWidth={1.9} />}
					label="实际大小"
					size="sm"
					onClick={() => setScale(1)}
				/>
				<IconButton icon={<RotateCcw size={12} strokeWidth={1.9} />} label="适应窗口" size="sm" onClick={reset} />
				<span className="ml-1">
					<Text size="caption" tone="faint" numeric>
						{Math.round(effective * 100)}%
					</Text>
				</span>
				{natural && (
					<span className="ml-auto">
						<Text size="caption" tone="faint" numeric>
							{natural.width} × {natural.height}
						</Text>
					</span>
				)}
			</div>
		</div>
	);
}
