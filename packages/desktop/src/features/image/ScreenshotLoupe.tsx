/**
 * The magnifier that follows the pointer before a region is chosen.
 *
 * Two jobs at once, and they are the same job. Blown up far enough to see individual pixels, it
 * says exactly which pixel the crosshair is on — which is what makes a selection land on a border
 * rather than one pixel inside it. And the pixel under the crosshair has a colour, so reading that
 * colour off is free: a capture tool is already the thing pointed at the screen, and every other
 * one of consequence lets you take a colour with it.
 *
 * Sampled from the frozen snapshot rather than from the live screen. The snapshot is what the
 * capture will contain, so what the loupe reports and what ends up in the file cannot disagree —
 * and it is already decoded, so this costs a `drawImage` of a few hundred pixels per frame.
 */

import { useEffect, useRef } from "react";
import type { Point } from "./screenshot-geometry.ts";

/** How much of the snapshot is shown, in snapshot pixels across the whole loupe. */
const SPAN = 17;
/** The loupe's size on screen. */
const SIZE = 132;

export interface LoupeReading {
	/** In snapshot pixels, which is what a colour picker's coordinates mean. */
	x: number;
	y: number;
	hex: string;
}

export function ScreenshotLoupe({
	source,
	at,
	scale,
	viewport,
	reading,
	copied,
}: {
	/** The frozen screen, at its own resolution. */
	source: HTMLCanvasElement | null;
	/** Where the pointer is, in CSS pixels. */
	at: Point;
	/** Snapshot pixels per CSS pixel. */
	scale: number;
	viewport: { width: number; height: number };
	reading: LoupeReading | null;
	copied: boolean;
}) {
	const glass = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const el = glass.current;
		const ctx = el?.getContext("2d");
		if (!el || !ctx || !source) return;
		const half = SPAN / 2;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, el.width, el.height);
		// A slab of the snapshot, blown up so one snapshot pixel is a visible square.
		ctx.drawImage(source, at.x * scale - half, at.y * scale - half, SPAN, SPAN, 0, 0, el.width, el.height);
	}, [source, at.x, at.y, scale]);

	/*
	 * Beside the pointer, and never off the screen.
	 *
	 * Flipped to the other side when it would overhang, which is what keeps it usable in the corner
	 * where a selection most often ends.
	 */
	const pad = 18;
	const boxW = SIZE;
	const boxH = SIZE + 44;
	const left = at.x + pad + boxW > viewport.width ? at.x - pad - boxW : at.x + pad;
	const top = at.y + pad + boxH > viewport.height ? at.y - pad - boxH : at.y + pad;

	return (
		<div
			data-loupe
			className="pointer-events-none absolute overflow-hidden rounded-lg border border-white/25 bg-black/80 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm"
			style={{ left, top, width: boxW }}
		>
			<div className="relative" style={{ height: SIZE }}>
				<canvas ref={glass} width={SIZE} height={SIZE} className="block h-full w-full" />
				{/*
				 * The crosshair marks the pixel being reported, not the middle of the glass.
				 *
				 * They are the same place by construction — the slab is centred on the pointer — and
				 * drawing it in the DOM keeps it out of the canvas, which is being redrawn every frame.
				 */}
				<span className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-accent)]/90" />
				<span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-accent)]/90" />
				<span
					className="absolute border border-[var(--color-accent)]"
					style={{
						left: `${(Math.floor(SPAN / 2) / SPAN) * 100}%`,
						top: `${(Math.floor(SPAN / 2) / SPAN) * 100}%`,
						width: `${(1 / SPAN) * 100}%`,
						height: `${(1 / SPAN) * 100}%`,
					}}
				/>
			</div>
			<div className="space-y-0.5 px-2 py-1.5 text-caption text-white/85 tabular-nums">
				<div className="flex items-center justify-between gap-2">
					<span className="text-white/50">坐标</span>
					<span>
						{reading ? `${reading.x}, ${reading.y}` : "—"}
					</span>
				</div>
				<div className="flex items-center justify-between gap-2">
					<span className="text-white/50">色值</span>
					<span className="flex items-center gap-1">
						<span
							className="inline-block size-2.5 rounded-[2px] border border-white/30"
							style={{ background: reading?.hex ?? "transparent" }}
						/>
						{reading?.hex ?? "—"}
					</span>
				</div>
				<div className="pt-0.5 text-center text-white/45">{copied ? "已复制" : "按 ⌘C 复制色值"}</div>
			</div>
		</div>
	);
}
