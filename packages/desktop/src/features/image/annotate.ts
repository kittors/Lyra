/**
 * The arithmetic behind annotating an image: what a mark is, what undo means, how the step numbers
 * are counted, which cells a mosaic covers, and where the picture goes when you zoom into it.
 *
 * Kept apart from the component because all of them can be wrong in ways a screenshot will not show.
 * A zoom that does not hold its anchor drifts a little on every notch of the wheel; step numbers
 * that are stored rather than counted go 1, 2, 4 the moment you undo the third one. Neither is
 * visible in a still image, and both are ordinary functions with ordinary answers, so they are
 * tested as such.
 *
 * Every coordinate here is in the image's *natural* pixels. The canvas is opened at that size and
 * scaled down by CSS, so a mark on a 3000px screenshot is stored at 3000px and stays as sharp as the
 * screenshot when it is saved.
 */

/**
 * Every tool draws something.
 *
 * There is no pointer tool, and that is deliberate. Selecting used to need one, and then every mark
 * became grabbable under every tool that places rather than smears — at which point a tool whose
 * only remaining ability was "press on nothing without drawing" was not just redundant but
 * misleading: it implied that touching an existing mark required switching to it first, which is the
 * opposite of what happens.
 */
export type Tool = "pen" | "arrow" | "line" | "rect" | "ellipse" | "step" | "text" | "mosaic";

export interface Point {
	x: number;
	y: number;
}

export interface Shape {
	tool: Tool;
	colour: string;
	/** Pen and mosaic keep every point; the rest are defined by where the drag started and ended. */
	points: Point[];
	text?: string;
	/**
	 * In natural pixels, so it scales with the image like every other mark: the type size of a
	 * caption, the radius of a step badge.
	 */
	size?: number;
	/** Text only: the column width it wraps at, in natural pixels. */
	width?: number;
	/** Text only: that width was dragged by hand, so editing the caption keeps it rather than refitting. */
	fixed?: boolean;
	/** Text only: how tall it came out, measured from the field that typed it. */
	height?: number;
	/** Text only: a CSS colour behind the text, or undefined for none. */
	background?: string;
	/**
	 * The line width this mark was drawn at, in natural pixels.
	 *
	 * Recorded on the mark rather than read from the toolbar at paint time, because the toolbar is
	 * about what happens *next*. Painted from the current setting, every stroke already on the
	 * picture changed thickness the moment the size was adjusted — draw three arrows, decide the
	 * fourth should be thinner, and the first three become thinner too. Text has always kept its
	 * own `size` for exactly this reason; the rest of the tools were the odd ones out.
	 */
	stroke?: number;
	/** Mosaic only: the grid it was painted on, and how wide the brush was. Same reasoning. */
	block?: number;
	brush?: number;
}

// ---------------------------------------------------------------------------
// Selecting, moving, measuring
// ---------------------------------------------------------------------------

