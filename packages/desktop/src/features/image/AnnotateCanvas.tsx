/**
 * 画布：把标记画出来，以及把指针动作翻译成标记。
 *
 * 从 `Annotator.tsx` 拆出来的第二块。标记是一张形状清单，每帧从清单重画，而不是随手落笔累积
 * 到画布上——那是撤销/重做能成为清单上的一个游标而不是一叠位图的原因，也是撤掉一个步骤徽章之后
 * 其余的会自己重新编号的原因，还是「正在拖的那个矩形」能实时显示的原因：预览和提交走的是同一段
 * 代码，清单加一个临时项而已。
 *
 * 标记存在图片的**原始**像素里；画布的像素数则按它在屏幕上的样子来（见 `backingScale`），不再
 * 等于原图。指针坐标进来时经 `getBoundingClientRect` 换算，那个方法已经把上层舞台的缩放算进去了
 * ——所以在 400% 下画，落点仍然在指针处。缩放在这里只用来定两件事：画布该有多少像素才清楚，以及
 * 选中框、手柄这些「编辑用的东西」该缩回多少才不跟着图一起变大。
 *
 * 工具条为什么不在这里：`AnnotateToolbar.tsx` 的文件头写着。
 */

import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { Textarea } from "../../ui/inputs/NativeField.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	badgeAt,
	commit,
	constrainEnd,
	current,
	handlesOf,
	hitShape,
	hitShapes,
	insideBounds,
	mosaicBrush,
	moveShape,
	pickTolerance,
	resizeShape,
	shapeBounds,
	strokeAt,
	typeAt,
	WIDTH_HANDLE,
	type Point,
	type Shape,
	type Tool,
} from "./annotate.ts";
import { fontOf, paintAll, LINE, PAD } from "./paint.ts";
import type { Annotator } from "./Annotator.tsx";

/**
 * What an empty caption says, and therefore what an empty caption has to be wide enough for.
 *
 * A constant because two places need it and they must not drift: the field renders it, and
 * `fitWidth` measures it to decide how wide an empty box is. Written out in either place
 * separately, changing the wording would silently reintroduce a box its own placeholder does not
 * fit in — which is exactly how it broke: the floor was a guess in character counts, the
 * placeholder is four characters, and the guess was 1.6.
 */
/** The caption box's ghost text. A key: this module is loaded long before the language settles. */
const PLACEHOLDER: MessageKey = "annotate.textPlaceholder";

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
	/**
	 * Where its left edge was asked to be. A caption begun near the picture's right edge grows to the
	 * left as it is written, the way right-aligned text does, and moves back as words are deleted;
	 * this is where it moves back to. It used to wrap instead, at whatever room was left — a sentence
	 * begun at the edge came out four characters wide and six lines tall.
	 */
	anchor?: number;
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

/** Shared with the viewer's `<img>` so entering edit mode does not resize the picture by a pixel. */
export const STAGE_FIT = "max-h-[86vh] max-w-[86vw]";

/** A drag shorter than this, in screen points, was a click that wobbled — not a shape. */
const MIN_DRAG = 4;

/** The most pixels a canvas is given, whatever the zoom: 4096², 64MB. */
const MAX_BACKING = 4096 * 4096;

/**
 * How many canvas pixels to give each image pixel, so the marks are as sharp as the screen.
 *
 * The canvas used to have exactly the picture's pixels and let CSS stretch it. A screenshot is shown
 * at one image pixel per device pixel, so that was right for the capture overlay and nowhere else: a
 * 1408px drawing fitted into a window at 1100 points is 2200 device pixels wide on a Retina screen,
 * and every line, arrow and caption on it was a 1408px drawing blown up by 1.56 — soft edges on
 * things that are meant to be crisp, and worse with every step of zoom.
 *
 * Never fewer than the picture's own pixels (that is what is saved, and shown smaller it is sharp
 * already), never more than `MAX_BACKING`, and in eighths so a pinch does not reallocate the canvas
 * on every event of the gesture. Below 1.05 it is 1: a capture is drawn at its own pixels exactly,
 * because the overlay crops the saved picture straight out of this canvas.
 */
