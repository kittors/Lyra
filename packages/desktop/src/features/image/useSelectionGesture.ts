/**
 * 框选那一半：指针在做什么、框在哪、光标该是什么样。
 *
 * 从 `ScreenshotOverlay.tsx` 拆出来的第二块，也是那个文件最大的一块。截图这件事有两个阶段——先
 * 框一块，再在上面画——而这一个文件同时拿着两阶段的全部状态：17 个 `useState` 里有 8 个属于框选，
 * 三个指针处理函数加起来 240 行，读的时候分不出哪一行在服务哪一个阶段。
 *
 * 这里管的是第一个阶段，加上「框好了」这个交接信号（`isAnnotating`）。第二阶段的东西一件都不在：
 * 标记由 `useAnnotator` 拿着，工具条的位置在 `useToolbarPlacement` 里。
 *
 * 放大镜的读数也在这里，理由是它和框选共用一次指针移动：同一个 `pointermove` 既要更新框、又要从
 * 冻结的桌面上取一个像素的颜色，而且「有框之后放大镜就该让开」这条规则只有同时看见两者才写得出来。
 */

import { useCallback, useState } from "react";

import type { LoupeReading } from "./ScreenshotLoupe.tsx";
import {
	clampRect,
	hitHandle,
	insideRect,
	moveRect,
	rectFromPoints,
	resizeRect,
	HANDLE_CURSOR,
	type Handle,
	type Point,
	type Rect,
} from "./screenshot-geometry.ts";

/** 一次拖动到不了 10px 就不算框，算「点了一下」——见 `onPointerUp` 里那段。 */
const MIN_SELECTION = 10;

/** 抓角上那个把手的容差，单位是显示像素。 */
const HANDLE_GRAB = 10;

/**
 * How wide the frame's edge is to grab, in display pixels.
 *
 * Was 8, which is narrower than the border it sits on looks and had to be aimed at. Fourteen is
 * about the width of a window's resize edge on this platform, and the mark it decorates is only
 * 1px — the grab area is meant to be generous where the drawing is precise.
 *
 * 导出，是因为覆盖层还要照着它画那四条真实的抓取带（有元素在那儿，光标才是对的）——画出来的
 * 宽度和这里判定的宽度必须是同一个数，否则看得见的边和抓得到的边差一截。
 *
 * While annotating, the inside of the selection belongs to the pen: a press there draws. The
 * region still has to be movable, so the grab is the border itself — the same place the eye
 * already reads as the edge of the shot, and the same convention every other capture tool uses.
 */
export const EDGE_GRAB = 14;

type DragMode =
	| { kind: "none" }
	| { kind: "creating"; from: Point }
	| { kind: "moving"; from: Point; origin: Rect }
	| { kind: "resizing"; handle: Handle; origin: Rect };

/** Whether a point is on the selection's border rather than out in the middle of it. */
function onEdge(rect: Rect, at: Point, tolerance: number): boolean {
	if (!insideRect(rect, at)) return false;
	return (
		at.x - rect.x <= tolerance ||
		rect.x + rect.width - at.x <= tolerance ||
		at.y - rect.y <= tolerance ||
		rect.y + rect.height - at.y <= tolerance
	);
}

/**
 * The window under the pointer, which is the first one that contains it.
 *
 * Front to back is the order the Window Server returns them in, and it is the same order a click
 * would resolve — so what highlights is what you would have hit.
 */
function windowAt(windows: (Rect & { app: string })[] | undefined, at: Point): (Rect & { app: string }) | null {
	return windows?.find((w) => insideRect(w, at)) ?? null;
}

/** 这个 hook 要知道的、关于这一次截图的事。 */
export interface CaptureFrame {
	bounds: Rect;
	windows?: (Rect & { app: string })[];
	/** 覆盖层打开时指针已经在哪，用来在第一次移动之前就把窗口高亮点上。 */
	cursor?: Point | null;
}

export interface SelectionGesture {
	/** 框在哪，`null` 表示还没框。 */
	selection: Rect | null;
	/** 框好了，进入画的阶段。两阶段之间唯一的信号。 */
	isAnnotating: boolean;
	/** 覆盖层该显示的光标。 */
	cursor: string;
	/** 指针在哪（只在还没框的时候有值——有框之后放大镜要让开）。 */
	pointer: Point | null;
	/** 指针底下那个像素，给放大镜。 */
	reading: LoupeReading | null;
	/** 色值刚被复制过——放大镜自己那行「已复制」。 */
	copied: boolean;
	setCopied: (value: boolean) => void;
	/** 指针还没框时底下的那个窗口，用来高亮「整窗截图」。 */
	hoverWindow: (Rect & { app: string }) | null;
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: () => void;
	/** 新一轮开始：清空一切。`frame` 给了就顺手把指针底下那个窗口点上。 */
	reset: (frame?: CaptureFrame) => void;
}