/** Every point shifted; nothing else about the mark changes. */
export function moveShape(shape: Shape, dx: number, dy: number): Shape {
	return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** The width handle on a caption, which is not one of its points. */
export const WIDTH_HANDLE = -1;

/** Marks defined by where the drag started and ended, and therefore resizable by either end. */
const TWO_POINT = new Set<Tool>(["rect", "ellipse", "line", "arrow"]);
/** Of those, the ones that enclose an area — and so have four corners, not two ends. */
const BOXED = new Set<Tool>(["rect", "ellipse"]);

/**
 * The grips on a selected mark, in natural pixels.
 *
 * Only where dragging means something: the ends of a line or an arrow, the four corners of a box or
 * an ellipse, the column edge of a caption. A pen stroke has no points that stand for it and a step
 * badge is resized from the toolbar, so both are moved rather than resized — offering a grip that
 * does nothing would be worse than offering none.
 *
 * A box has all four corners rather than the two it was drawn between. With two, a rectangle drawn
 * from its top-left could only be resized from the top-left and the bottom-right: reach for the
 * top-right corner, the one nearest the hand half the time, and there was nothing there to take.
 * Indices 0 and 1 are still the two points; 2 and 3 are the corners those two imply.
 */
export function handlesOf(shape: Shape): { at: Point; index: number }[] {
	const first = shape.points[0];
	if (!first) return [];

	if (shape.tool === "text") {
		const width = shape.width ?? 0;
		const height = shape.height ?? (shape.size ?? 16) * 1.5;
		return [{ at: { x: first.x + width, y: first.y + height / 2 }, index: WIDTH_HANDLE }];
	}

	if (TWO_POINT.has(shape.tool)) {
		const last = shape.points[shape.points.length - 1];
		if (!last) return [];
		const ends = [
			{ at: first, index: 0 },
			{ at: last, index: 1 },
		];
		if (!BOXED.has(shape.tool)) return ends;
		return [...ends, { at: { x: last.x, y: first.y }, index: 2 }, { at: { x: first.x, y: last.y }, index: 3 }];
	}

	return [];
}

/** Drag one grip to a new place. The rest of the mark stays where it is. */
export function resizeShape(shape: Shape, index: number, to: Point): Shape {
	const first = shape.points[0];
	if (!first) return shape;

	if (index === WIDTH_HANDLE) {
		// A column narrower than a couple of characters cannot lay anything out.
		const min = (shape.size ?? 16) * 2;
		return { ...shape, width: Math.max(min, to.x - first.x), fixed: true };
	}

	const points = [...shape.points];
	const last = points[points.length - 1] ?? first;
	if (index === 0) points[0] = to;
	else if (index === 1) points[points.length - 1] = to;
	// The two implied corners each take one coordinate from either point.
	else if (index === 2) {
		points[0] = { x: first.x, y: to.y };
		points[points.length - 1] = { x: to.x, y: last.y };
	} else if (index === 3) {
		points[0] = { x: to.x, y: first.y };
		points[points.length - 1] = { x: last.x, y: to.y };
	}
	return { ...shape, points };
}

/**
 * Where the end of a drag lands with Shift held: a square, a circle, or a line at a round angle.
 *
 * What every drawing program does with that key, and what anyone straightening a line reaches for
 * first. A box keeps the longer of its two sides on both; a line snaps to the nearest 15°, which
 * holds horizontal, vertical and the diagonals without making the in-between angles unreachable.
 */
export function constrainEnd(tool: Tool, from: Point, to: Point): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (BOXED.has(tool)) {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side };
	}
	if (tool === "line" || tool === "arrow") {
		const step = Math.PI / 12;
		const angle = Math.round(Math.atan2(dy, dx) / step) * step;
		const length = Math.hypot(dx, dy);
		return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
	}
	return to;
}

/**
 * The box around a mark, for drawing the selection and for nothing else.
 *
 * Deliberately generous: it is a hint about what is selected, not a claim about which pixels the
 * mark covers, and a box that clips the thing it surrounds looks like a mistake.
 */
