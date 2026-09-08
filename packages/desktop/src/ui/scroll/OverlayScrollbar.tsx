import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A scrollbar for a surface the app does not own the markup of.
 *
 * `Scroller` covers everything the app renders itself. This is for the two places it cannot
 * reach — CodeMirror's scroller and the diff's — where the element scrolls but its DOM belongs
 * to something else. Given a ref to that element, this draws the same thumb over it.
 *
 * Native bars are not an option here. They are hidden globally so that every surface goes
 * through `Scroller`, and re-enabling them per element does not give the same control back: on
 * macOS an overlay scrollbar ignores `::-webkit-scrollbar` styling entirely and appears only
 * while the wheel is turning, so a still pane looks like it has no scrollbar at all — which is
 * exactly how the editor read. Drawn here it follows the app's own rules, and never takes a
 * pixel of width from the content.
 *
 * The two directions are deliberately not shown the same way, matching the diff's reasoning:
 * vertical overflow announces itself, because the content is visibly cut off at the bottom edge,
 * so a thumb on hover is enough. A line that runs off to the right looks exactly like a line
 * that ended there, and nothing moves to say otherwise — so that one stays visible.
 *
 * Not shared with the diff's own sideways thumb, which needs `sticky` rather than `absolute`:
 * that one sits inside a much taller vertical scroller, where a bar pinned to the bottom of the
 * content would only come into view after you had scrolled past everything it was meant to help
 * with. Here the element being scrolled *is* the pane, so its bottom edge is the right place.
 */
/** 轨道的厚度，也是两条轨道交汇时彼此让开的距离。 */
const THICKNESS = 10;

