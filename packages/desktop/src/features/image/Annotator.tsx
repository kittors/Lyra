/**
 * Drawing on top of an image, without drawing on the image.
 *
 * Marks are kept as a list of shapes and repainted from it, rather than accumulated into the canvas
 * as strokes land. That is what makes undo and redo a cursor into a list instead of a stack of
 * bitmaps, it is what lets step badges renumber themselves when one is undone, and it is what lets
 * the in-progress shape be shown live — a rectangle you are still dragging is drawn every frame from
 * the same list plus one provisional entry, so previewing and committing are the same code.
 *
 * The canvas is sized to the image's *natural* pixels and scaled down by CSS. Pointer coordinates
 * are converted on the way in, through `getBoundingClientRect`, which already accounts for the zoom
 * transform on the stage above it — so drawing at 400% lands where the pointer is without the zoom
 * appearing anywhere in this file.
 *
 * Split into a hook, a canvas and a toolbar because the toolbar cannot live inside the canvas's
 * parent: the stage is transformed for zooming, and `position: fixed` inside a transformed ancestor
 * is fixed to that ancestor rather than to the window. A toolbar that scaled and slid with the
 * picture it is being used to annotate would be unusable at 400%.
 */

import {
	ArrowUpRight,
	Delete,
	Circle,
	Grid2x2,
	ListOrdered,
	Minus,
	Pencil,
	Redo2,
	Square,
	Trash2,
	Type,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	canRedo,
	canUndo,
	commit,
	current,
	emptyHistory,
	handlesOf,
	hitShape,
	hitShapes,
	insideBounds,
	mosaicBlock,
	mosaicBrush,
	moveShape,
	pickTolerance,
	redo,
	resizeShape,
	shapeBounds,
	undo,
	WIDTH_HANDLE,
	type History,
	type Point,
	type Shape,
	type Tool,
} from "./annotate.ts";
import {
	fontOf,
	paintAll,
	strokeFor,
	LINE,
	PAD,
	TEXT_SCALE,
} from "./paint.ts";

const COLOURS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#111827"];

/**
 * What an empty caption says, and therefore what an empty caption has to be wide enough for.
 *
 * A constant because two places need it and they must not drift: the field renders it, and
 * `fitWidth` measures it to decide how wide an empty box is. Written out in either place
 * separately, changing the wording would silently reintroduce a box its own placeholder does not
 * fit in — which is exactly how it broke: the floor was a guess in character counts, the
 * placeholder is four characters, and the guess was 1.6.
 */
const PLACEHOLDER = "输入文字";

/** Where a piece of text is being typed, in natural pixels, before it becomes a shape. */
interface Typing {
	at: Point;
	value: string;
	/** The column it wraps at, dragged by the handle on its edge. */
	width: number;
	/**
	 * Whether that column was set by hand.
	 *
	 * Until it is, the box follows the text: it starts small and grows as you type, which is what a
	 * caption wants — the old behaviour opened every caption at 30% of the picture's width, so a
	 * two-word note arrived in a box wider than the thing it was pointing at, and the only way to
	 * make it fit was to drag the handle every single time. Once dragged, that is an instruction,
	 * and the box stops second-guessing it.
	 */
	manual?: boolean;
	/**
	 * The caption this one replaces, when an existing mark is being edited rather than a new one
	 * written. It is hidden from the paint while it is being edited, so it is not drawn twice.
	 */
	replacing?: number;
}

/** A mark being dragged: which one, where the drag started, and where it has got to. */
interface Dragging {
	index: number;
	from: Point;
	moving: Shape;
	/** Which grip is being pulled, or null when the whole mark is being moved. */
	handle: number | null;
	/**
	 * Whether this mark was already selected when the press landed on it.
	 *
	 * A press on something already selected, released without moving, is the second click of
	 * "click to select, click again to edit" — the same gesture a file manager uses for renaming.
	 */
	wasSelected: boolean;
	/**
	 * Whether it has actually gone anywhere.
	 *
	 * A click that selects is a drag of zero length, and committing that would put a step in the
	 * history that changes nothing — undo would appear not to work until pressed twice.
	 */
	moved: boolean;
}

/**
 * Marks that are worth selecting the moment they are drawn.
 *
 * Everything except the two free strokes. A rectangle is almost never the right rectangle first
 * time, so handing it back with grips on saves the round trip through the selection tool that this
 * whole arrangement exists to remove. A pen stroke, on the other hand, is usually one of several in
 * a row, and selecting each one would put a box around every scribble as it is made.
 */
const SELECT_ON_DRAW = new Set<Tool>(["rect", "ellipse", "line", "arrow", "step"]);

/** What can sit behind a caption. Transparent first, because most captions want nothing. */
const BACKDROPS: [string | undefined, string][] = [
	[undefined, "透明"],
	["#ffffffe6", "白色"],
	["#111827e6", "黑色"],
	["#fde68ae6", "浅黄"],
];

/**
 * A picture that has been decoded, and its size in pixels.
 *
 * Two things arrive here and they are not the same object. The file editor annotates a picture it
 * has as a data URL, which decodes into an `<img>`. The screenshot overlay is handed the screen as
 * raw pixels and decodes them into an `ImageBitmap` — because encoding that screen to PNG in the
 * main process took 133ms of the delay before the capture appeared, and the picture the capture
 * shows is taken *before* that delay, so it was 133ms in which the screen could change and then
 * visibly snap back.
 *
 * `drawImage` takes either without knowing the difference. What differs is how they report their
 * size — `naturalWidth` against `width` — so that is read once, here, and everything downstream
 * uses this shape.
 */
export interface Decoded {
	source: CanvasImageSource;
	width: number;
	height: number;
}

export interface Annotator {
	tool: Tool;
	setTool: (tool: Tool) => void;
	colour: string;
	setColour: (colour: string) => void;
	/** What sits behind a caption; undefined is nothing at all. */
	backdrop: string | undefined;
	setBackdrop: (backdrop: string | undefined) => void;
	weight: number;
	setWeight: (weight: number) => void;
	undo: () => void;
	redo: () => void;
	clear: () => void;
	canUndo: boolean;
	canRedo: boolean;
	dirty: boolean;
	/** Which mark is selected, or null. An index into the current state's list. */
	selected: number | null;
	setSelected: (index: number | null) => void;
	removeSelected: () => void;
	/** The annotated image as a PNG data URL, or null before the source has decoded. */
	render: () => string | null;
	// Internals the canvas needs; not for callers.
	shapes: Shape[];
	canvas: React.RefObject<HTMLCanvasElement | null>;
	setHistory: React.Dispatch<React.SetStateAction<History>>;
	image: React.RefObject<Decoded | null>;
	/** The image redrawn at one pixel per mosaic block, which is where the mosaic samples from. */
	/** The averaged image a mosaic of this grid size samples from, built on demand and cached. */
	mosaicSourceFor(block: number): HTMLCanvasElement | null;
	ready: boolean;
	/**
	 * The source's natural width, in state rather than read off the ref.
	 *
	 * Every size in here — stroke, type, mosaic block — is derived from it, and deriving them from
	 * `image.current` means the derivation has no honest dependency: a ref cannot be one, and the
	 * `ready` flag standing in for it is a lie the linter is right to reject.
	 */
	width: number;
	/** The grid a mosaic drawn now would use. Marks already placed carry their own. */
	block: number;
}

// ---------------------------------------------------------------------------
// Custom weight and shared helpers
// ---------------------------------------------------------------------------

/** Multipliers for mark and text weight, used in Annotator and ScreenshotOverlay. */
export const WEIGHT_LEVELS: [number, string, number][] = [
	[0.6, "细", 4],
	[1, "中", 6],
	[1.8, "粗", 9],
];