export function shapeBounds(shape: Shape, stroke: number): { x: number; y: number; w: number; h: number } {
	const first = shape.points[0] ?? { x: 0, y: 0 };

	if (shape.tool === "text") {
		const size = shape.size ?? 16;
		return {
			x: first.x,
			y: first.y,
			/*
			 * Only reached for a caption saved before widths were measured.
			 *
			 * `fitWidth` measures the real one against the canvas; there is no canvas here, so this
			 * estimates from the character count — a shade over half an em each, which sits between
			 * latin and CJK. Better than a constant either way round: a fixed six characters is far
			 * too wide for a two-word caption and far too narrow for a sentence.
			 */
			w: shape.width ?? Math.max(size * 1.6, (shape.text?.length ?? 4) * size * 0.6 + size * 0.56),
			h: shape.height ?? size * 1.9,
		};
	}

	if (shape.tool === "step") {
		const r = Math.max(12, stroke * 4.5);
		return { x: first.x - r, y: first.y - r, w: r * 2, h: r * 2 };
	}

	const xs = shape.points.map((p) => p.x);
	const ys = shape.points.map((p) => p.y);
	// Mosaic is painted with a wide brush; the rest with a stroke.
	const pad = shape.tool === "mosaic" ? stroke * 6 : stroke;
	const [x1, x2] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
	const [y1, y2] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
	return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Which mark is under the point, or -1.
 *
 * Searched newest first, so the one on top wins — which is the one being pointed at, as far as
 * anyone looking at the picture is concerned.
 *
 * Outlines are hit on the outline rather than over their area: a rectangle drawn *around* something
 * is drawn around it in order to leave it visible, and swallowing clicks meant for what is inside
 * would undo the point of it. Text and step badges are solid things and are hit over their whole box.
 */
export function hitShape(shapes: Shape[], at: Point, tolerance: number): number {
	for (let i = shapes.length - 1; i >= 0; i--) {
		const shape = shapes[i];
		if (shape && hits(shape, at, tolerance)) return i;
	}
	return -1;
}

/**
 * Every mark under the point, topmost first.
 *
 * What makes a stack of overlapping marks navigable: `hitShape` always answers with the one on top,
 * so without this the ones beneath it could never be reached at all.
 */
export function hitShapes(shapes: Shape[], at: Point, tolerance: number): number[] {
	const found: number[] = [];
	for (let i = shapes.length - 1; i >= 0; i--) {
		const shape = shapes[i];
		if (shape && hits(shape, at, tolerance)) found.push(i);
	}
	return found;
}

function hits(shape: Shape, at: Point, tolerance: number): boolean {
	const first = shape.points[0];
	if (!first) return false;
	const last = shape.points[shape.points.length - 1] ?? first;

	if (shape.tool === "text" || shape.tool === "step") {
		/*
		 * The badge's own box, plus one allowance — not two, and not the wrong one.
		 *
		 * `shapeBounds` takes a *stroke*, and a step badge sizes itself from it: `max(12, stroke *
		 * 4.5)`. Handing it the tolerance instead inflated the badge's radius by whatever the
		 * forgiveness happened to be, and then the comparison below added the tolerance a second
		 * time — so the grab area came out a good deal larger than the circle anyone can see, and
		 * badges got picked up by presses that visibly missed them.
		 */
		const box = shapeBounds(shape, shape.stroke ?? tolerance);
		return (
			at.x >= box.x - tolerance &&
			at.x <= box.x + box.w + tolerance &&
			at.y >= box.y - tolerance &&
			at.y <= box.y + box.h + tolerance
		);
	}

	if (shape.tool === "pen" || shape.tool === "mosaic") {
		// A mosaic is a wide brush, so its stroke is easier to hit than a pen's.
		const reach = shape.tool === "mosaic" ? tolerance * 4 : tolerance;
		for (let i = 1; i < shape.points.length; i++) {
			const a = shape.points[i - 1];
			const b = shape.points[i];
			if (a && b && toSegment(at, a, b) <= reach) return true;
		}
		return shape.points.length === 1 && distance(at, first) <= reach;
	}

	if (shape.tool === "line" || shape.tool === "arrow") return toSegment(at, first, last) <= tolerance;

	if (shape.tool === "rect") {
		const [x1, x2] = [Math.min(first.x, last.x), Math.max(first.x, last.x)];
		const [y1, y2] = [Math.min(first.y, last.y), Math.max(first.y, last.y)];
		const edges: [Point, Point][] = [
			[{ x: x1, y: y1 }, { x: x2, y: y1 }],
			[{ x: x2, y: y1 }, { x: x2, y: y2 }],
			[{ x: x2, y: y2 }, { x: x1, y: y2 }],
			[{ x: x1, y: y2 }, { x: x1, y: y1 }],
		];
		return edges.some(([a, b]) => toSegment(at, a, b) <= tolerance);
	}

	// Ellipse: how far the point is from the curve, along the ray from the centre. Exact would need
	// an iterative solve; this is the standard approximation and is well inside the tolerance for
	// anything drawn by hand.
	const cx = (first.x + last.x) / 2;
	const cy = (first.y + last.y) / 2;
	const rx = Math.abs(last.x - first.x) / 2;
	const ry = Math.abs(last.y - first.y) / 2;
	if (rx < 1 || ry < 1) return toSegment(at, first, last) <= tolerance;
	const radius = Math.hypot((at.x - cx) / rx, (at.y - cy) / ry);
	if (radius === 0) return false;
	return Math.abs(radius - 1) * Math.min(rx, ry) <= tolerance;
}

/**
 * Whether a point is inside a mark's own box — the frame that is drawn around it when selected.
 *
 * Used *only* for the mark that is already selected. Once something carries a visible frame, the
 * frame is what you reach for: pressing inside it and finding you have started drawing a second
 * rectangle instead of moving the first is the single most jarring thing about the outline-only
 * rule. Aiming at a 2px edge to move a shape you can plainly see is not a reasonable ask.
 *
 * Deliberately not used for unselected marks. That is what keeps `hitShape`'s promise intact — a
 * rectangle drawn *around* something is drawn around it to leave it visible, and if its interior
 * swallowed presses there would be no way to annotate inside one.
 */
export function insideBounds(shape: Shape, at: Point, stroke: number, tolerance: number): boolean {
	const box = shapeBounds(shape, stroke);
	return (
		at.x >= box.x - tolerance &&
		at.x <= box.x + box.w + tolerance &&
		at.y >= box.y - tolerance &&
		at.y <= box.y + box.h + tolerance
	);
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest distance from a point to a line segment — the whole of hit testing an outline. */
function toSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy;
	if (length === 0) return distance(p, a);
	// Where the perpendicular lands, clamped to the segment so the ends are round rather than
	// extending to infinity along the line.
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
	return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * How wide a miss selecting forgives, in natural pixels.
 *
 * Scaled by the stroke — a mark drawn 12px wide is aimed at as 12px wide — and inversely by how many
 * screen pixels one image pixel takes up, so the forgiveness is a constant number of *screen* pixels
 * however the picture is shown. A fixed tolerance in image pixels would be impossible to aim at 25%
 * and absurdly sticky at 800%.
 *
 * `scale` is the picture's fitted size times the zoom. It used to be the zoom alone, which assumed one
 * image pixel was one screen pixel at 100%: a 3000px screenshot fitted into a window is shown at a
 * third of that, and its 7-pixel allowance came out under three points wide.
 */
export function pickTolerance(stroke: number, scale: number): number {
	return Math.max(stroke, 7 / Math.max(scale, 0.01)) + stroke / 2;
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

/** May not begin a line: closing brackets, and the punctuation that ends a clause or a sentence. */
const NO_START = /[、。，．,.;；:：!！?？)）\]］}｝」』】〕〉》〗〙〛…‥％%]/u;
/** May not end a line: opening brackets. */
const NO_END = /[(（[［{｛「『【〔〈《〖〘〚]/u;

/**
 * The smallest runs that will not be broken across lines.
 *
 * CJK breaks between any two characters and Latin at spaces — except that punctuation holds on to its
 * neighbour: a line may not begin with a comma or a closing bracket, nor end with an opening one. The
 * field the caption is typed in breaks lines by those rules, and the canvas used to ignore them, so a
 * caption could be typed as 「长的说 / 明，会在」 and painted as 「长的说明 / ，会在图」 — a line starting
 * with a comma, and every line after it one character off.
 */
function segments(text: string): string[] {
	const out: string[] = [];
	const push = (run: string) => {
		const last = out[out.length - 1];
		if (last !== undefined && (NO_START.test(run[0] ?? "") || NO_END.test(last.at(-1) ?? ""))) out[out.length - 1] = last + run;
		else out.push(run);
	};
	let latin = "";
	for (const ch of text) {
		// CJK breaks anywhere, which is how CJK is set; Latin breaks at spaces, which is how it reads.
		if (/[　-〿぀-ヿ一-鿿＀-￯]/.test(ch)) {
			if (latin) {
				push(latin);
				latin = "";
			}
			push(ch);
		} else if (ch === " ") {
			push(`${latin} `);
			latin = "";
		} else {
			latin += ch;
		}
	}
	if (latin) push(latin);
	return out;
}

/**
 * Break text into lines that fit a column, honouring the newlines already in it.
 *
 * A canvas has no line breaking of its own — `fillText` draws one line however long it is and runs
 * off the edge of the picture, which is what the caption did. Measurement is passed in rather than
 * taken from a context so the rule can be tested without a DOM, and so the same function serves both
 * the live field and the paint.
 *
 * A run wider than the whole column on its own — a link, a long number — is broken between its
 * characters, as the field breaks it (`overflow-wrap`); left whole it ran past the column and off the
 * caption's plate.
 */
export function wrapText(measure: (line: string) => number, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const run of segments(paragraph)) {
			if (line !== "" && measure(line + run) > maxWidth) {
				lines.push(line);
				// The space that caused the break belongs to neither line.
				line = run.trimStart() === "" ? "" : run.replace(/^ +/, "");
			} else {
				line += run;
			}
			// A trailing space hangs past the column, as it does in the field.
			while (measure(line.trimEnd()) > maxWidth && [...line.trimEnd()].length > 1) {
				const chars = [...line];
				let fit = 1;
				while (fit < chars.length && measure(chars.slice(0, fit + 1).join("").trimEnd()) <= maxWidth) fit++;
				lines.push(chars.slice(0, fit).join(""));
				line = chars.slice(fit).join("");
			}
		}
		lines.push(line);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Undo and redo over one list of steps with a cursor into it, rather than two stacks.
 *
 * The two-stack version has to move entries between them on every operation and gets the boundaries
 * wrong in exactly one place: committing while some redo is available has to discard the redo, and
 * with two stacks that is a separate thing to remember. Here it falls out of the array slice.
 */
export interface History {
	steps: Shape[][];
	cursor: number;
}

/** Enough to undo an afternoon, bounded so a long session does not hold every state it ever had. */
export const HISTORY_LIMIT = 100;

export const emptyHistory = (): History => ({ steps: [[]], cursor: 0 });

export const current = (history: History): Shape[] => history.steps[history.cursor] ?? [];

export const canUndo = (history: History): boolean => history.cursor > 0;
export const canRedo = (history: History): boolean => history.cursor < history.steps.length - 1;

export const undo = (history: History): History =>
	canUndo(history) ? { ...history, cursor: history.cursor - 1 } : history;

export const redo = (history: History): History =>
	canRedo(history) ? { ...history, cursor: history.cursor + 1 } : history;

/**
 * Record a new state, dropping anything that was ahead of the cursor.
 *
 * Drawing after undoing abandons the undone branch — the alternative is a tree, and a tree is a
 * thing the user then has to navigate. Nobody has ever wanted that from a screenshot annotator.
 */
export function commit(history: History, shapes: Shape[]): History {
	const steps = [...history.steps.slice(0, history.cursor + 1), shapes];
	const excess = steps.length - HISTORY_LIMIT;
	if (excess <= 0) return { steps, cursor: steps.length - 1 };
	// Oldest steps fall off the front; the cursor still points at the newest.
	const kept = steps.slice(excess);
	return { steps: kept, cursor: kept.length - 1 };
}

// ---------------------------------------------------------------------------
// Step numbers
// ---------------------------------------------------------------------------

/**
 * What number a step badge shows: its position among the step badges, counted at paint time.
 *
 * Counted rather than stored, so undoing the second of four renumbers the rest instead of leaving
 * 1, 3, 4. The badge is a description of the order, and the order is a property of the list.
 */
export function stepNumber(shapes: Shape[], index: number): number {
	let n = 0;
	for (let i = 0; i <= index && i < shapes.length; i++) {
		if (shapes[i]?.tool === "step") n++;
	}
	return n;
}

// ---------------------------------------------------------------------------
// Mosaic
// ---------------------------------------------------------------------------

/**
 * Mosaic block size, in natural pixels — coarse enough to actually obscure a face or a token.
 *
 * `unit` is how many image pixels one screen pixel covers at the picture's fitted size, so the grain
 * is the same on screen whatever the picture's resolution. It used to be a fraction of the image's
 * width, which is the right answer for a screenshot — shown at one image pixel per device pixel —
 * and the wrong one for everything else: a 1408px drawing fitted into a window came out in 4pt
 * squares, a mosaic that reads as noise rather than as redaction.
 *
 * `scale` is the size control, so the grain is adjustable: redacting a line of text and redacting a
 * whole window want visibly different squares. Whole pixels, because the averaged copy it samples
 * from holds one pixel per block and a fractional block would sample between them.
 */
export function mosaicBlock(unit: number, scale = 1): number {
	return Math.max(2, Math.round(MOSAIC_BLOCK * unit * scale));
}

/**
 * How wide the mosaic brush paints, in natural pixels: about a line of text on screen, widened by the
 * size control when the job is bigger.
 */
export function mosaicBrush(unit: number, scale = 1): number {
	return Math.max(4, MOSAIC_BRUSH * unit * scale);
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/*
 * What the middle setting draws, in screen points at the picture's fitted size.
 *
 * Measured off the screen rather than off the image, which is what they were before: a stroke was
 * 1/500 of the image's width and type five strokes, a rule written for screenshots, which are shown
 * at one image pixel per device pixel. A generated picture is not: 1408px wide, fitted into a window
 * at 1100 points, its middle setting came out as a 2.3pt line and 11.7pt type — smaller than the
 * interface around it, on a picture whose whole point was to be marked up legibly.
 *
 * Fixed at the fitted size, not at the current zoom: a mark drawn at 300% is the same mark as one
 * drawn at 100%, it is only being looked at more closely.
 */
const STROKE = 4;
const TYPE = 22;
const BADGE = 14;
const MOSAIC_BLOCK = 10;
const MOSAIC_BRUSH = 32;

/** A line's width, in natural pixels. The size control multiplies it straight. */
export const strokeAt = (unit: number, weight: number): number => Math.max(1, STROKE * weight) * unit;

/**
 * A caption's type size, in natural pixels.
 *
 * It grows more slowly than a line does: 1.8× on a line is bold, 1.8× on a caption is a headline. The
 * exponent puts the three settings at 16, 22 and 32 points — the smallest is still above the 14 the
 * interface is set in, which is the floor below which a note on a picture stops being read.
 */
export const typeAt = (unit: number, weight: number): number => TYPE * weight ** 0.62 * unit;

/** A step badge's radius, in natural pixels: 11, 14 and 19 points across the three settings. */
export const badgeAt = (unit: number, weight: number): number => BADGE * weight ** 0.55 * unit;

/**
 * Which grid cells a mosaic stroke covers, as `x,y` of each cell's top-left corner.
 *
 * Snapped to a grid rather than painted freely, for two reasons. Blocks that line up read as
 * deliberate redaction, where blur that follows the cursor reads as a smudge. And a grid is
 * idempotent: going over the same spot twice covers the same cells, so a nervous scribble does not
 * end up darker than a confident one.
 */
export function mosaicCells(points: Point[], brush: number, block: number): string[] {
	const cells = new Set<string>();
	const radius = brush / 2;
	for (const point of points) {
		const left = Math.floor((point.x - radius) / block) * block;
		const top = Math.floor((point.y - radius) / block) * block;
		for (let x = left; x <= point.x + radius; x += block) {
			for (let y = top; y <= point.y + radius; y += block) {
				// The cell's centre inside the brush, so the stroke has a round end rather than a
				// square one that lags behind the cursor at the corners.
				if (Math.hypot(x + block / 2 - point.x, y + block / 2 - point.y) <= radius + block / 2) {
					cells.add(`${x},${y}`);
				}
			}
		}
	}
	return [...cells];
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
/** One press of the zoom buttons; the wheel uses a fraction of it per notch. */
export const ZOOM_STEP = 1.25;

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/**
 * How much one wheel event zooms by.
 *
 * Two gestures arrive as the same event. A trackpad pinch is a wheel with `ctrlKey` held and deltas
 * of a few pixels, dozens a second, so that path is sensitive. Ctrl+wheel — how Windows and Linux
 * zoom — is also a wheel with `ctrlKey` held, but one notch is about 100px, and the pinch's
 * sensitivity made that e¹: 2.7× a click. So no single event may zoom more than one press of the
 * buttons. A pinch's deltas never come near the limit, and a plain notch was already about there.
 */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
	const limit = Math.log(ZOOM_STEP);
	const exponent = -deltaY * (pinch ? 0.01 : 0.0022);
	return Math.exp(Math.min(limit, Math.max(-limit, exponent)));
}

/**
 * Zoom about a point on the screen, keeping whatever is under that point under it.
 *
 * The stage is transformed as `translate(offset) scale(zoom)` about its own centre, so a point at
 * screen offset `v` from that centre sits at content offset `(v - offset) / zoom`. Holding it still
 * across a change of zoom is that identity solved for the new offset — which is the difference
 * between zooming into what you are looking at and zooming into the middle and then hunting for it.
 */
export function zoomAt(
	from: number,
	to: number,
	offset: Point,
	anchor: Point,
	centre: Point,
): { zoom: number; offset: Point } {
	const zoom = clampZoom(to);
	const ratio = zoom / from;
	const vx = anchor.x - centre.x;
	const vy = anchor.y - centre.y;
	return {
		zoom,
		offset: { x: vx - (vx - offset.x) * ratio, y: vy - (vy - offset.y) * ratio },
	};
}
