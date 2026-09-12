/**
 * 截图工具条画在哪，以及被拖到哪。
 *
 * 从 `ScreenshotOverlay.tsx` 拆出来的。那个组件有 17 个 `useState`，这五个（两个 state、两个
 * ref、一个派生位置）只服务一件事，彼此之间的来往比它们和别处的来往多得多——所以它们是一组，而
 * 剩下那个组件里再也看不到「工具条现在多宽」这种东西。
 *
 * 对外只有五样：画在哪、正在拖吗、怎么量、怎么开始拖、怎么归位。工具条自己的尺寸、手动位置、
 * 那个 `ResizeObserver`，调用方一个都不需要知道。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { clampToolbar, toolbarPosition, type Point, type Rect } from "./screenshot-geometry.ts";

/**
 * A first guess at the bar's size, replaced by a measurement after the first paint.
 *
 * Only used to place it before it exists. It is deliberately close to the truth — the bar is now
 * 48pt tall and about 800 wide with the two extra actions on it — because being wrong here puts the
 * bar in the wrong place for one frame, and the eye is already following the pointer that just
 * released the selection.
 */
const TOOLBAR_SIZE = { width: 800, height: 48 };

/**
 * How tall the size-and-colour bubble is, including the gap above it.
 *
 * A constant rather than a measurement: it is only needed to decide which side of the region the
 * toolbar goes on, that decision has to be made before the bubble exists, and the bubble is one
 * row of controls in a padded box — a number that changes only if that row is redesigned.
 *
 * 48 rather than the 34 it was: the capture bar uses the `large` metrics, whose bubble is a row of
 * 28pt controls with 6pt of padding, plus the 8pt gap that separates it from the bar.
 */
const PROPERTIES_HEIGHT = 48;

/** 工具条最终落在哪，以及气泡该往哪一边开。只有下面那个接口用，所以不导出。 */
type ToolbarAt = (Point & { side: "above" | "below" | "over" }) | null;

export interface ToolbarPlacement {
	/** 画在哪。`null` 表示还没有选区，也就没有工具条。 */
	at: ToolbarAt;
	/** 正在被拖动——调用方拿它改光标。 */
	dragging: boolean;
	/** 挂在工具条那个元素上的 ref 回调。 */
	measure: (el: HTMLDivElement | null) => void;
	/** 按住把手时调用，带上按下的点和当时工具条的位置。 */
	startDrag: (grab: { from: Point; origin: Point }) => void;
	/** 新一轮截图开始时调用：忘掉用户上一轮把它拖到了哪。 */
	reset: () => void;
}

/**
 * `bounds` 可以是 null。
 *
 * 组件在拿到第一帧数据之前就早返回了，而 hook 必须在那之前调用——所以这里收一个可能还不存在的
 * 屏幕尺寸。它为 null 时 `selection` 必然也是 null（没有截图就没有选区），下面那两处算位置的
 * 地方都走不到。
 */