export interface AnnotatorOptions {
	initialTool?: Tool;
	initialColour?: string;
	initialWeight?: number;
	/**
	 * A value that changes when the picture does, even if the bytes do not.
	 *
	 * The screenshot overlay is one long-lived page now — it is shown and hidden rather than built
	 * and destroyed — so `src` is the only thing telling it a *new* capture has begun. Two captures
	 * of a screen that did not change in between encode to byte-identical PNGs, so `src` is
	 * identical too, and the marks drawn on the first one would still be there on the second.
	 */
	session?: number | string;
}

/**
 * The screen as raw pixels, straight from the main process.
 *
 * RGBA already: the swap out of the platform's BGRA is five milliseconds in the main process and
 * would be a 22MB loop in the renderer, on the thread that has to paint the result.
 */
export interface RawPixels {
	pixels: Uint8Array;
	width: number;
	height: number;
}

export function useAnnotator(src: string | RawPixels | null, options?: AnnotatorOptions): Annotator {
	const canvas = useRef<HTMLCanvasElement>(null);
	const image = useRef<Decoded | null>(null);
	const [tool, setTool] = useState<Tool>(options?.initialTool ?? "pen");
	const [colour, setColour] = useState(options?.initialColour ?? COLOURS[0]!);
	const [backdrop, setBackdrop] = useState<string | undefined>(undefined);
	const [history, setHistory] = useState<History>(emptyHistory);
	const [selected, setSelected] = useState<number | null>(null);
	const [ready, setReady] = useState(false);
	const [width, setWidth] = useState(0);
	const [weight, setWeight] = useState(options?.initialWeight ?? 1);

	// Load once; every repaint draws this same decoded bitmap rather than re-decoding the data URL.
	const session = options?.session;
	useEffect(() => {
		setReady(false);
		setHistory(emptyHistory());
		setSelected(null);

		/*
		 * Let go of the picture before taking another.
		 *
		 * An `ImageBitmap` holds its pixels outside the JavaScript heap — on this screen, 22MB of
		 * them — and the collector has no idea how much it is sitting on, so it is in no hurry. The
		 * screenshot overlay reaches here on every capture *and* when a capture ends, and the window
		 * it lives in is never destroyed any more, so nothing else would ever free them.
		 */
		const previous = image.current;
		image.current = null;
		if (previous?.source instanceof ImageBitmap) previous.source.close();

		/*
		 * The mosaic's averaged copies belong to the picture that is going away.
		 *
		 * They were kept in a ref and only ever written to, so a second capture found the *first*
		 * capture's averages still cached under the same grid size and blitted those. The blocks
		 * came out in colours from nowhere on this screen — the desktop behind the previous
		 * screenshot, in the case that made this visible.
		 *
		 * Which makes it worse than a rendering fault: a mosaic is what people reach for to cover
		 * something they do not want seen, and this one was painting pixels from an *earlier*
		 * screenshot over it. Not only was the thing underneath not redacted, the blocks on top
		 * were showing a different capture's content.
		 */
		sources.current.clear();

		// The viewer passes "" while it is only showing the picture. Setting an empty `src` on an
		// Image resolves against the document URL and fetches the page itself, so it is not a
		// harmless no-op — it has to be skipped rather than allowed to fail.
		if (!src) return;

		/** Whatever decoded — hand it over, size the canvas to it, and repaint. */
		const accept = (decoded: Decoded) => {
			image.current = decoded;
			const el = canvas.current;
			if (el) {
				el.width = decoded.width;
				el.height = decoded.height;
			}
			setWidth(decoded.width);
			setReady(true);
		};

		/*
		 * Raw pixels take the short way in.
		 *
		 * `createImageBitmap` on an `ImageData` is a copy, not a decode — there is no PNG to parse,
		 * because the main process never encoded one. That is where the 133ms went that used to sit
		 * between taking the picture and being able to show it.
		 */
		if (typeof src !== "string") {
			let live = true;
			const data = new ImageData(new Uint8ClampedArray(src.pixels), src.width, src.height);
			void createImageBitmap(data).then(
				(bitmap) => {
					if (live) accept({ source: bitmap, width: bitmap.width, height: bitmap.height });
					else bitmap.close();
				},
				() => {},
			);
			return () => {
				live = false;
			};
		}

		const img = new Image();
		img.onload = () => accept({ source: img, width: img.naturalWidth, height: img.naturalHeight });
		img.src = src;
		return () => {
			img.onload = null;
		};
		// `session` carries no data — it is here so a second capture of an unchanged screen, whose
		// pixels are byte-for-byte the ones before, still clears the marks. See `AnnotatorOptions`.
	}, [src, session]);

	/** The grain a mosaic drawn *now* would use. Marks already on the picture carry their own. */
	const block = width > 0 ? mosaicBlock(width, weight) : 0;

	/**
	 * The averaged image a mosaic is blitted from, one per grid size, built on demand.
	 *
	 * Drawing the whole picture into a canvas one pixel per block gives, in a single call, the
	 * average colour of every block — which is what a mosaic is. Painting a block is then blitting
	 * one pixel of it back at block size with smoothing off; the alternative, averaging pixels per
	 * block per frame, is the same answer computed thousands of times a second.
	 *
	 * Keyed by block size rather than kept as one canvas, because the source's resolution *is* the
	 * grid: it holds `naturalWidth / block` pixels, so one built for one grain and blitted at
	 * another samples the wrong pixel for every cell. Now that each mark remembers the grain it was
	 * drawn at, a single picture can hold several — a coarse redaction over a window and a fine one
	 * over a line of text — and each needs its own source. There are only as many as there are size
	 * settings, and each is a few kilobytes.
	 */
	const sources = useRef(new Map<number, HTMLCanvasElement>());
	const mosaicSourceFor = useCallback(
		(grid: number): HTMLCanvasElement | null => {
			const img = image.current;
			const key = Math.max(1, Math.round(grid));
			if (!img || !Number.isFinite(grid) || grid <= 0) return null;
			const known = sources.current.get(key);
			if (known) return known;
			const small = document.createElement("canvas");
			small.width = Math.max(1, Math.ceil(img.width / key));
			small.height = Math.max(1, Math.ceil(img.height / key));
			small.getContext("2d")?.drawImage(img.source, 0, 0, small.width, small.height);
			sources.current.set(key, small);
			return small;
		},
		[image],
	);

	const shapes = current(history);

	/**
	 * Restyle the selected mark, if there is one.
	 *
	 * The toolbar used to be purely about *what happens next*: picking red set the colour the next
	 * mark would be drawn in and left the arrow you had just drawn — still selected, still showing
	 * its handles — exactly as it was. Every editor works the other way round, and for good reason:
	 * a selection is the thing you are talking about, so the control you reach for next is about
	 * that thing. The only way to change a mark's colour was to delete it and draw it again.
	 *
	 * Committed to history, so it can be undone like any other edit.
	 */
	const restyle = useCallback(
		(change: (shape: Shape) => Shape) => {
			setHistory((h) => {
				const list = current(h);
				if (selected === null || selected >= list.length) return h;
				return commit(
					h,
					list.map((shape, index) => (index === selected ? change(shape) : shape)),
				);
			});
		},
		[selected],
	);

	const applyColour = useCallback(
		(next: string) => {
			setColour(next);
			restyle((shape) => ({ ...shape, colour: next }));
		},
		[restyle],
	);

	/**
	 * The size control, applied to the selected mark as well.
	 *
	 * Each tool measures "size" in its own units — a line has a stroke, text has a point size, a
	 * mosaic has a grid and a brush — so this recomputes whichever ones that mark actually carries
	 * rather than writing a stroke onto everything. Text keeps its column and its height in step
	 * with the new size, or the box that was measured for 15pt would clip 22pt.
	 */
	const applyWeight = useCallback(
		(next: number) => {
			setWeight(next);
			if (width <= 0) return;
			const stroke = Math.max(1, strokeFor(width) * next);
			restyle((shape) => {
				if (shape.tool === "text") {
					const size = stroke * TEXT_SCALE;
					const ratio = shape.size ? size / shape.size : 1;
					return {
						...shape,
						size,
						width: shape.width ? shape.width * ratio : shape.width,
						height: shape.height ? shape.height * ratio : shape.height,
					};
				}
				if (shape.tool === "mosaic") {
					return { ...shape, block: mosaicBlock(width, next), brush: mosaicBrush(width) * next };
				}
				return { ...shape, stroke };
			});
		},
		[restyle, width],
	);


	/*
	 * Anything that changes the list clears the selection.
	 *
	 * A selection is an index, and an index only means something against the list it was taken
	 * from. After an undo the list is a different one: the same index is a different mark, or none
	 * at all, and a selection box would be drawn around something the user did not select. Clearing
	 * is both correct and what every editor does — undo puts you back, it does not keep your hands
	 * where they were.
	 */
	const step = useCallback((change: (h: History) => History) => {
		setSelected(null);
		setHistory(change);
	}, []);

	return {
		tool,
		setTool: useCallback((next: Tool) => {
			// Changing tool is changing subject: the mark that was selected is no longer the thing
			// being worked on, and a box left around it would outlive its meaning.
			setSelected(null);
			setTool(next);
		}, []),
		colour,
		setColour: applyColour,
		backdrop,
		setBackdrop,
		weight,
		setWeight: applyWeight,
		undo: useCallback(() => step(undo), [step]),
		redo: useCallback(() => step(redo), [step]),
		clear: useCallback(() => step((h) => (current(h).length === 0 ? h : commit(h, []))), [step]),
		canUndo: canUndo(history),
		canRedo: canRedo(history),
		dirty: shapes.length > 0,
		selected,
		setSelected,
		// Two plain calls rather than one inside the other's updater: an updater has to be pure,
		// because React runs it more than once per commit. This is the same trap that made a caption
		// commit twice, and it is worth writing out longhand every time.
		removeSelected: useCallback(() => {
			if (selected === null) return;
			setHistory((h) => {
				const list = current(h);
				return selected < list.length ? commit(h, list.filter((_, i) => i !== selected)) : h;
			});
			setSelected(null);
		}, [selected]),
		render: useCallback(() => canvas.current?.toDataURL("image/png") ?? null, []),
		shapes,
		canvas,
		setHistory,
		image,
		mosaicSourceFor,
		ready,
		width,
		block,
	};
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/** Shared with the viewer's `<img>` so entering edit mode does not resize the picture by a pixel. */
export const STAGE_FIT = "max-h-[86vh] max-w-[86vw]";

const CURSOR: Partial<Record<Tool, string>> = {
	text: "cursor-text",
	step: "cursor-copy",
	/*
	 * The mosaic hides the pointer and draws its own.
	 *
	 * How much a stroke will cover is the one thing you need to know before making it — redaction
	 * is not something you want to discover you did too narrowly — and a system cursor cannot say
	 * it. The ring below is that answer, drawn at the brush's real size, so a system cursor beside
	 * it would only be a second thing to look at.
	 */
	mosaic: "cursor-none",
};

/**
 * @param className Replaces the canvas's own sizing and framing, for a caller that has to place it
 *   exactly. The viewer wants `STAGE_FIT` — a picture sized by its own pixels, capped at the
 *   window; the screenshot overlay wants the opposite, a canvas pinned to a rectangle it has
 *   already chosen. Left alone the canvas lays out at its bitmap's size in CSS pixels, which on a
 *   Retina screen is twice the region it is supposed to cover.
 */
export function AnnotateCanvas({
	annotator,
	zoom,
	className,
	style,
}: {
	annotator: Annotator;
	zoom: number;
	className?: string;
	style?: React.CSSProperties;
}) {
	const { canvas, image, mosaicSourceFor, ready, width, tool, colour, backdrop, weight, shapes, setHistory, selected, setSelected } =
		annotator;
	const [drawing, setDrawing] = useState<Shape | null>(null);
	const [typing, setTyping] = useState<Typing | null>(null);
	const [dragging, setDragging] = useState<Dragging | null>(null);
	const [hovering, setHovering] = useState<"move" | "point" | "width" | null>(null);
	/** Where the mosaic ring is, in image pixels, or null when the pointer is not over the canvas. */
	const [brushAt, setBrushAt] = useState<Point | null>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const sizing = useRef<{ x: number; from: number; scale: number } | null>(null);
	const carrying = useRef<{ x: number; y: number; from: Point; scale: number } | null>(null);

	const base = strokeFor(width);
	const stroke = Math.max(1, base * weight);
	const typeSize = stroke * TEXT_SCALE;

	/*
	 * Image pixels → display pixels, read during render rather than stored.
	 *
	 * Declared up here because `commitText` closes over it: a `useCallback` dependency array is
	 * evaluated as the component renders, so a `const` defined further down is still in its temporal
	 * dead zone by the time the array is built.
	 */
	const display = canvas.current && canvas.current.width > 0 ? canvas.current.clientWidth / canvas.current.width : 1;

	/*
	 * Sized on attach as well as on load, which is what stops the flash.
	 *
	 * A canvas with no width attribute is 300×150. Entering edit mode mounted one at that size and
	 * corrected it when the image finished decoding, so there was a frame — sometimes several — where
	 * a small white box stood in for the picture. Now the viewer keeps the image decoded while it is
	 * merely being looked at, so by the time this mounts the natural size is already known and can be
	 * applied in the same breath as the element appearing.
	 */
	const attach = useCallback(
		(el: HTMLCanvasElement | null) => {
			canvas.current = el;
			const img = image.current;
			if (el && img && el.width !== img.width) {
				el.width = img.width;
				el.height = img.height;
			}
		},
		[canvas, image],
	);

	/**
	 * What is actually on screen: the committed marks, with the one being dragged shown where it is
	 * being dragged to, and the one being re-edited taken out because the field is standing in for it.
	 */
	const live = useMemo(() => {
		const list = shapes
			.map((shape, index) => (dragging?.index === index ? dragging.moving : shape))
			.filter((_, index) => index !== typing?.replacing);
		return drawing ? [...list, drawing] : list;
	}, [shapes, drawing, dragging, typing?.replacing]);

	/** The selected mark as it currently looks, which during a drag is not what is committed. */
	const chosen = selected === null ? null : (dragging?.index === selected ? dragging.moving : shapes[selected]) ?? null;
	const grips = chosen ? handlesOf(chosen) : [];
	/**
	 * How close counts as pressing a grip, in image pixels — about what the grip looks like.
	 *
	 * It used to be derived from the stroke and multiplied by 1.8, which on a Retina capture came out
	 * around 25 image pixels for a dot drawn at 10. A target two and a half times its own size is a
	 * mark you cannot reliably pick *up*: reach for the middle of a rectangle to move it and a corner
	 * claims the press instead, and it resizes. Sized off `display` so the reach is the same few
	 * points on screen whatever the picture's resolution or the zoom.
	 */
	const gripReach = 9 / (display || 1);

	/*
	 * The canvas carries only what will be saved.
	 *
	 * The selection box is drawn in the DOM, a few lines below, rather than here. Painting it onto
	 * the canvas would mean `toDataURL` picked it up, and the fix for that — repaint without it,
	 * grab the URL, repaint with it — is a second rendering path that exists only to be forgotten
	 * about later. An element over the canvas cannot end up in the file.
	 */
	useEffect(() => {
		const el = canvas.current;
		const img = image.current;
		if (!el || !img || !ready) return;
		const ctx = el.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, el.width, el.height);
		ctx.drawImage(img.source, 0, 0);

		/*
		 * These are the sizes for a mark that has none of its own — the one being dragged out right
		 * now, and anything drawn by a build from before marks carried their own. Everything else
		 * paints at the size it was made at; see `paintAll`.
		 */
		paintAll(ctx, live, {
			stroke,
			mosaicSourceFor,
			block: annotator.block,
			brush: mosaicBrush(width) * weight,
		});
	}, [live, ready, width, stroke, weight, canvas, image, mosaicSourceFor, annotator.block]);

	/**
	 * The column that just fits this text, in image pixels.
	 *
	 * Measured with the same font the caption will be painted in, so the box the user types into is
	 * the shape the caption will actually be. Capped at most of the picture, because a single
	 * unbroken line of CJK has no natural place to stop.
	 */
	const fitWidth = useCallback(
		(text: string): number => {
			const ctx = canvas.current?.getContext("2d");
			const pad = typeSize * PAD * 2;
			if (!ctx) return typeSize * 8;
			ctx.font = fontOf(typeSize);
			const longest = text.split("\n").reduce((n, line) => Math.max(n, ctx.measureText(line).width), 0);
			/*
			 * Two separate questions, which were being answered by one number.
			 *
			 * How much room sits past the last glyph, and how wide a box with nothing in it is, are
			 * not the same thing — and treating them as one is what produced both complaints in
			 * turn. A floor of six characters kept the placeholder readable and left a caption
			 * sitting in a box far wider than its text; dropping the floor to 1.6 tightened the
			 * caption and squeezed a four-character placeholder into a column one character wide.
			 *
			 * So: the padding is what `PAD` says and is already symmetric — the field puts the same
			 * amount on all four sides. What was making the right side look loose is the allowance
			 * added *after* it, which lands entirely on the right because text is left-aligned. A
			 * caret is one or two pixels; it does not need a third of a character.
			 *
			 * And the floor is measured rather than guessed: whatever the placeholder happens to
			 * say, an empty box is wide enough to show it on one line.
			 */
			const caret = Math.max(2, typeSize * 0.08);
			const floor = ctx.measureText(PLACEHOLDER).width + pad + caret;
			return Math.min(Math.max(longest + pad + caret, floor), Math.max(width * 0.9, floor));
		},
		[canvas, typeSize, width],
	);

	/** Whether the field has been focused for the caption currently open in it. */
	const entered = useRef(false);

	// Focused on appearing, so typing can start immediately; and grown to fit its content on every
	// keystroke, so the box is always exactly as tall as what is in it.
	useEffect(() => {
		const el = field.current;
		if (!el || !typing) {
			entered.current = false;
			return;
		}
		if (document.activeElement !== el) el.focus();

		/*
		 * Caret at the end, and only on the way in.
		 *
		 * Reopening a caption is almost always to add to it or fix its tail, and a caret parked at
		 * character zero puts every new word in front of what is already there — "改了第一段" when
		 * "第一段改了" was meant. Doing it once rather than on every keystroke, because this effect
		 * also runs for each character typed and moving the caret then would make the field
		 * impossible to edit in the middle.
		 */
		if (!entered.current) {
			entered.current = true;
			const end = el.value.length;
			el.setSelectionRange(end, end);
		}

		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [typing]);

	/** Display coordinates → image pixels, which is where the shapes live. */
	// Takes anything with client coordinates, so a double-click can be located the same way a
	// pointer press is without either knowing about the other's event type.
	const at = useCallback(
		(event: { clientX: number; clientY: number }): Point => {
			const el = canvas.current;
			if (!el) return { x: 0, y: 0 };
			// The rect already includes the stage's zoom transform, so this is correct at any zoom.
			const box = el.getBoundingClientRect();
			return {
				x: ((event.clientX - box.left) / box.width) * el.width,
				y: ((event.clientY - box.top) / box.height) * el.height,
			};
		},
		[canvas],
	);

	/*
	 * Two plain calls, not one nested inside a state updater.
	 *
	 * Reaching for `setTyping(entry => { setHistory(...); return null })` reads as a way to get at
	 * the current entry without listing it as a dependency, and it is wrong: an updater has to be a
	 * pure function of the state, because React calls it more than once per commit — twice under
	 * StrictMode. The caption was therefore committed twice, landing two identical shapes on the
	 * same spot. Nothing looked wrong; it took two presses of undo to remove one caption.
	 */
	const commitText = useCallback(() => {
		if (!typing) return;
		const { at: where, value, width: column, replacing } = typing;
		// Measured from the field that typed it, so the box that can be selected later is exactly the
		// box that was seen. Falls back to one line if the element has already gone.
		const height = field.current ? field.current.offsetHeight / (display || 1) : typeSize * LINE;

		setHistory((h) => {
			const list = current(h);
			const written = value.trim();

			if (replacing !== undefined) {
				if (replacing >= list.length) return h;
				// Emptying an existing caption removes it. Anything else would leave an invisible mark
				// that can still be selected, which is worse than either outcome the user meant.
				if (!written) return commit(h, list.filter((_, i) => i !== replacing));
				return commit(
					h,
					list.map((shape, i) =>
						i === replacing
							? { ...shape, colour, points: [where], text: value, size: typeSize, width: column, height, background: backdrop }
							: shape,
					),
				);
			}

			if (!written) return h;
			return commit(h, [
				...list,
				{ tool: "text", colour, points: [where], text: value, size: typeSize, width: column, height, background: backdrop },
			]);
		});
		setTyping(null);
	}, [typing, setHistory, colour, typeSize, backdrop, display]);

	/** Put an existing caption back into the field it came from. */
	const editText = useCallback(
		(index: number) => {
			const shape = shapes[index];
			if (!shape || shape.tool !== "text") return false;
			annotator.setColour(shape.colour);
			annotator.setBackdrop(shape.background);
			setSelected(null);
			setTyping({
				at: shape.points[0] ?? { x: 0, y: 0 },
				value: shape.text ?? "",
				width: shape.width ?? fitWidth(shape.text ?? ""),
				// Its width is already a decision — either dragged, or fitted when it was written.
				manual: shape.width !== undefined,
				replacing: index,
			});
			return true;
		},
		[shapes, annotator, setSelected, fitWidth],
	);

	const start = (event: React.PointerEvent) => {
		if (event.button !== 0) return;
		const point = at(event);

		const tolerance = pickTolerance(stroke, zoom);

		/*
		 * The selected mark is grabbable under *every* tool, not only under the selecting one.
		 *
		 * This is the whole point of the arrangement. Drawing a rectangle and then wanting it two
		 * centimetres to the left used to mean: switch to a pointer tool, drag, switch back. Three
		 * actions for one adjustment, every time, and the same again for the next rectangle. Here the
		 * mark you just drew is still live: press on it to move it, press on a grip to resize it,
		 * press anywhere else and you are drawing the next one. Nothing has to be switched.
		 *
		 * Only the *selected* mark, deliberately. If every mark were grabbable, a pen stroke across
		 * one already on the picture would move it instead of drawing, and the tool in your hand
		 * would stop meaning what it says.
		 */
		if (chosen && selected !== null) {
			const grip = grips.find((g) => Math.hypot(g.at.x - point.x, g.at.y - point.y) <= gripReach);
			if (grip) {
				event.currentTarget.setPointerCapture(event.pointerId);
				setDragging({ index: selected, from: point, moving: chosen, handle: grip.index, moved: false, wasSelected: true });
				return;
			}
		}

		/*
		 * What this press has taken hold of, if anything.
		 *
		 * Any existing mark, under any tool that *places* something — which is every tool except the
		 * two that smear. Placing a rectangle, an arrow, a badge or a caption starts from a point you
		 * chose deliberately, and choosing a point that happens to be on another mark's outline is
		 * rare; wanting to nudge that other mark is not. Restricting this to the selected one, which
		 * is where it started, meant drawing a box, drawing an arrow, and then finding the box
		 * untouchable — the arrow had taken the selection with it, and pressing on the box drew a
		 * second arrow.
		 *
		 * The pen and the mosaic are excluded, and that is the whole of the trade-off. They are
		 * smeared rather than placed: the stroke begins wherever the hand happens to be, often
		 * directly over something already on the picture, and a brush that grabbed what it was
		 * supposed to draw across would be useless. With those two the tool always wins.
		 *
		 * What is left is narrow and self-correcting: an outline is only hit within a few points of
		 * its stroke, so the inside of a box is still free to draw in and write in, and a rectangle
		 * can always be started from a different corner.
		 */
		const smears = tool === "pen" || tool === "mosaic";
		let target = -1;
		let held = false;
		/*
		 * The selected mark is grabbed anywhere inside its frame, not only on its stroke.
		 *
		 * Everything else still goes by the outline — see `insideBounds` for why that distinction is
		 * worth keeping. The pen and the mosaic are excluded from even this: their frame is the
		 * bounding box of a scribble, which can span half the picture.
		 */
		const framed = chosen !== null && chosen.tool !== "pen" && chosen.tool !== "mosaic";
		if (
			chosen &&
			selected !== null &&
			(hitShape([chosen], point, tolerance) === 0 ||
				(framed && insideBounds(chosen, point, chosen.stroke ?? stroke, tolerance)))
		) {
			target = selected;
			held = true;
		} else if (!smears) {
			target = hitShape(shapes, point, tolerance);
		}

		if (target >= 0) {
			// Committing first: the caption being written is finished with the moment another mark is
			// picked up, and leaving it open would make the next release edit two things at once.
			if (typing && typing.replacing !== target) commitText();
			setSelected(target);
			event.currentTarget.setPointerCapture(event.pointerId);
			setDragging({ index: target, from: point, moving: shapes[target]!, handle: null, moved: false, wasSelected: held });
			return;
		}

		// Nothing under the pointer, so this is the start of a new mark.
		if (selected !== null) setSelected(null);

		if (tool === "text") {
			/*
			 * A field on the picture, not a `window.prompt`.
			 *
			 * Electron disables prompt outright — it returns null without showing anything, which is
			 * why the text tool did nothing at all. Typing in place is also the better version
			 * regardless: the caption is styled, sized and positioned as it will be, rather than
			 * described in a box somewhere else and then discovered.
			 *
			 * `preventDefault` is what makes it stay. A press on the canvas moves focus as its
			 * default action, and the field mounts into that press: it was focused by the effect
			 * below and blurred again by the same click a moment later, and `onBlur` commits an empty
			 * caption, which is to say it removes the field. The result was a box that flickered for
			 * one frame — indistinguishable from the tool doing nothing, which is how it was reported.
			 */
			event.preventDefault();
			// Commit what is open and start a new one where the click landed, rather than making the
			// second click of two do nothing but put the first one away.
			if (typing) commitText();
			setTyping({ at: point, value: "", width: fitWidth("") });
			return;
		}

		// A badge is placed, not dragged; there is nothing to preview between press and release.
		if (tool === "step") {
			// Carries its own size too: the badge's radius is derived from the stroke.
			setHistory((h) => commit(h, [...current(h), { tool: "step", colour, points: [point], stroke }]));
			setSelected(shapes.length);
			return;
		}

		event.currentTarget.setPointerCapture(event.pointerId);
		/*
		 * The size is stamped on at the moment of drawing, not read back at paint time.
		 *
		 * Otherwise every mark on the picture is drawn at whatever the toolbar currently says, and
		 * changing the setting reaches back and resizes finished work — redact three things coarsely,
		 * pick a finer grain for the fourth, and the first three turn fine as well.
		 */
		setDrawing({
			tool: tool as Exclude<Tool, "text" | "step">,
			colour,
			points: [point],
			stroke,
			...(tool === "mosaic" ? { block: annotator.block, brush: mosaicBrush(width) * weight } : {}),
		});
	};

	const move = (event: React.PointerEvent) => {
		const point = at(event);

		// Only while the mosaic is in hand; every other tool leaves this null and draws no ring.
		setBrushAt(tool === "mosaic" ? point : null);

		/*
		 * The cursor says whether there is anything here to pick up.
		 *
		 * Tested against the same `hitShape` the press uses, so what the cursor promises and what a
		 * press delivers cannot disagree — including the part where a hollow rectangle is grabbable
		 * on its edge and not in its middle. Only written when it changes, so moving across empty
		 * space does not re-render on every pointer event.
		 */
		if (!dragging) {
			const tol = pickTolerance(stroke, zoom);
			let over: "move" | "point" | "width" | null = null;
			if (chosen && selected !== null) {
				const grip = grips.find((g) => Math.hypot(g.at.x - point.x, g.at.y - point.y) <= gripReach);
				if (grip) over = grip.index === WIDTH_HANDLE ? "width" : "point";
				else if (hitShape([chosen], point, tol) === 0) over = "move";
			}
			// Same rule as the press: everything is grabbable except under the two smearing tools.
			if (!over && tool !== "pen" && tool !== "mosaic" && hitShape(shapes, point, tol) >= 0) over = "move";
			setHovering((was) => (was === over ? was : over));
		}

		if (dragging) {
			const dx = point.x - dragging.from.x;
			const dy = point.y - dragging.from.y;
			setDragging((held) => {
				if (!held) return held;
				const origin = shapes[held.index];
				if (!origin) return held;
				// Always from the original, so the drag does not accumulate rounding as it goes.
				const moving = held.handle === null ? moveShape(origin, dx, dy) : resizeShape(origin, held.handle, point);
				return { ...held, moving, moved: held.moved || Math.hypot(dx, dy) > 0.5 };
			});
			return;
		}

		if (!drawing) return;
		setDrawing((live) => {
			if (!live) return live;
			// Pen and mosaic accumulate; everything else is defined by its two ends.
			return live.tool === "pen" || live.tool === "mosaic"
				? { ...live, points: [...live.points, point] }
				: { ...live, points: [live.points[0]!, point] };
		});
	};

	const end = () => {
		if (dragging) {
			const { index, moving, moved, wasSelected } = dragging;
			if (moved) {
				// One step in the history per move, and none at all for a drag that went nowhere.
				setHistory((h) => {
					const list = current(h);
					return index < list.length ? commit(h, list.map((s, i) => (i === index ? moving : s))) : h;
				});
			} else {
				/*
				 * A press that went nowhere was a click, and on a caption a click means "let me at the
				 * words" — either because the text tool is in hand, or because this is the second click
				 * on something already selected.
				 *
				 * Deciding it here rather than on the way down is what lets one gesture serve both:
				 * press and drag moves the caption, press and release opens it. Neither has to be
				 * chosen in advance, which is the whole reason a single click can safely do something
				 * as consequential as entering an editor.
				 */
				const shape = shapes[index];
				if (shape?.tool === "text" && (tool === "text" || wasSelected)) {
					editText(index);
				} else if (wasSelected) {
					/*
					 * Clicking again on something already selected steps down through whatever is
					 * stacked under the pointer.
					 *
					 * Marks pile up — an arrow that ends inside a box, a badge on a line — and the hit
					 * test always answers with the topmost, so without this the ones underneath could
					 * be seen and never touched. Cycling means the second click reaches the second
					 * mark, and the last one wraps back to the top.
					 *
					 * Captions are excluded above because for them a second click already means "open
					 * the words", which is the more common thing to want from one.
					 */
					// `from` is where the press landed, and it did not move, so it is still the point.
					const stack = hitShapes(shapes, dragging.from, pickTolerance(stroke, zoom));
					if (stack.length > 1) {
						const here = stack.indexOf(index);
						setSelected(stack[(here + 1) % stack.length] ?? index);
					}
				}
			}
			setDragging(null);
			return;
		}

		if (!drawing) return;
		// A click with no drag leaves a one-point shape, which paints as nothing — drop it, except
		// for the pen and the mosaic, where a single dab is a legitimate mark.
		const keeps = drawing.tool === "pen" || drawing.tool === "mosaic";
		if (drawing.points.length > 1 || keeps) {
			setHistory((h) => commit(h, [...current(h), drawing]));
			// Handed back with its grips on, so the next thing you do to it is the adjustment rather
			// than the hunt for the tool that allows the adjustment.
			if (SELECT_ON_DRAW.has(drawing.tool)) setSelected(shapes.length);
		}
		setDrawing(null);
	};

	/*
	 * Grabbing while a mark is being moved, move while one is under the pointer, and the tool's own
	 * cursor otherwise. `grabbing` outranks `move` so the cursor does not flicker back the instant a
	 * fast drag outruns the hit test.
	 */
	const cursor = dragging
		? "cursor-grabbing"
		: hovering === "width"
			? "cursor-ew-resize"
			: hovering === "point"
				? "cursor-nwse-resize"
				: hovering === "move"
					? "cursor-move"
					: (CURSOR[tool] ?? "cursor-crosshair");

	// In display pixels. `chosen` already follows the drag, so the box travels with the mark rather
	// than staying where it was picked up.
	const box = chosen ? shapeBounds(chosen, stroke) : null;

	return (
		<div className="relative">
			<canvas
				ref={attach}
				draggable={false}
				onPointerDown={start}
				onPointerMove={move}
				onPointerUp={end}
				onPointerCancel={end}
				onPointerLeave={() => {
					setHovering(null);
					setBrushAt(null);
				}}
				onDoubleClick={(event) => {
					/*
					 * Only to stop the stage below from zooming.
					 *
					 * Opening a caption is not handled here any more: two clicks already do it — the
					 * first selects, the second opens — so catching the double as well would open it
					 * twice and throw away whatever the first one had started.
					 */
					event.stopPropagation();
				}}
				className={`${className ?? `${STAGE_FIT} rounded-xl bg-white`} block ${cursor}`}
				style={{ touchAction: "none", ...style }}
			/>

			{/*
			 * What the mosaic is about to cover, at the size it will cover it.
			 *
			 * Drawn rather than described, because the only useful answer to "how big is the brush"
			 * is the shape of it on the picture underneath. `display` converts the brush from image
			 * pixels to screen ones, so the ring is the stroke's true footprint at any zoom — and it
					 * changes the moment the size setting does, which is how that control explains itself.
			 */}
			{tool === "mosaic" && brushAt && (
				<span
					className="pointer-events-none absolute rounded-full border border-white/80 bg-white/15 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
					style={{
						left: (brushAt.x - mosaicBrush(width) * weight / 2) * display,
						top: (brushAt.y - mosaicBrush(width) * weight / 2) * display,
						width: mosaicBrush(width) * weight * display,
						height: mosaicBrush(width) * weight * display,
					}}
				/>
			)}

			{box && (
				/*
				 * Just a frame. The delete button lives on the toolbar.
				 *
				 * It used to float at this box's corner, which put a fixed 24pt control wherever the
				 * mark happened to be: over the neighbouring text when two marks sat close together,
				 * off the top of the picture when one was near the edge, and larger than the mark
				 * itself when the mark was small. A control whose position is decided by the thing it
				 * acts on cannot avoid any of that. On the toolbar it is always in the same place,
				 * always the same size, and never on top of the picture.
				 *
				 * `pointer-events-none`, because this lies over the mark and a frame that swallowed the
				 * press would make the thing it points at the one thing you cannot grab.
				 */
				<span
					className="pointer-events-none absolute rounded-[3px] border border-sky-400 border-dashed bg-sky-400/10"
					style={{
						left: box.x * display,
						top: box.y * display,
						width: box.w * display,
						height: box.h * display,
					}}
				/>
			)}

			{/*
			 * The grips, drawn but not clickable.
			 *
			 * Hit testing for them happens on the canvas, against the same coordinates the drag will
			 * use. Making them real targets would mean a second copy of that logic living in the DOM,
			 * and two copies of a hit test is one more than can be kept in agreement.
			 */}
			{chosen &&
				grips.map((grip) => (
					<span
						key={grip.index}
						className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 shadow-sm"
						style={{
							left: grip.at.x * display - 5,
							top: grip.at.y * display - 5,
						}}
					/>
				))}

			{typing && (
				/*
				 * The field is the preview.
				 *
				 * Every value below is the display-space image of what `paint` will do with the same
				 * caption: the same font, the same line height, the same padding, the same colour, the
				 * same backdrop, wrapping at the same column. The earlier version made the field
				 * transparent and painted a preview underneath it, which is two implementations of one
				 * appearance and looked it — a grey box with a dashed border, nothing like the result.
				 */
				<div
					className="absolute"
					style={{ left: typing.at.x * display, top: typing.at.y * display, width: typing.width * display }}
					onPointerDown={(event) => event.stopPropagation()}
				>
					{/*
					 * A border you can pick the caption up by, while still typing in it.
					 *
					 * It sits under the field and eight points wider on every side, so the only part of
					 * it that can be pressed is the margin outside the text — the middle still puts the
					 * caret where you clicked. Without it, moving a caption you were part-way through
					 * writing meant committing it, switching tools, dragging, and double-clicking back
					 * in, which is four actions to answer "not there, here".
					 */}
					<span
						aria-hidden
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.setPointerCapture(event.pointerId);
							carrying.current = { x: event.clientX, y: event.clientY, from: typing.at, scale: display || 1 };
						}}
						onPointerMove={(event) => {
							const held = carrying.current;
							if (!held) return;
							setTyping((entry) =>
								entry
									? {
											...entry,
											at: {
												x: held.from.x + (event.clientX - held.x) / held.scale,
												y: held.from.y + (event.clientY - held.y) / held.scale,
											},
										}
									: entry,
							);
						}}
						onPointerUp={() => {
							carrying.current = null;
						}}
						className="-inset-2 absolute cursor-move rounded-lg"
					/>
					<textarea
						ref={field}
						value={typing.value}
						onChange={(event) =>
							setTyping((entry) =>
								entry
									? {
											...entry,
											value: event.target.value,
											width: entry.manual ? entry.width : fitWidth(event.target.value),
										}
									: entry,
							)
						}
						onBlur={commitText}
						onKeyDown={(event) => {
							// Stopped here so the viewer's Escape does not close the whole overlay when all
							// that was wanted was to abandon a caption.
							event.stopPropagation();
							/*
							 * Enter breaks the line. It used to commit the caption.
							 *
							 * Typing a second line is an ordinary thing to want and `shift`+`enter` is a
							 * convention for sending, not for writing — every other place text is written
							 * puts the line break on the plain key. A caption is finished by clicking away
							 * from it, which is also how you start the next one.
							 */
							if (event.key === "Escape") setTyping(null);
						}}
						placeholder={PLACEHOLDER}
						rows={1}
						spellCheck={false}
						className="relative block w-full resize-none overflow-hidden border-0 bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
						style={{
							font: fontOf(typeSize * display),
							lineHeight: LINE,
							padding: `${typeSize * PAD * display}px`,
							color: colour,
							background: backdrop ?? "transparent",
							borderRadius: `${typeSize * 0.2 * display}px`,
							caretColor: colour,
							// Same breaking rule as the canvas: anywhere for CJK, at spaces for latin.
							wordBreak: "break-word",
							whiteSpace: "pre-wrap",
							/*
							 * The same light outline the paint adds when there is no backdrop, and for the
							 * same reason. Without it here the typed text is a shade more saturated than
							 * the committed text, which is a difference you only notice at the moment the
							 * field disappears and the caption seems to change.
							 *
							 * `paint-order` puts the stroke under the fill, which is what drawing
							 * `strokeText` before `fillText` does on the canvas.
							 */
							// Kept in step with `paint`: a hairline, not a halo. The two must match or the
							// caption changes appearance at the moment the field disappears.
							WebkitTextStroke: backdrop
								? undefined
								: `${Math.max(1, typeSize / 18) * display}px rgba(255,255,255,0.85)`,
							paintOrder: "stroke fill",
						}}
					/>
					{/* A dotted outline that is not part of the caption, only of editing it. */}
					<span className="pointer-events-none absolute inset-0 rounded-md border border-sky-400/70 border-dashed" />
					<button
						type="button"
						aria-label="调整文字宽度"
						data-ly-tip="拖动调整宽度"
						data-ly-tip-side="top"
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.setPointerCapture(event.pointerId);
							sizing.current = { x: event.clientX, from: typing.width, scale: display || 1 };
						}}
						onPointerMove={(event) => {
							const held = sizing.current;
							if (!held) return;
							const next = held.from + (event.clientX - held.x) / held.scale;
							setTyping((entry) =>
								entry ? { ...entry, manual: true, width: Math.max(typeSize * 2, Math.min(next, width)) } : entry,
							);
						}}
						onPointerUp={() => {
							sizing.current = null;
						}}
						className="-right-1.5 -bottom-1.5 absolute h-3.5 w-3.5 cursor-ew-resize rounded-full border border-white bg-sky-400 shadow-sm transition-transform duration-[var(--ly-t-quick)] hover:scale-125"
					/>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------

const TOOLS: [Tool, typeof Pencil, string][] = [
	["pen", Pencil, "画笔"],
	["arrow", ArrowUpRight, "箭头"],
	["line", Minus, "直线"],
	["rect", Square, "矩形"],
	["ellipse", Circle, "圆形"],
	["step", ListOrdered, "步骤标号"],
	["text", Type, "文字"],
	["mosaic", Grid2x2, "马赛克"],
];

/**
 * What the size control is sizing, per tool.
 *
 * One control has always driven all three; only its name was ever about lines.
 */
const SIZE_LABEL: Partial<Record<Tool, string>> = {
	text: "字号",
	mosaic: "马赛克大小",
	step: "标号大小",
};

const COLOUR_NAMES: Record<string, string> = {
	"#ef4444": "红色",
	"#3b82f6": "蓝色",
	"#22c55e": "绿色",
	"#eab308": "黄色",
	"#111827": "黑色",
};

export function AnnotateToolbar({
	annotator,
	onCancel,
	onSave,
	canReplace,
	saveLabel,
	cancelLabel = "退出标注",
	requireDirty = true,
	className,
	style,
	propertiesSide = "above",
}: {
	annotator: Annotator;
	onCancel: () => void;
	onSave: () => void;
	/**
	 * Which way the tool's own settings bubble opens, in terms of this bar.
	 *
	 * `above` puts it over the bar, `below` under it. The caller decides because only the caller
	 * knows where the bar was placed relative to what is being annotated: the bubble has to open
	 * away from that, or it covers it. Defaults to `above`, which is right for the file editor,
	 * where the bar is pinned to the bottom of the stage.
	 */
	propertiesSide?: "above" | "below";
	/** Whether saving can replace the original, or only produce a copy. */
	canReplace: boolean;
	/** Overrides what the save button says. Left off, it says what `canReplace` implies. */
	saveLabel?: string;
	cancelLabel?: string;
	/**
	 * Whether saving requires a mark to have been made.
	 *
	 * True for a picture that already exists — saving an untouched copy of it produces a second
	 * identical file, which is why the button is dead until there is something to save. False for
	 * the screenshot overlay, where the button is how the capture itself is confirmed and an
	 * unannotated region is the commonest thing anyone wants.
	 */
	requireDirty?: boolean;
	className?: string;
	style?: React.CSSProperties;
}) {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		// One frame late, so the transition has a start state to move away from.
		const id = requestAnimationFrame(() => setShown(true));
		return () => cancelAnimationFrame(id);
	}, []);

	// Undo, redo and delete from the keyboard, which is where anyone drawing reaches first.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			// Never while typing a caption: there, ⌘Z belongs to the field and backspace is a
			// backspace. A shortcut that deletes the mark you are in the middle of writing is worse
			// than no shortcut.
			if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) annotator.redo();
				else annotator.undo();
				return;
			}

			if ((event.key === "Backspace" || event.key === "Delete") && annotator.selected !== null) {
				// Backspace is the browser's "go back" on some setups; taking it is the point.
				event.preventDefault();
				annotator.removeSelected();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [annotator]);

	return (
		<div
			/*
			 * Fixed to the window, at a size that does not depend on the picture.
			 *
			 * The toolbar used to sit under the image in a column, which meant the image had to give up
			 * height to make room for it — entering edit mode visibly shrank the picture. Floating it
			 * means the picture is exactly the same size in both modes, and the bar stays legible
			 * against whatever is behind it through its own background rather than by pushing things
			 * out of the way.
			 */
			className={
				className ??
				"pointer-events-auto fixed bottom-6 left-1/2 z-[120] flex relative items-center gap-0.5 rounded-xl border border-white/12 bg-[#1c1c1e]/92 px-1.5 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-[opacity,transform] duration-[var(--ly-t-base)] ease-out"
			}
			style={{
				opacity: shown ? 1 : 0,
				transform: className ? undefined : `translateX(-50%) translateY(${shown ? 0 : 10}px)`,
				...style,
			}}
			/*
			 * The bar never takes focus away from what is being typed.
			 *
			 * A caption is committed when its field loses focus, and pressing a button here was
			 * enough to do that — so reaching for a bigger size ended the caption instead of
			 * resizing it, and the next press started a new one somewhere else. Preventing the
			 * default on `mousedown` is what stops the focus moving; the click still fires, so every
			 * control works exactly as before, only now the field is still there afterwards and the
			 * new size is applied to it live.
			 */
			onMouseDown={(event) => event.preventDefault()}
		>
			{/*
			 * The properties of the tool in hand, above the row rather than inside it.
			 *
			 * Every property of every tool laid out in one line is what made this bar as wide as a
			 * laptop screen — and most of it was inert at any moment, because a colour does nothing
			 * for a mosaic and a backdrop does nothing for an arrow. Lifted into a bubble that points
			 * at the tool it belongs to, the row is just the tools, and what is on screen is only
			 * what the current tool actually has.
			 */}
			<ToolProperties annotator={annotator} index={TOOLS.findIndex(([id]) => id === annotator.tool)} side={propertiesSide} />

			{TOOLS.map(([id, Icon, label]) => (
				<ToolButton key={id} label={label} active={annotator.tool === id} onClick={() => annotator.setTool(id)}>
					<Icon size={14} strokeWidth={1.9} />
				</ToolButton>
			))}

			<Divider />

			<ToolButton label="撤销 ⌘Z" disabled={!annotator.canUndo} onClick={annotator.undo}>
				<Undo2 size={14} strokeWidth={1.9} />
			</ToolButton>
			<ToolButton label="重做 ⇧⌘Z" disabled={!annotator.canRedo} onClick={annotator.redo}>
				<Redo2 size={14} strokeWidth={1.9} />
			</ToolButton>
			{/*
			 * Deleting the selected mark, where the selected mark is not.
			 *
			 * Present only while something is selected, next to the other things that act on the
			 * drawing as a whole. It appears rather than greying out, so the row does not carry a dead
			 * control most of the time.
			 */}
			{annotator.selected !== null && (
				<span className="flex animate-[ly-tool-in_var(--ly-t-base)_ease-out]">
					<ToolButton label="删除选中 ⌫" onClick={annotator.removeSelected}>
						<Delete size={14} strokeWidth={1.9} />
					</ToolButton>
				</span>
			)}
			<ToolButton label="清空" disabled={!annotator.dirty} onClick={annotator.clear}>
				<Trash2 size={14} strokeWidth={1.9} />
			</ToolButton>

			<Divider />

			<button
				type="button"
				data-ly-tip={cancelLabel}
				data-ly-tip-side="top"
				aria-label={cancelLabel}
				onClick={onCancel}
				className="flex h-6 items-center rounded-md px-2 text-white/65 transition-colors duration-[var(--ly-t-quick)] hover:text-white"
			>
				<X size={13} strokeWidth={2} />
			</button>
			<button
				type="button"
				data-ly-tip={saveLabel ?? (canReplace ? "保存并替换原图" : "导出一份带标注的副本")}
				data-ly-tip-side="top"
				disabled={requireDirty && !annotator.dirty}
				onClick={onSave}
				// `whitespace-nowrap` because the label is four characters and the button is sized by
				// its padding: without it "保存副本" wrapped to two lines and took the whole bar's
				// height with it.
				className="flex h-6 items-center whitespace-nowrap rounded-md bg-white px-2.5 text-detail font-medium text-[#1c1c1e] transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90 disabled:opacity-35"
			>
				{saveLabel ?? (canReplace ? "保存" : "保存副本")}
			</button>
		</div>
	);
}