export function useSelectionGesture(options: {
	frame: CaptureFrame | null;
	/** 冻结的桌面那张画布，取色从它上面读。 */
	backdrop: React.RefObject<HTMLCanvasElement | null>;
	colorSpace: "srgb" | "display-p3";
}): SelectionGesture {
	const { frame, backdrop, colorSpace } = options;

	const [selection, setSelection] = useState<Rect | null>(null);
	const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });
	const [cursor, setCursor] = useState("crosshair");
	const [isAnnotating, setIsAnnotating] = useState(false);

	/**
	 * The window the pointer is over, before a region has been drawn.
	 *
	 * Offering whole windows is most of what makes a capture quick: the common case is "this
	 * window", and dragging a rectangle around one by hand is both slower and less accurate than
	 * the window's own bounds. It stops mattering the moment a region exists — from then on the
	 * region is what is being adjusted.
	 */
	const [hoverWindow, setHoverWindow] = useState<(Rect & { app: string }) | null>(null);

	/**
	 * Where the pointer is and what is under it, for the loupe.
	 *
	 * Kept until a region exists: once there is something to annotate, a magnifier following the
	 * pointer is in the way of the drawing rather than in aid of it.
	 */
	const [pointer, setPointer] = useState<Point | null>(null);
	const [reading, setReading] = useState<LoupeReading | null>(null);
	const [copied, setCopied] = useState(false);

	const reset = useCallback((next?: CaptureFrame) => {
		setSelection(null);
		setDragMode({ kind: "none" });
		setCursor("crosshair");
		setIsAnnotating(false);
		setCopied(false);
		setReading(null);
		// Before any movement: the overlay often opens under a pointer that is not going to move.
		setPointer(next?.cursor ?? null);
		setHoverWindow(next?.cursor ? windowAt(next.windows, next.cursor) : null);
	}, []);

	const onPointerDown = (e: React.PointerEvent) => {
		if (!frame) return;
		/*
		 * A press on a control is not a press on the screen.
		 *
		 * The toolbar floats *outside* the selection — below it, by `toolbarPosition` — so without
		 * this every press on it falls through to the rule at the bottom of this function and is
		 * read as "start a new region somewhere else". Pressing any tool button therefore threw the
		 * selection away and went back to the empty crosshair, which is the whole of "点一个按钮就
		 * 立马出现新的截图". Nothing about it is visible to a test that clicks buttons through the
		 * DOM: `element.click()` dispatches a click and no pointer event at all.
		 */
		if ((e.target as HTMLElement).closest?.("[data-screenshot-ui]")) return;
		const pt: Point = { x: e.clientX, y: e.clientY };

		/*
		 * Taking the press means the canvas must not also have it.
		 *
		 * This runs in the capture phase, so it sees the press before `AnnotateCanvas` does. That
		 * matters for the edge band: there is no handle element out there, so the press lands on the
		 * canvas, which starts a stroke — and then bubbles up here and moves the selection. Dragging
		 * the frame therefore drew a line every time. Stopping propagation is what makes adjusting
		 * the region and drawing on it two different gestures instead of one gesture doing both.
		 */
		const take = () => {
			e.stopPropagation();
			(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
		};

		if (selection) {
			const handle = hitHandle(selection, pt, HANDLE_GRAB);
			if (handle) {
				setDragMode({ kind: "resizing", handle, origin: selection });
				take();
				return;
			}
			if (insideRect(selection, pt)) {
				// Before there is anything to annotate the whole region is a grab; afterwards only its
				// edge is, because the middle is the canvas.
				if (!isAnnotating || onEdge(selection, pt, EDGE_GRAB)) {
					setDragMode({ kind: "moving", from: pt, origin: selection });
					take();
				}
				// Otherwise the press belongs to `AnnotateCanvas`, and is deliberately left to reach it.
				return;
			}
		}

		/*
		 * Once a region exists, everything outside it is dead.
		 *
		 * It used to start a new region from scratch, throwing away the one that was framed and every
		 * mark on it — a whole capture lost to a press a few pixels outside the frame, which is easy
		 * to do while reaching for the toolbar. The region is adjusted by its handles and moved by its
		 * edge; nothing out here is meant to do anything, and the cursor says so.
		 *
		 * Escape is how you start over, and it is what the hint says.
		 */
		if (selection) {
			e.stopPropagation();
			return;
		}

		// With no region yet, a press anywhere begins one.
		setIsAnnotating(false);
		setDragMode({ kind: "creating", from: pt });
		setSelection({ x: pt.x, y: pt.y, width: 0, height: 0 });
		take();
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (!frame) return;
		const pt: Point = { x: e.clientX, y: e.clientY };

		/*
		 * The loupe follows the pointer until there is a region, and then gets out of the way.
		 *
		 * Sampled from the backdrop canvas: it holds the snapshot at its own resolution, so the
		 * coordinates reported are the picture's own and the colour is the one that will be saved.
		 */
		if (!selection) {
			setPointer(pt);
			const bg = backdrop.current;
			const scale = bg && frame.bounds.width ? bg.width / frame.bounds.width : 1;
			const px = Math.round(pt.x * scale);
			const py = Math.round(pt.y * scale);
			const ctx = bg?.getContext("2d", { colorSpace, willReadFrequently: true });
			if (ctx && px >= 0 && py >= 0 && px < (bg?.width ?? 0) && py < (bg?.height ?? 0)) {
				/*
				 * 报出来的色值要是 sRGB 的。
				 *
				 * 画布本身是显示器的空间（P3），里面存的数是 P3 的——直接读出来写成 #RRGGBB，得到的
				 * 是「屏幕上那个红」在 P3 里的坐标 EA3323，而不是任何人期待的 FF0000。取色器上的
				 * 值是要拿去填进 CSS 和设计稿的，那两处说的都是 sRGB。`getImageData` 的
				 * `colorSpace` 正是为这件事准备的：让浏览器替我们换算，而不是把坐标当颜色报出去。
				 */
				const [r, g, b] = ctx.getImageData(px, py, 1, 1, { colorSpace: "srgb" }).data;
				const hex = `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
				setReading({ x: px, y: py, hex });
			}
			setCopied(false);
		} else if (pointer) {
			setPointer(null);
		}

		if (dragMode.kind === "creating") {
			setSelection(clampRect(rectFromPoints(dragMode.from, pt), frame.bounds));
		} else if (dragMode.kind === "moving") {
			const dx = pt.x - dragMode.from.x;
			const dy = pt.y - dragMode.from.y;
			setSelection(moveRect(dragMode.origin, dx, dy, frame.bounds));
		} else if (dragMode.kind === "resizing") {
			setSelection(clampRect(resizeRect(dragMode.origin, dragMode.handle, pt), frame.bounds));
		} else if (!selection) {
			/*
			 * Nothing drawn yet, so offer whatever is under the pointer.
			 *
			 * Only in this state: once a region exists it is the thing being worked on, and having
			 * windows light up behind it would be offering to throw it away.
			 */
			setHoverWindow(windowAt(frame.windows, pt));
			setCursor("crosshair");
		} else {
			/*
			 * 有框，而且不在拖——那就只是在框上面移动，光标要说清这里能干什么。
			 *
			 * 原文这里写的是 `else if (selection)`，后面还跟一个 `else { setCursor("crosshair") }`。
			 * 那个分支到不了：上一个条件是 `!selection`，所以走到这里 `selection` 必然有值。搬过来
			 * 时并成了一个 `else`，把这句话留在这里，免得下一个人以为漏了一种情况。
			 */
			// Update hover cursor
			const handle = hitHandle(selection, pt, HANDLE_GRAB);
			if (handle) {
				setCursor(HANDLE_CURSOR[handle]);
				return;
			}
			if (insideRect(selection, pt)) {
				// The canvas sets its own cursor for the tool in hand; this is only about the frame.
				setCursor(!isAnnotating || onEdge(selection, pt, EDGE_GRAB) ? "move" : "default");
				return;
			}
			// Outside a region that already exists: nothing here does anything, and a crosshair would
			// promise that it does. See the matching rule in `onPointerDown`.
			setCursor("not-allowed");
		}
	};

	const onPointerUp = () => {
		// `&& frame` 换掉了原文那个 `initData!` 非空断言：走到 `creating` 就一定有截图，两者
		// 结果一样，只是不必断言。
		if (dragMode.kind === "creating" && selection && frame) {
			if (selection.width < MIN_SELECTION || selection.height < MIN_SELECTION) {
				/*
				 * A press that went nowhere takes the window under it, if there is one.
				 *
				 * The two gestures share a beginning and are told apart by what happened next: drag
				 * and you framed a region by hand, release without moving and you pointed at a
				 * window. With no window there — the desktop, or a display whose windows could not be
				 * read — it stays what it always was, the way to clear a selection.
				 */
				const whole = hoverWindow ? clampRect(hoverWindow, frame.bounds) : null;
				if (whole && whole.width >= MIN_SELECTION && whole.height >= MIN_SELECTION) {
					setSelection(whole);
					setIsAnnotating(true);
				} else {
					setSelection(null);
				}
			} else {
				setIsAnnotating(true);
			}
			setHoverWindow(null);
		}
		setDragMode({ kind: "none" });
	};

	return {
		selection,
		isAnnotating,
		cursor,
		pointer,
		reading,
		copied,
		setCopied,
		hoverWindow,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		reset,
	};
}