export function useToolbarPlacement(
	selection: Rect | null,
	bounds: { width: number; height: number } | null,
): ToolbarPlacement {
	/**
	 * Where the user has put the toolbar, if they have moved it.
	 *
	 * Null means "wherever `toolbarPosition` says", which is the ordinary case and the good default:
	 * the bar follows the region and ends up under the hand that drew it. This exists for when that
	 * default is wrong — the bar lands on top of the very thing being annotated, which happens for a
	 * region near the bottom of the screen, or over the part of the picture a caption is going on.
	 *
	 * In overlay coordinates, i.e. the same space as the selection.
	 */
	const [manualAt, setManualAt] = useState<Point | null>(null);
	const [dragging, setDragging] = useState(false);
	/** The press that started the current toolbar drag, and where the bar was when it did. */
	const drag = useRef<{ from: Point; origin: Point } | null>(null);

	/** The toolbar's measured size, so it is kept on screen against what it really is. */
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	const observer = useRef<ResizeObserver | null>(null);

	/*
	 * Watched, not measured once.
	 *
	 * This was a bare ref callback, which runs when the element mounts and never again — so the
	 * width it recorded was the width of the bar *as it first appeared*. The bar does not keep that
	 * width: select a shape and 「删除选中」 joins the row, and a tool with a properties bubble adds
	 * its own controls. Every rule that keeps the bar on screen is computed against this number, so
	 * a stale one disables all of them at once — `toolbarPosition` clamps the right edge against a
	 * bar narrower than the one being drawn, and the real one hangs off the screen.
	 *
	 * Which is why the report was 「依然存在」: the placement arithmetic had been fixed, and it was
	 * being fed a measurement that stopped updating.
	 */
	const measure = useCallback((el: HTMLDivElement | null) => {
		observer.current?.disconnect();
		observer.current = null;
		if (!el) return;
		const read = () => {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height) return;
			setSize((was) =>
				was && Math.abs(was.width - r.width) < 1 && Math.abs(was.height - r.height) < 1
					? was
					: { width: Math.ceil(r.width), height: Math.ceil(r.height) },
			);
		};
		read();
		observer.current = new ResizeObserver(read);
		observer.current.observe(el);
	}, []);

	// 卸载时把观察者断掉。原来这件事挂在组件那个「拆掉一切」的 effect 里，跟着状态一起搬过来。
	useEffect(() => () => observer.current?.disconnect(), []);

	const startDrag = useCallback((grab: { from: Point; origin: Point }) => {
		drag.current = grab;
		setDragging(true);
	}, []);

	/*
	 * 三样都要清，不是只清位置。
	 *
	 * 拆出来的第一版只写了 `setManualAt(null)`——漏了 `dragging` 和那个 ref。后果是：一次截图在
	 * 工具条被拖着的时候结束（按 Esc，或者别的关闭路径先到），`dragging` 留着 true 进入下一轮，
	 * 于是新一轮开场时光标是 grabbing，而且下面那个 effect 立刻挂上 window 的 pointermove——鼠标
	 * 一动工具条就跟着走，用户根本没按下去。
	 *
	 * 这和 `electron/screenshot.ts` 里那个漏放 Escape 的分支是同一种错：状态分散着清，漏一个没有
	 * 任何东西会说。
	 */
	const reset = useCallback(() => {
		setManualAt(null);
		setDragging(false);
		drag.current = null;
	}, []);

	/*
	 * The rest of the drag, on the window rather than on the handle.
	 *
	 * A pointer moving fast leaves a 20pt grip behind between two events, and a capture on the
	 * element would have to be released on a page that is about to be torn down and rebuilt for the
	 * next capture. Listening on the window for as long as the drag lasts has neither problem.
	 */
	useEffect(() => {
		if (!dragging) return;
		const measured = size ?? TOOLBAR_SIZE;
		const move = (event: PointerEvent) => {
			const at = drag.current;
			if (!at) return;
			// Kept on screen, with room above it for the properties bubble. See `clampToolbar`.
			setManualAt(
				clampToolbar(
					{ x: at.origin.x + event.clientX - at.from.x, y: at.origin.y + event.clientY - at.from.y },
					measured,
					{ width: window.innerWidth, height: window.innerHeight },
					PROPERTIES_HEIGHT,
				),
			);
		};
		const end = () => {
			drag.current = null;
			setDragging(false);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
		};
	}, [dragging, size]);

	/*
	 * The bubble counts towards the placement, whether or not one is open right now.
	 *
	 * Measuring only the open one would make the bar jump the moment a tool with properties was
	 * chosen — the placement would change under the pointer that just chose it. Reserving the room
	 * unconditionally costs a few pixels of gap in the rare case nothing opens, and keeps the bar
	 * still.
	 */
	const placed =
		selection && bounds
			? toolbarPosition(selection, bounds, { ...TOOLBAR_SIZE, ...size }, { height: PROPERTIES_HEIGHT })
			: null;

	/*
	 * Where the user put it, if they moved it; otherwise where it belongs.
	 *
	 * The automatic placement is right nearly always — the bar follows the region and lands under the
	 * hand that drew it — and wrong in the case it cannot see: the bar is over the part of the
	 * picture that is about to be annotated, or over a second window the user is comparing against.
	 * There is no rule that fixes that, because the thing it must not cover is not on the screen the
	 * overlay can measure. So it is draggable, and a bar that has been dragged stops following.
	 *
	 * The side is still derived rather than kept, because the bubble must open away from the edge it
	 * is nearest: dragged to the top of the screen, a bubble opening upwards would be off it.
	 *
	 * A bar that was moved by hand is still not allowed off the screen. `clampToolbar` used to run
	 * only while the pointer was down, which kept the drag itself honest and then stopped caring.
	 * The bar changes width after the drag — 「删除选中」 appears the moment a shape is selected —
	 * and the position it was left at was reapplied unchanged, so the extra width went straight off
	 * the right edge. Clamped here instead, against the size measured now, so it holds for every
	 * later change and not just for the gesture that placed it.
	 */
	const manual =
		manualAt && bounds ? clampToolbar(manualAt, { ...TOOLBAR_SIZE, ...size }, bounds, PROPERTIES_HEIGHT) : null;
	const at: ToolbarAt = manual ? { ...manual, side: manual.y >= PROPERTIES_HEIGHT ? "above" : "below" } : placed;

	return { at, dragging, measure, startDrag, reset };
}
