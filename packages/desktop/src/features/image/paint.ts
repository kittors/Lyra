/**
 * How a mark is drawn onto a canvas.
 *
 * Lifted out of `Annotator.tsx` because the screenshot overlay needs exactly the same thing and had
 * grown its own copy — one that knew about four of the eight tools. Mosaic, text, step badges and
 * plain lines were all in the toolbar of the overlay and all silently drew nothing, because the
 * function behind them had no branch for them. Two painters means one of them is always behind.
 *
 * Everything here works in the image's *natural* pixels with an untranslated context. A caller
 * drawing a crop translates the context by the crop's origin and is otherwise unchanged, which is
 * how the same function serves the annotator's full-image canvas and the overlay's selection.
 */

import { mosaicCells, stepNumber, wrapText, type Shape } from "./annotate.ts";

/** Scaled with the image, so a mark on a 3000px screenshot is not a hairline. */
export const STROKE_BASE = 3;
/** Type size relative to the stroke, which is itself relative to the image. */
/**
 * Type size relative to the stroke.
 *
 * Was 7, which put the middle setting at roughly 21 points on screen — half again the size of the
 * text being annotated, so every caption shouted. A caption is a note *about* a screenshot and
 * should sit at about the size of the interface underneath it; 5 lands the middle setting near 15,
 * which is that, and leaves the large setting for when it genuinely has to carry.
 */
export const TEXT_SCALE = 5;
/** Line spacing and padding, shared by the field and the paint so the two agree exactly. */
export const LINE = 1.35;
export const PAD = 0.28;

export const FONT = `-apple-system, system-ui, "PingFang SC", sans-serif`;
/** One string, so the field and the canvas cannot drift apart. */
export const fontOf = (size: number) => `${Math.max(12, size)}px ${FONT}`;

/** The stroke width for an image this wide — a constant fraction of it, floored so it stays visible. */
export const strokeFor = (width: number) => Math.max(STROKE_BASE, Math.round(width / 500));

/** Blit one averaged pixel per covered cell, at block size, with smoothing off. */
export function paintMosaic(
	ctx: CanvasRenderingContext2D,
	shape: Shape,
	source: HTMLCanvasElement | null,
	block: number,
	brush: number,
) {
	if (!source) return;
	const smoothing = ctx.imageSmoothingEnabled;
	ctx.imageSmoothingEnabled = false;
	for (const cell of mosaicCells(shape.points, brush, block)) {
		const [x, y] = cell.split(",").map(Number) as [number, number];
		if (x < 0 || y < 0) continue;
		ctx.drawImage(source, x / block, y / block, 1, 1, x, y, block, block);
	}
	ctx.imageSmoothingEnabled = smoothing;
}

/**
 * The top of line `i`'s glyphs.
 *
 * Half the leading sits above the text and half below, which is what a line box does and therefore
 * what the field does. Getting this wrong shifts the painted caption a few pixels off the one that
 * was typed — small, and visible the moment the field disappears.
 */
export const baseline = (top: number, pad: number, i: number, step: number, size: number) =>
	top + pad + i * step + (step - size) / 2;

