/**
 * A field of dots that swell and settle while a picture is being made.
 *
 * The stand-in for an image that does not exist yet, at the size it will have. A grey box with a
 * spinner says "loading"; this says "something is being drawn here", which is the truth — and it
 * holds the picture's place, so nothing below moves when the picture arrives.
 *
 * Fills its parent: the parent owns the size (it knows the picture's shape), this only draws into
 * whatever box that turns out to be, and redraws when the box changes.
 *
 * Canvas rather than DOM: a 28×28 grid is nearly eight hundred dots changing size every frame, which
 * as elements would be eight hundred style recalculations a frame. Here it is one pass of `arc`.
 *
 * Ink is `currentColor`, read when the theme changes rather than per frame, so it follows the theme
 * the way an icon would. Stops drawing while off screen, and draws one still frame when motion is
 * reduced.
 */

import { useEffect, useRef } from "react";
import { motionReduced } from "./reduced.ts";

/** Grid pitch in CSS pixels; the dot count follows the size, the spacing does not. */
const PITCH = 15;
/** Smallest and largest dot radius, as fractions of the pitch. */
const DOT_MIN = 0.05;
const DOT_MAX = 0.34;

/**
 * Three soft blobs wandering on their own slow Lissajous paths.
 *
 * Their sum is the field each dot reads its size from. Incommensurate frequencies so the pattern
 * never visibly loops; widths in units of the shorter side so a wide canvas does not stretch them.
 */
const BLOBS = [
	{ ax: 0.34, ay: 0.3, fx: 0.37, fy: 0.29, px: 0, py: 1.3, width: 0.3 },
	{ ax: 0.3, ay: 0.36, fx: 0.23, fy: 0.41, px: 2.1, py: 0.4, width: 0.24 },
	{ ax: 0.38, ay: 0.28, fx: 0.31, fy: 0.19, px: 4.2, py: 2.8, width: 0.2 },
] as const;

function draw(context: CanvasRenderingContext2D, width: number, height: number, time: number, ink: string): void {
	context.clearRect(0, 0, width, height);
	if (width < 2 || height < 2) return;
	const columns = Math.max(2, Math.floor(width / PITCH));
	const rows = Math.max(2, Math.floor(height / PITCH));
	const stepX = width / columns;
	const stepY = height / rows;
	const short = Math.min(width, height);
	const centres = BLOBS.map((blob) => ({
		x: width * (0.5 + blob.ax * Math.sin(time * blob.fx + blob.px)),
		y: height * (0.5 + blob.ay * Math.sin(time * blob.fy + blob.py)),
		spread: 2 * (blob.width * short) ** 2,
	}));
	context.fillStyle = ink;
	for (let row = 0; row < rows; row++) {
		const y = stepY * (row + 0.5);
		for (let column = 0; column < columns; column++) {
			const x = stepX * (column + 0.5);
			let field = 0;
			for (const centre of centres) field += Math.exp(-((x - centre.x) ** 2 + (y - centre.y) ** 2) / centre.spread);
			// A slow ripple across the whole sheet, so the quiet corners are never quite dead.
			field += 0.07 * Math.sin((x + y) / (short * 0.18) - time * 1.1);
			const level = Math.min(1, Math.max(0, field)) ** 1.15;
			context.globalAlpha = 0.18 + 0.7 * level;
			context.beginPath();
			context.arc(x, y, PITCH * (DOT_MIN + (DOT_MAX - DOT_MIN) * level), 0, Math.PI * 2);
			context.fill();
		}
	}
	context.globalAlpha = 1;
}

export function Halftone({ className = "" }: { className?: string }) {
	const canvas = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const element = canvas.current;
		const context = element?.getContext("2d");
		if (!element || !context) return;
		// Each field starts somewhere of its own along the blobs' paths: two pictures drawn side by side
		// would otherwise be the same pattern, moving in lockstep.
		const born = performance.now() - Math.random() * 60_000;
		const still = motionReduced();
		let size = { width: 0, height: 0 };
		let frame = 0;
		let visible = true;
		let ink = getComputedStyle(element).color || "#000";

		const paint = (now: number) => draw(context, size.width, size.height, still ? 4 : (now - born) / 1000 + 4, ink);
		const tick = (now: number) => {
			frame = 0;
			paint(now);
			if (visible && !still) frame = requestAnimationFrame(tick);
		};
		const fit = () => {
			const scale = window.devicePixelRatio || 1;
			size = { width: element.clientWidth, height: element.clientHeight };
			element.width = Math.round(size.width * scale);
			element.height = Math.round(size.height * scale);
			context.setTransform(scale, 0, 0, scale, 0, 0);
			paint(performance.now());
		};
		fit();
		if (!still) frame = requestAnimationFrame(tick);

		const resized = new ResizeObserver(fit);
		resized.observe(element);
		const seen = new IntersectionObserver(([entry]) => {
			visible = entry?.isIntersecting ?? true;
			if (visible && !still && !frame) frame = requestAnimationFrame(tick);
		});
		seen.observe(element);
		// The theme changes the ink; the next frame picks it up without reading styles every frame.
		const theme = new MutationObserver(() => {
			ink = getComputedStyle(element).color || ink;
			if (still) paint(performance.now());
		});
		theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

		return () => {
			if (frame) cancelAnimationFrame(frame);
			resized.disconnect();
			seen.disconnect();
			theme.disconnect();
		};
	}, []);

	return <canvas ref={canvas} aria-hidden className={`block h-full w-full ${className}`} />;
}