export function OverlayScrollbar({
	viewport,
	orientation,
}: {
	viewport: React.RefObject<HTMLElement | null>;
	orientation: "vertical" | "horizontal";
}) {
	const vertical = orientation === "vertical";
	const track = useRef<HTMLDivElement>(null);
	const drag = useRef<{ start: number; from: number } | null>(null);
	const [metrics, setMetrics] = useState({ offset: 0, size: 0, overflow: false, inset: 0 });
	const [active, setActive] = useState(false);

	/*
	 * 正在被量的那个元素，放进 state。
	 *
	 * 参数是一个 ref，而 ref 改指向不惊动任何人——这是这个组件最难看出来的一处毛病。编辑器每打开
	 * 一个文件就把 CodeMirror 整个重建一次，`ref.current` 指向新的 `.cm-scroller`；这个组件既没
	 * 卸载也没有重新跑 effect，于是 scroll 监听和两个 observer 全留在上一个、已经被 destroy 的
	 * 元素上，再没有人叫它量第二次。看到的就是：换过一次文件之后滑块不再跟着内容走，停在上一个文
	 * 件留下的位置——内容明明在第 120 行，滑块还贴在顶端。
	 *
	 * 每次渲染之后对一次。值没变时 `setState` 会被 React 直接跳过，不会多渲染一轮；变了才重新
	 * 绑，而「变了」正是那次没人发现的更换。
	 */
	const [element, setElement] = useState<HTMLElement | null>(null);
	/*
	 * 没有依赖数组是有意的：要盯的正是 ref 在两次渲染之间悄悄换掉的那一刻，而那件事不出现在任何
	 * 依赖里。相同的值 React 会直接跳过，连环更新不会发生。
	 */
	// oxlint-disable-next-line react-hooks/exhaustive-deps
	useLayoutEffect(() => setElement(viewport.current));

	const measure = useCallback(() => {
		const el = element;
		if (!el) return;
		const length = vertical ? el.clientHeight : el.clientWidth;
		const total = vertical ? el.scrollHeight : el.scrollWidth;
		const at = vertical ? el.scrollTop : el.scrollLeft;

		const overflow = total - length > 1;
		/*
		 * 角落归谁。
		 *
		 * 两条轨道各自铺满一整条边，于是右下角那 10×10 是重叠的，而横的那条在 DOM 里靠后、层级
		 * 相同，压在竖的上面。结果是竖滑块走到最后 10px 时鼠标被横轨道接走——按得到、拖不动，
		 * 看着就是「拖不到底」。横滑块到最右也是同一回事。
		 *
		 * 谁在那儿就给谁让开：另一条存在时，这一条短 10px，角落空出来，两个滑块各自都能走到自己
		 * 的尽头。行程也跟着按让开之后的长度算，否则滑块会从轨道末端探出去。
		 */
		const crossTotal = vertical ? el.scrollWidth : el.scrollHeight;
		const crossLength = vertical ? el.clientWidth : el.clientHeight;
		const inset = crossTotal - crossLength > 1 ? THICKNESS : 0;
		const rail = Math.max(0, length - inset);

		// Below about 28px a thumb is impossible to grab; it stops tracking exactly once the
		// content is very long, which is a fair trade for staying usable.
		const size = overflow ? Math.min(rail, Math.max(28, (length / total) * rail)) : 0;
		const travel = rail - size;
		const progress = total - length <= 0 ? 0 : at / (total - length);
		setMetrics({ offset: travel * progress, size, overflow, inset });
	}, [vertical, element]);

	useLayoutEffect(() => {
		const el = element;
		if (!el) return;
		measure();
		el.addEventListener("scroll", measure, { passive: true });

		// Both are needed: the box changes when the pane resizes, the content when a file is
		// edited or a grammar finishes loading and reflows it.
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		const mutations = new MutationObserver(measure);
		mutations.observe(el, { childList: true, subtree: true, characterData: true });

		return () => {
			el.removeEventListener("scroll", measure);
			observer.disconnect();
			mutations.disconnect();
		};
	}, [measure, element]);

	// Dragging continues outside the thumb, so the listeners live on the window.
	useEffect(() => {
		if (!active) return;
		const onMove = (event: MouseEvent) => {
			const el = element;
			const state = drag.current;
			if (!el || !state) return;
			const length = vertical ? el.clientHeight : el.clientWidth;
			const total = vertical ? el.scrollHeight : el.scrollWidth;
			const travel = Math.max(0, length - metrics.inset) - metrics.size;
			if (travel <= 0) return;
			const ratio = ((vertical ? event.clientY : event.clientX) - state.start) / travel;
			const next = state.from + ratio * (total - length);
			if (vertical) el.scrollTop = next;
			else el.scrollLeft = next;
		};
		const onUp = () => {
			drag.current = null;
			setActive(false);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [active, metrics.size, metrics.inset, vertical, element]);

	if (!metrics.overflow) return null;

	return (
		<div
			ref={track}
			// 末端让开另一条轨道占的那 10px——见 `measure` 里的「角落归谁」。
			style={vertical ? { bottom: metrics.inset } : { right: metrics.inset }}
			className={`pointer-events-auto absolute z-[3] ${vertical ? "top-0 right-0 w-[10px]" : "bottom-0 left-0 h-[10px]"}`}
			onMouseDown={(event) => {
				// Clicking the track jumps to that spot, then hands over to the drag.
				if (event.target !== track.current) return;
				const el = element;
				if (!el || !track.current) return;
				const rect = track.current.getBoundingClientRect();
				const length = vertical ? el.clientHeight : el.clientWidth;
				const total = vertical ? el.scrollHeight : el.scrollWidth;
				const travel = Math.max(0, length - metrics.inset) - metrics.size;
				const from = vertical ? event.clientY - rect.top : event.clientX - rect.left;
				const ratio = (from - metrics.size / 2) / Math.max(1, travel);
				const next = Math.min(1, Math.max(0, ratio)) * (total - length);
				if (vertical) el.scrollTop = next;
				else el.scrollLeft = next;
			}}
		>
			{/*
			 * Hidden from assistive technology on purpose.
			 *
			 * The thing that actually scrolls is the viewport underneath, and that is what a screen
			 * reader should be driving. Declaring `role="scrollbar"` here without a value announces
			 * a control that reports nothing — worse than not being there at all.
			 */}
			<div
				aria-hidden
				tabIndex={-1}
				onMouseDown={(event) => {
					event.preventDefault();
					const el = element;
					if (!el) return;
					drag.current = {
						start: vertical ? event.clientY : event.clientX,
						from: vertical ? el.scrollTop : el.scrollLeft,
					};
					setActive(true);
				}}
				style={
					vertical
						? { top: metrics.offset, height: metrics.size }
						: { left: metrics.offset, width: metrics.size }
				}
				className={`absolute rounded-full bg-ink-faint ${
					vertical
						? `ly-thumb right-[2px] w-[6px] ${active ? "ly-thumb-active" : ""}`
						: `ly-hthumb bottom-[2px] h-[6px] ${active ? "ly-hthumb-active" : ""}`
				}`}
			/>
		</div>
	);
}