export function paint(ctx: CanvasRenderingContext2D, shape: Shape, stroke: number, step: number) {
	ctx.strokeStyle = shape.colour;
	ctx.fillStyle = shape.colour;
	ctx.lineWidth = stroke;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	const first = shape.points[0];
	const last = shape.points[shape.points.length - 1];
	if (!first || !last) return;

	if (shape.tool === "text") {
		const size = shape.size ?? stroke * TEXT_SCALE;
		const pad = size * PAD;
		ctx.font = fontOf(size);
		ctx.textBaseline = "top";

		// The same column the field wrapped at, so the lines break in the same places.
		const column = (shape.width ?? Number.POSITIVE_INFINITY) - pad * 2;
		const lines = wrapText((line) => ctx.measureText(line).width, shape.text ?? "", column);
		const step = size * LINE;

		if (shape.background) {
			ctx.fillStyle = shape.background;
			const box = shape.width ?? Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
			const height = lines.length * step + pad * 2;
			ctx.beginPath();
			ctx.roundRect(first.x, first.y, box, height, size * 0.2);
			ctx.fill();
		} else {
			/*
			 * A hairline of contrast, not a halo.
			 *
			 * Nothing sits behind the text, so it has to carry its own legibility over whatever it
			 * lands on — but at `size / 9` the outline was thicker than the strokes of the glyphs
			 * themselves, which bleeds white into every counter and reads as out-of-focus text. Thin
			 * enough to separate the letters from the background and no thicker is the whole job.
			 */
			ctx.strokeStyle = "rgba(255,255,255,0.85)";
			ctx.lineWidth = Math.max(1, size / 18);
			ctx.lineJoin = "round";
			lines.forEach((line, i) => ctx.strokeText(line, first.x + pad, baseline(first.y, pad, i, step, size)));
		}

		ctx.fillStyle = shape.colour;
		lines.forEach((line, i) => ctx.fillText(line, first.x + pad, baseline(first.y, pad, i, step, size)));
		return;
	}

	if (shape.tool === "step") {
		// A filled disc with the number in it, sized off the stroke like everything else. Centred on
		// the click rather than starting there: a badge marks a spot, it does not begin at one.
		const radius = Math.max(12, stroke * 4.5);
		ctx.beginPath();
		ctx.arc(first.x, first.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.95)";
		ctx.lineWidth = Math.max(2, radius / 7);
		ctx.stroke();

		ctx.fillStyle = "#ffffff";
		ctx.font = `600 ${Math.round(radius * 1.15)}px -apple-system, system-ui, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(step), first.x, first.y + radius * 0.04);
		ctx.textAlign = "start";
		ctx.textBaseline = "alphabetic";
		return;
	}

	if (shape.tool === "arrow") {
		const head = Math.max(10, stroke * 4);
		const angle = Math.atan2(last.y - first.y, last.x - first.x);
		// The shaft stops short of the tip, so the line does not show through the notch of the head.
		const shaft = Math.max(0, Math.hypot(last.x - first.x, last.y - first.y) - head * 0.72);
		ctx.beginPath();
		ctx.moveTo(first.x, first.y);
		ctx.lineTo(first.x + Math.cos(angle) * shaft, first.y + Math.sin(angle) * shaft);
		ctx.stroke();

		// A solid triangle rather than two strokes: at any size it reads as one arrowhead.
		const wing = Math.PI / 7;
		ctx.beginPath();
		ctx.moveTo(last.x, last.y);
		ctx.lineTo(last.x - Math.cos(angle - wing) * head, last.y - Math.sin(angle - wing) * head);
		ctx.lineTo(last.x - Math.cos(angle + wing) * head, last.y - Math.sin(angle + wing) * head);
		ctx.closePath();
		ctx.fill();
		return;
	}

	ctx.beginPath();
	if (shape.tool === "pen") {
		ctx.moveTo(first.x, first.y);
		for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
		// A single click leaves a dot rather than nothing.
		if (shape.points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
	} else if (shape.tool === "line") {
		ctx.moveTo(first.x, first.y);
		ctx.lineTo(last.x, last.y);
	} else if (shape.tool === "rect") {
		ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
	} else {
		// An ellipse inscribed in the drag, which is what a drag from corner to corner means.
		ctx.ellipse(
			(first.x + last.x) / 2,
			(first.y + last.y) / 2,
			Math.abs(last.x - first.x) / 2,
			Math.abs(last.y - first.y) / 2,
			0,
			0,
			Math.PI * 2,
		);
	}
	ctx.stroke();
}

/**
 * Paint a whole list of marks, mosaic included.
 *
 * The one place that knows a mosaic is painted differently from everything else — every caller had
 * to remember that, and the overlay's copy did not, which is why its mosaic button drew nothing.
 */
export function paintAll(
	ctx: CanvasRenderingContext2D,
	shapes: Shape[],
	options: {
		stroke: number;
		/** Keyed by grid size, because the source's resolution *is* the grid — see `useAnnotator`. */
		mosaicSourceFor: (block: number) => HTMLCanvasElement | null;
		block: number;
		brush: number;
	},
) {
	/*
	 * A mark's own size wins over the current one.
	 *
	 * The options are the defaults for a mark that predates this — a picture annotated by an older
	 * build, or the one being dragged out right now, which has not been committed yet. Everything
	 * committed carries the size it was drawn at, so changing the setting no longer reaches back
	 * and resizes work that is already done.
	 */
	shapes.forEach((shape, index) => {
		ctx.save();
		if (shape.tool === "mosaic") {
			const grid = shape.block ?? options.block;
			paintMosaic(ctx, shape, options.mosaicSourceFor(grid), grid, shape.brush ?? options.brush);
		} else {
			paint(ctx, shape, shape.stroke ?? options.stroke, stepNumber(shapes, index));
		}
		ctx.restore();
	});
}
