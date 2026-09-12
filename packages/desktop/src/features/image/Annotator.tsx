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

import { useCallback, useEffect, useRef, useState } from "react";

import {
	canRedo,
	canUndo,
	commit,
	current,
	emptyHistory,
	mosaicBlock,
	mosaicBrush,
	redo,
	undo,
	type History,
	type Shape,
	type Tool,
} from "./annotate.ts";
import { strokeFor, TEXT_SCALE } from "./paint.ts";

export const COLOURS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#111827"];






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
interface Decoded {
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
	/**
	 * Commit the caption being typed right now, if there is one. Returns whether there was.
	 *
	 * Anything that turns the drawing into a picture has to call this first. A caption lives in a
	 * `<textarea>` until it is committed, and what commits it is the field losing focus — but the
	 * toolbar deliberately does not take focus (`onMouseDown` → `preventDefault`), because pressing
	 * 粗 while writing a caption must resize that caption rather than end it. So pressing 完成 with
	 * the cursor still in a caption committed nothing at all: the text was on screen, in a field
	 * over the canvas, and the canvas is what gets cropped. The picture came out without it.
	 *
	 * `true` means something was committed and the canvas has *not* been repainted yet — the repaint
	 * is an effect, so it lands after React has flushed the state change. Callers wait a frame; see
	 * `withText` in `ScreenshotOverlay`.
	 */
	flushText: () => boolean;
	// Internals the canvas needs; not for callers.
	/**
	 * How `flushText` reaches the caption, which lives in `AnnotateCanvas` rather than here.
	 *
	 * A ref rather than state: the canvas fills it in while a caption is being typed and empties it
	 * afterwards, and nothing renders differently because of it. Lifting the whole editing state up
	 * here instead would move several hundred lines for one call.
	 */
	pendingText: React.RefObject<(() => void) | null>;
	shapes: Shape[];
	canvas: React.RefObject<HTMLCanvasElement | null>;
	setHistory: React.Dispatch<React.SetStateAction<History>>;
	image: React.RefObject<Decoded | null>;
	/** The image redrawn at one pixel per mosaic block, which is where the mosaic samples from. */
	/** The averaged image a mosaic of this grid size samples from, built on demand and cached. */
	mosaicSourceFor(block: number): HTMLCanvasElement | null;
	ready: boolean;
	/**
	 * How many pictures have decoded into this annotator, and the only honest dependency for
	 * "redraw, the source has changed".
	 *
	 * `ready` cannot say it. It goes false while a new source decodes and true again when it lands,
	 * so between two captures its *value* is true both times — and when the decode is quick enough to
	 * finish before React has flushed the `false`, both updates land in one pass, the flag never
	 * changes and an effect watching it never runs again. `image` cannot say it either: it is a ref,
	 * which is what stops it being a dependency at all.
	 *
	 * The screenshot overlay is where that costs something visible. It paints the frozen desktop from
	 * this bitmap in an effect keyed on `ready`, and a second capture taken while the first was still
	 * up decoded in five milliseconds — so the overlay went on showing the *previous* capture's
	 * picture while cropping out of the current one's, and never sent the `ready` handshake that puts
	 * the window on screen, which then waited out its 1500ms failsafe. `e2e/screenshot-restart-probe.ts`
	 * checks the log for the repaint.
	 */
	revision: number;
	/**
	 * 这张图和所有从它派生出来的 canvas 用的色彩空间。
	 *
	 * 传下去而不是各处自己猜：裁剪出来的那张、马赛克取样的那张、放大镜里的那张，都得跟主画布同一
	 * 个空间，否则 `drawImage` 会在它们之间做转换——一次转换就是一次色偏，而且只偏彩色不偏灰。
	 */
	colorSpace: PredefinedColorSpace;
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
	/**
	 * 这张图的数值属于哪个色彩空间。
	 *
	 * 只有截图会说这件事，因为只有它拿到的是显示器帧缓冲的原始数值——一台 Display P3 的机器上，
	 * 屏幕上的纯红在那串数里是 234,51,35。默认按 sRGB 读，那是每一张解码出来的图片的答案（PNG
	 * 自带 profile，浏览器已经替我们转好了），也是没有色彩管理时的安全答案。
	 */
	colorSpace?: PredefinedColorSpace;
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
	/** Filled in by `AnnotateCanvas` while a caption is being typed. See `flushText`. */
	const pendingText = useRef<(() => void) | null>(null);
	const [tool, setTool] = useState<Tool>(options?.initialTool ?? "pen");
	const [colour, setColour] = useState(options?.initialColour ?? COLOURS[0]!);
	const [backdrop, setBackdrop] = useState<string | undefined>(undefined);
	const [history, setHistory] = useState<History>(emptyHistory);
	const [selected, setSelected] = useState<number | null>(null);
	const [ready, setReady] = useState(false);
	/** See `revision` on `Annotator`: the counter `ready` cannot be. */
	const [revision, setRevision] = useState(0);
	const [width, setWidth] = useState(0);
	const [weight, setWeight] = useState(options?.initialWeight ?? 1);

	// Load once; every repaint draws this same decoded bitmap rather than re-decoding the data URL.
	const session = options?.session;
	const colorSpace = options?.colorSpace ?? "srgb";
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
			/*
			 * And say that it is a *different* picture, which none of the three above can.
			 *
			 * `ready` is true again and was true before; `width` is the same screen; the bitmap lives
			 * in a ref. A consumer that redraws off any of them redraws once and then never again for
			 * the life of the page — see `revision` on `Annotator` for what that looked like.
			 */
			setRevision((n) => n + 1);
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
			/*
			 * 按它本来的色彩空间读这串数，而不是一律当 sRGB。
			 *
			 * 抓屏拿回来的是显示器帧缓冲里的原始数值：一台 Display P3 的机器上，屏幕上的纯红在这串
			 * 数里是 234,51,35。不说清楚这一点，浏览器就按 sRGB 理解它，再替我们转一次去显示——那个
			 * 红被扩了一道，截出来比屏幕上更艳，而灰阶分毫不差（中性轴在两个空间里重合）。这正是
			 * 「截图有色差」被报上来的样子，`e2e/capture-colour-probe.mjs` 把它量成了数。
			 */
			const data = new ImageData(new Uint8ClampedArray(src.pixels), src.width, src.height, { colorSpace });
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
	}, [src, session, colorSpace]);

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
			// 跟主画布同一个色彩空间：`drawImage` 会在两个空间之间做转换，转过去再转回来，马赛克块
			// 的颜色就跟它盖住的那片不是一回事了。
			small.getContext("2d", { colorSpace })?.drawImage(img.source, 0, 0, small.width, small.height);
			sources.current.set(key, small);
			return small;
		},
		[image, colorSpace],
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
		flushText: useCallback(() => {
			const commit = pendingText.current;
			if (!commit) return false;
			commit();
			return true;
		}, []),
		pendingText,
		shapes,
		canvas,
		setHistory,
		image,
		mosaicSourceFor,
		ready,
		revision,
		colorSpace,
		width,
		block,
	};
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------