/** `mx-1.5` rather than `mx-1`: the swatch next to a divider carries a ring that needs the room. */
const Divider = () => <span className="mx-1.5 h-4 w-px shrink-0 bg-white/15" />;

/** Roughly how far along the row a tool button's centre sits: 24pt wide, 2pt apart, 6pt of padding. */
const TOOL_STEP = 26;
const TOOL_INSET = 18;

/**
 * The properties of the tool currently in hand, in a bubble that points at it.
 *
 * Two things are gained by lifting these out of the row. The row stops being a catalogue of every
 * property of every tool — which is what made it wide enough to run off the side of the screen —
 * and each tool gets to show only what it actually has: a mosaic samples the picture underneath it
 * and has no colour, an arrow has no backdrop. A control that cannot affect the thing in your hand
 * is worse than a missing one, because it reads as a promise the tool does not keep.
 *
 * Anchored to the tool's own button rather than centred, so which tool is being configured is
 * answered by where the bubble is, and clamped so it cannot hang off either end of the bar.
 */
function ToolProperties({ annotator, index, side }: { annotator: Annotator; index: number; side: "above" | "below" }) {
	const isText = annotator.tool === "text";
	// The mosaic is the one tool with no colour of its own — it takes the picture's.
	const hasColour = annotator.tool !== "mosaic";

	return (
		<div
			/*
			 * Opens away from the region, not always upwards.
			 *
			 * The toolbar itself sits below the selection whenever there is room, so a bubble pinned
			 * to `bottom-full` opened into the gap between the two — over the bottom of the very
			 * region being annotated. Which side is "away" is only known where the toolbar was
			 * placed, so it is passed in: `below` means the toolbar is below the selection and the
			 * bubble goes further down, `above` means it is above and the bubble goes further up.
			 */
			className={`absolute left-0 flex animate-[ly-tool-in_var(--ly-t-base)_ease-out] items-center gap-1 rounded-lg border border-white/12 bg-[#1c1c1e]/95 px-2 py-1 shadow-[0_6px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl ${
				side === "below" ? "top-full mt-2" : "bottom-full mb-2"
			}`}
			style={{ left: Math.max(0, index) * TOOL_STEP + TOOL_INSET, transform: "translateX(-50%)" }}
		>
			{WEIGHT_LEVELS.map(([value, label]) => (
				<button
					key={label}
					type="button"
					onClick={() => annotator.setWeight(value)}
					aria-label={`${SIZE_LABEL[annotator.tool] ?? "粗细"} ${label}`}
					aria-pressed={annotator.weight === value}
					className={`flex h-5 items-center rounded px-1.5 text-caption transition-colors ${
						annotator.weight === value ? "bg-white/20 text-white" : "text-white/55 hover:bg-white/10 hover:text-white"
					}`}
				>
					{label}
				</button>
			))}

			{hasColour && <span className="mx-0.5 h-3.5 w-px shrink-0 bg-white/15" />}

			{hasColour &&
				COLOURS.map((value) => (
					<button
						key={value}
						type="button"
						aria-label={COLOUR_NAMES[value] ?? value}
						aria-pressed={annotator.colour === value}
						onClick={() => annotator.setColour(value)}
						style={{ background: value }}
						className={`h-[14px] w-[14px] shrink-0 rounded-full transition-transform duration-[var(--ly-t-quick)] ${
							annotator.colour === value
								? "scale-110 ring-2 ring-white/85 ring-offset-2 ring-offset-[#1c1c1e]"
								: "opacity-80 hover:scale-110 hover:opacity-100"
						}`}
					/>
				))}

			{/* A caption can sit on a plate; nothing else can, so nothing else offers it. */}
			{isText && <span className="mx-0.5 h-3.5 w-px shrink-0 bg-white/15" />}
			{isText &&
				BACKDROPS.map(([value, label]) => (
					<button
						key={label}
						type="button"
						aria-label={`文字底色 ${label}`}
						aria-pressed={annotator.backdrop === value}
						onClick={() => annotator.setBackdrop(value)}
						style={value ? { background: value } : undefined}
						className={`h-[14px] w-[14px] shrink-0 rounded-[4px] transition-transform duration-[var(--ly-t-quick)] ${
							value ? "" : "ly-checker-xs"
						} ${
							annotator.backdrop === value
								? "scale-110 ring-2 ring-white/85 ring-offset-2 ring-offset-[#1c1c1e]"
								: "opacity-80 hover:scale-110 hover:opacity-100"
						}`}
					/>
				))}

			{/* The tail, which is what makes it a bubble belonging to a button rather than a second row. */}
			{/*
			 * The little point, on whichever side the toolbar actually is.
			 *
			 * It exists to say which button this bubble belongs to, and it was pinned to the bottom
			 * and pointing down no matter where the bubble opened. The bubble flips: when the
			 * toolbar sits below the region, the bubble opens *below the toolbar*, and a point on
			 * its underside was aiming at empty screen — at the dock, in the report — while the
			 * button it belongs to was above it.
			 *
			 * Rotating a square by 45° and keeping two of its borders is what makes the tip; which
			 * two decides which way it faces.
			 */}
			<span
				className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-white/12 bg-[#1c1c1e]/95 ${
					side === "below" ? "-top-1 border-t border-l" : "-bottom-1 border-r border-b"
				}`}
			/>
		</div>
	);
}

function ToolButton({
	label,
	active,
	disabled,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			// Above: the bar sits at the bottom of the window, so a bubble below it would be off screen
			// and get flipped anyway. Saying so directly avoids the flip.
			data-ly-tip-side="top"
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-[var(--ly-t-quick)] disabled:opacity-30 ${
				active ? "bg-white text-[#1c1c1e]" : "text-white/65 hover:bg-white/12 hover:text-white"
			}`}
		>
			{children}
		</button>
	);
}