function backingScale(css: number, dpr: number, zoom: number, width: number, height: number): number {
	if (css <= 0 || width <= 0 || height <= 0) return 1;
	const wanted = Math.min((css * dpr * zoom) / width, Math.sqrt(MAX_BACKING / (width * height)));
	return wanted < 1.05 ? 1 : Math.ceil(wanted * 8) / 8;
}

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
	const { canvas, image, mosaicSourceFor, ready, width, tool, colour, backdrop, weight, shapes, setHistory, selected, setSelected, colorSpace, unit, setUnit } =
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

	/** The canvas's laid-out width in CSS pixels, watched rather than read once. */
	const [cssWidth, setCssWidth] = useState(0);
	const observer = useRef<ResizeObserver | null>(null);
	/** Device pixels per CSS pixel, which changes when the window moves to another screen. */
	const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
	useEffect(() => {
		let media: MediaQueryList | null = null;
		const watch = () => {
			setDpr(window.devicePixelRatio || 1);
			media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
			media.addEventListener("change", watch, { once: true });
		};
		watch();
		return () => media?.removeEventListener("change", watch);
	}, []);

	/*
	 * Image pixels → display pixels, at the picture's fitted size.
	 *
	 * Declared up here because `commitText` closes over it: a `useCallback` dependency array is
	 * evaluated as the component renders, so a `const` defined further down is still in its temporal
	 * dead zone by the time the array is built. Against the picture's width, not the canvas's: the
	 * canvas has as many pixels as the screen needs (`backingScale`), the picture has its own.
	 */
	const laidOut = cssWidth || canvas.current?.clientWidth || 0;
	const display = laidOut > 0 && width > 0 ? laidOut / width : 1;
	/** Screen points per image pixel as it is being looked at: what a press is aimed in. */
	const scale = display * zoom;
	/** Editing chrome — the frame, the grips — is drawn inside the zoomed stage and scaled back out. */
	const chrome = 1 / Math.max(zoom, 0.01);
	const height = image.current?.height ?? 0;
	const backing = backingScale(laidOut, dpr, zoom, width, height);

	// The sizes a mark drawn now gets, in image pixels: screen sizes through `unit`. See `strokeAt`.
	const stroke = strokeAt(unit, weight);
	const typeSize = typeAt(unit, weight);
	const badge = badgeAt(unit, weight);
	const brush = mosaicBrush(unit, weight);

	// Tell the annotator how big the picture is on screen, so the toolbar's sizes land the same way.
	useEffect(() => {
		if (laidOut <= 0 || width <= 0) return;
		const next = width / laidOut;
		if (Math.abs(next - unit) / unit > 0.005) setUnit(next);
	}, [laidOut, width, unit, setUnit]);

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
			observer.current?.disconnect();
			observer.current = null;
			if (!el) return;
			const img = image.current;
			if (img && el.width !== img.width) {
				el.width = img.width;
				el.height = img.height;
			}
			// Its size on screen decides how many pixels it needs and how big a point is in image pixels.
			setCssWidth(el.clientWidth);
			observer.current = new ResizeObserver(() => setCssWidth(el.clientWidth));
			observer.current.observe(el);
		},
		[canvas, image],
	);
	useEffect(() => () => observer.current?.disconnect(), []);

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
	 * claims the press instead, and it resizes. Sized off `scale` so the reach is the same few points
	 * on screen whatever the picture's resolution or the zoom — it was `display` alone, so at 400% a
	 * grip reached 36 points out and a press meant to move a small box resized it instead.
	 */
	const gripReach = 9 / (scale || 1);

	/** The grip under a point on the selected mark, if any — the press and the cursor both ask. */
	const gripAt = (point: Point) => grips.find((g) => Math.hypot(g.at.x - point.x, g.at.y - point.y) <= gripReach);

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
		// As many pixels as the screen shows it at; the marks are drawn in image pixels through a scale.
		const w = Math.max(1, Math.round(img.width * backing));
		const h = Math.max(1, Math.round(img.height * backing));
		if (el.width !== w || el.height !== h) {
			el.width = w;
			el.height = h;
		}
		/*
		 * 画布的色彩空间跟图片的一致，否则 `drawImage` 会替我们转一道。
		 *
		 * 第一次 `getContext` 决定了这块画布的色彩空间，之后再传别的参数没有用——所以这里传的必须
		 * 跟别处一致。截图那条路上它是显示器的空间，别处（看图、编辑本地文件）是 sRGB。
		 */
		const ctx = el.getContext("2d", { colorSpace });
		if (!ctx) return;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, el.width, el.height);
		ctx.setTransform(w / img.width, 0, 0, h / img.height, 0, 0);
		ctx.imageSmoothingQuality = "high";
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
			brush,
		});
	}, [live, ready, stroke, brush, backing, canvas, image, mosaicSourceFor, annotator.block, colorSpace]);

	/**
	 * The column that just fits this text, in image pixels.
	 *
	 * Measured with the same font the caption will be painted in, so the box the user types into is
	 * the shape the caption will actually be. Capped at most of the picture, because a single
	 * unbroken line of CJK has no natural place to stop.
	 */
	const fitWidth = useCallback(
		(text: string): number => {
			/*
			 * 这里只量字，跟颜色无关——参数还是要跟别处一模一样。
			 *
			 * 一块画布的色彩空间由**第一次** `getContext` 定下，之后再传什么都会被忽略。如果用户先
			 * 点了文字工具、这一句先跑，画布就被定成了 sRGB，上面那处再传 display-p3 也无济于事：
			 * 整张截图从此偏色，而触发条件是「先打字还是先画别的」这种没人会联想到的顺序。
			 */
			const ctx = canvas.current?.getContext("2d", { colorSpace });
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
			const floor = ctx.measureText(translate(PLACEHOLDER)).width + pad + caret;
			return Math.min(Math.max(longest + pad + caret, floor), Math.max(width * 0.9, floor));
		},
		[canvas, typeSize, width, colorSpace],
	);

	/**
	 * An unsized caption, fitted to its text: as wide as its longest line, moved left from its anchor
	 * when the picture's right edge would cut it, and only then wrapped.
	 */
	const fitTyping = useCallback(
		(entry: Typing, value: string): Typing => {
			if (entry.manual) return { ...entry, value };
			const wanted = fitWidth(value);
			const pad = typeSize * PAD;
			const left = Math.max(-pad, Math.min(entry.anchor ?? entry.at.x, width - wanted));
			return { ...entry, value, at: { ...entry.at, x: left }, width: Math.min(wanted, width - left) };
		},
		[fitWidth, typeSize, width],
	);

	// A size picked while writing applies to the caption at once, and its box follows the new size.
	useEffect(() => {
		setTyping((entry) => (entry && !entry.manual ? fitTyping(entry, entry.value) : entry));
	}, [fitTyping]);

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
			const img = image.current;
			if (!el || !img) return { x: 0, y: 0 };
			// The rect already includes the stage's zoom transform, so this is correct at any zoom. The
			// picture's pixels, not the canvas's: the canvas has as many as the screen needs.
			const box = el.getBoundingClientRect();
			return {
				x: ((event.clientX - box.left) / box.width) * img.width,
				y: ((event.clientY - box.top) / box.height) * img.height,
			};
		},
		[canvas, image],
	);

	/** The caption last committed, so a second call for the same one — a blur after a press — does nothing. */
	const committed = useRef<Typing | null>(null);
	/*
	 * Two plain calls, not one nested inside a state updater.
	 *
	 * Reaching for `setTyping(entry => { setHistory(...); return null })` reads as a way to get at
	 * the current entry without listing it as a dependency, and it is wrong: an updater has to be a
	 * pure function of the state, because React calls it more than once per commit — twice under
	 * StrictMode. The caption was therefore committed twice, landing two identical shapes on the
	 * same spot. Nothing looked wrong; it took two presses of undo to remove one caption.
	 */
	const commitText = useCallback((select = false) => {
		if (!typing || committed.current === typing) return;
		committed.current = typing;
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
							? { ...shape, colour, points: [where], text: value, size: typeSize, width: column, height, background: backdrop, fixed: typing.manual === true }
							: shape,
					),
				);
			}

			if (!written) return h;
			return commit(h, [
				...list,
				{ tool: "text", colour, points: [where], text: value, size: typeSize, width: column, height, background: backdrop, fixed: typing.manual === true },
			]);
		});
		/*
		 * Handed back selected when it was finished on purpose — Escape, ⌘↵, a click beside it — the way a
		 * box is handed back the moment it is drawn: the frame says it is a thing that can now be moved,
		 * resized and recoloured, and the toolbar's next press applies to it.
		 */
		if (select && value.trim()) setSelected(replacing ?? shapes.length);
		setTyping(null);
	}, [typing, setHistory, colour, typeSize, backdrop, display, setSelected, shapes.length]);

	/*
	 * Lend the caption to whoever is about to turn this drawing into a picture.
	 *
	 * A caption lives in a `<textarea>` over the canvas until something commits it, and what commits
	 * it is that field losing focus. The toolbar never takes focus — deliberately, so that pressing
	 * 粗 while writing resizes the caption instead of ending it — so 完成 pressed mid-caption
	 * committed nothing, and the text the user could plainly see was not in the file. It was on
	 * screen, in a field; the canvas underneath had never heard of it.
	 *
	 * Registered on every change of `typing`, because `commitText` closes over it. Cleared when
	 * there is nothing being typed, so `flushText` can answer "there was nothing" honestly rather
	 * than committing a stale closure.
	 */
	const { pendingText } = annotator;
	useEffect(() => {
		pendingText.current = typing ? commitText : null;
		return () => {
			pendingText.current = null;
		};
	}, [typing, commitText, pendingText]);

	/*
	 * Picking up another tool is being done with the caption.
	 *
	 * The toolbar never takes focus, so the field stayed open with the old caption in it while the new
	 * tool was already in hand — and the next press on the picture committed it by blurring the field
	 * *and* started a stroke, one gesture doing two things.
	 */
	const toolWas = useRef(tool);
	useEffect(() => {
		if (toolWas.current === tool) return;
		toolWas.current = tool;
		if (tool !== "text") commitText();
	}, [tool, commitText]);

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
				/*
				 * Its width is a decision only if a hand made it. Fitted when it was written, it keeps
				 * fitting: words added to a caption used to wrap at the width its first words had.
				 */
				manual: shape.fixed === true,
				anchor: shape.points[0]?.x,
				replacing: index,
			});
			return true;
		},
		[shapes, annotator, setSelected, fitWidth],
	);

	const start = (event: React.PointerEvent) => {
		if (event.button !== 0) return;
		const point = at(event);

		const tolerance = pickTolerance(stroke, scale);

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
			const grip = gripAt(point);
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
			/*
			 * A press beside the caption being written finishes it, and does only that.
			 *
			 * It used to finish it and open the next one where the press landed — a dashed box and a
			 * blinking caret at wherever the hand happened to click to say "done", which was almost
			 * never where a second caption was wanted. Clicking where it *was* wanted then threw the
			 * empty one away and opened another, so the box seemed to hop about the picture. Every
			 * annotator treats the first click away as the end of the caption; the next click starts
			 * the next one.
			 */
			if (typing) {
				commitText(true);
				return;
			}
			/*
			 * The caret where the press landed: the box is moved up and left by its padding and half a
			 * line, so the first line sits centred on the point and the text starts at it. Placed by
			 * its corner instead, every caption landed a line below and a little to the right of where
			 * it was asked for.
			 */
			const pad = typeSize * PAD;
			const line = typeSize * LINE;
			const imageHeight = image.current?.height ?? Number.POSITIVE_INFINITY;
			// Near the bottom edge the box moves up rather than hanging off the picture; near the right
			// edge `fitTyping` moves it left.
			const y = Math.max(-pad, Math.min(point.y - pad - line / 2, imageHeight - line - pad * 2));
			setTyping(fitTyping({ at: { x: point.x - pad, y }, anchor: point.x - pad, value: "", width: 0 }, ""));
			return;
		}

		// A badge is placed, not dragged; there is nothing to preview between press and release.
		if (tool === "step") {
			// Carries its own size too, the radius the toolbar is set to, like a caption's type size.
			setHistory((h) => commit(h, [...current(h), { tool: "step", colour, points: [point], stroke, size: badge }]));
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
			...(tool === "mosaic" ? { block: annotator.block, brush } : {}),
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
			const tol = pickTolerance(stroke, scale);
			let over: "move" | "point" | "width" | null = null;
			if (chosen && selected !== null) {
				const grip = gripAt(point);
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
		/*
		 * Every position the pointer passed through since the last frame, not just where it ended up.
		 *
		 * Pointer moves arrive once a frame, but the hand reports many more; the in-between ones come
		 * as coalesced events. A quick stroke drawn from the frame-rate ones alone is a handful of
		 * corners joined by straight lines.
		 */
		const passed = drawing.tool === "pen" || drawing.tool === "mosaic" ? event.nativeEvent.getCoalescedEvents?.().map(at) : undefined;
		const shift = event.shiftKey;
		setDrawing((live) => {
			if (!live) return live;
			// Pen and mosaic accumulate; everything else is defined by its two ends.
			if (live.tool === "pen" || live.tool === "mosaic") return { ...live, points: [...live.points, ...(passed?.length ? passed : [point])] };
			const from = live.points[0]!;
			return { ...live, points: [from, shift ? constrainEnd(live.tool, from, point) : point] };
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
					const stack = hitShapes(shapes, dragging.from, pickTolerance(stroke, scale));
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
		/*
		 * A click with no drag leaves a one-point shape, which paints as nothing — drop it, except for
		 * the pen and the mosaic, where a single dab is a legitimate mark.
		 *
		 * And a drag of a point or two is a click whose hand moved: it used to commit a box a pixel
		 * across, select it, and leave a frame around nothing that the next press then grabbed.
		 */
		const keeps = drawing.tool === "pen" || drawing.tool === "mosaic";
		const first = drawing.points[0]!;
		const last = drawing.points[drawing.points.length - 1]!;
		const travelled = Math.hypot(last.x - first.x, last.y - first.y) * scale;
		if (keeps || (drawing.points.length > 1 && travelled >= MIN_DRAG)) {
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
				/*
				 * `font-variant-numeric: normal`, because a canvas in the document draws its text with the
				 * element's numeric variant — and the app sets `tabular-nums` on the body for its counters.
				 * Every digit in a caption came out at the width of a 0: "123123123123" was 12% wider on
				 * the picture than in the field it was typed in, so it visibly spread out the moment it
				 * was committed, and the saved copy (drawn on a canvas outside the document) was narrower
				 * again. The field's `font` shorthand already resets it; this is the canvas's half.
				 */
				style={{ touchAction: "none", fontVariantNumeric: "normal", ...style }}
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
						left: (brushAt.x - brush / 2) * display,
						top: (brushAt.y - brush / 2) * display,
						width: brush * display,
						height: brush * display,
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
					className="pointer-events-none absolute border-sky-400 border-dashed bg-sky-400/10"
					style={{
						left: box.x * display,
						top: box.y * display,
						width: box.w * display,
						height: box.h * display,
						// The stage is zoomed and this is inside it; a frame that grew with the picture was a
						// 4pt dashed band at 400%. Its line and corner stay screen-sized.
						borderWidth: chrome,
						borderRadius: 3 * chrome,
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
						className="pointer-events-none absolute rounded-full border-white bg-sky-500 shadow-sm"
						style={{
							// Screen-sized at any zoom, like the frame: at 400% a 10pt grip was a 40pt disc.
							left: grip.at.x * display - 5 * chrome,
							top: grip.at.y * display - 5 * chrome,
							width: 10 * chrome,
							height: 10 * chrome,
							borderWidth: 2 * chrome,
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
							// Screen points to image pixels at the zoom it is being looked at, or it trails the pointer.
							carrying.current = { x: event.clientX, y: event.clientY, from: typing.at, scale: scale || 1 };
						}}
						onPointerMove={(event) => {
							const held = carrying.current;
							if (!held) return;
							setTyping((entry) => {
								if (!entry) return entry;
								const x = held.from.x + (event.clientX - held.x) / held.scale;
								// Put down somewhere else, that is where it now grows from.
								return { ...entry, anchor: x, at: { x, y: held.from.y + (event.clientY - held.y) / held.scale } };
							});
						}}
						onPointerUp={() => {
							carrying.current = null;
						}}
						className="-inset-2 absolute cursor-move rounded-lg"
					/>
					<Textarea
						ref={field}
						value={typing.value}
						onChange={(event) => {
							const value = event.target.value;
							setTyping((entry) => (entry ? fitTyping(entry, value) : entry));
						}}
						onBlur={() => commitText()}
						onKeyDown={(event) => {
							// Stopped here so the viewer's Escape does not close the whole overlay when all
							// that was wanted was to finish a caption.
							event.stopPropagation();
							/*
							 * Enter breaks the line. It used to commit the caption.
							 *
							 * Typing a second line is an ordinary thing to want and `shift`+`enter` is a
							 * convention for sending, not for writing — every other place text is written
							 * puts the line break on the plain key. A caption is finished by clicking away
							 * from it, by ⌘↵, or by Escape.
							 *
							 * Escape keeps what was written. It used to throw it away, which is what it does
							 * nowhere else text is typed in this app or on this platform: the words were on
							 * screen, Escape was pressed to be done with them, and they were gone. A caption
							 * not wanted is one press of undo away; one typed and lost is not.
							 */
							if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
								event.preventDefault();
								commitText(true);
							}
						}}
						placeholder={translate(PLACEHOLDER)}
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
					{/* A dotted outline that is not part of the caption, only of editing it — screen-sized, like the frame. */}
					<span className="pointer-events-none absolute inset-0 border-sky-400/70 border-dashed" style={{ borderWidth: chrome, borderRadius: 6 * chrome }} />
					<button
						type="button"
						aria-label={translate("annotate.textWidth")}
						data-ly-tip={translate("annotate.dragWidth")}
						data-ly-tip-side="top"
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.setPointerCapture(event.pointerId);
							sizing.current = { x: event.clientX, from: typing.width, scale: scale || 1 };
						}}
						onPointerMove={(event) => {
							const held = sizing.current;
							if (!held) return;
							const next = held.from + (event.clientX - held.x) / held.scale;
							setTyping((entry) =>
								entry ? { ...entry, manual: true, width: Math.max(typeSize * 2, Math.min(next, width - entry.at.x)) } : entry,
							);
						}}
						onPointerUp={() => {
							sizing.current = null;
						}}
						className="absolute cursor-ew-resize rounded-full border-white bg-sky-400 shadow-sm transition-transform duration-[var(--ly-t-quick)] hover:scale-125"
						style={{ right: -6 * chrome, bottom: -6 * chrome, width: 14 * chrome, height: 14 * chrome, borderWidth: chrome }}
					/>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------
