import { Activity, useEffect, useLayoutEffect, useRef, useState } from "react";

import { motionReduced } from "../motion/reduced.ts";
import { DURATION, EASING } from "../motion/tokens.ts";

/** Retain a small number of visited pages; hidden pages suspend effects and keep local state. */
export function RetainedViews<T extends string>({
	active,
	render,
	limit = 3,
	pageClassName = "ly-page-enter",
	slide,
}: {
	active: T;
	render: (key: T) => React.ReactNode;
	limit?: number;
	/** Arrival class. Settings uses a longer fade-and-rise than the workspace pages. */
	pageClassName?: string;
	/**
	 * Tabs, in the order a strip shows them: every switch then slides the new page in from the side
	 * it sits on, and fades it up, rather than swapping in one frame.
	 *
	 * Played with the Web Animations API from a layout effect, not from a class. The class version is
	 * what the note above is about — a page coming back from `display: none` painted one frame at its
	 * destination before the animation caught it. A layout effect runs after the page is shown and
	 * before anything is painted, so the first frame anyone sees is already the first frame of the
	 * slide. Returning to a page plays it too: a tab strip is somewhere you go back and forth, and a
	 * switch that only animates the first time reads as broken the second.
	 */
	slide?: readonly T[];
}) {
	const [recent, setRecent] = useState<T[]>([active]);
	/*
	 * 这一页是头一回露面，还是回来了。
	 *
	 * `Activity` 收起一页用的是 `display: none`，内容、滚动位置、局部状态全留着。所以回到一个
	 * 看过的章节，它本来就在那里——该做的是恢复，不是重演一遍进场。从前不分，于是回去时内容先
	 * 画在终点、下一帧被拽回起点再滑回来，逐帧量是 44 → 50 → 44，一次掉头，人眼看见的就是「内容
	 * 跳了一下」。
	 *
	 * 在 effect 里记，不在 render 里记：render 期间写这个 ref，严格模式的第二遍就会把「头一回」
	 * 吃掉，动画一次也播不出来。
	 */
	const seen = useRef<Set<T>>(new Set([active]));
	const fresh = !seen.current.has(active);
	useEffect(() => {
		seen.current.add(active);
	}, [active]);
	const pages = useRef(new Map<T, HTMLDivElement>());
	const previous = useRef(active);
	useLayoutEffect(() => {
		const from = previous.current;
		previous.current = active;
		if (!slide || from === active || motionReduced()) return;
		const page = pages.current.get(active);
		if (!page) return;
		// From the side the new tab is on: moving right along the strip, the page arrives from the right.
		const direction = Math.sign(slide.indexOf(active) - slide.indexOf(from)) || 1;
		page.animate(
			[
				{ opacity: 0, transform: `translateX(${direction * 14}px)` },
				{ opacity: 1, transform: "none" },
			],
			{ duration: DURATION.base, easing: EASING.out },
		);
	}, [active, slide]);
	let keys = recent;
	if (recent[recent.length - 1] !== active) {
		keys = [...recent.filter((key) => key !== active), active].slice(-limit);
		setRecent(keys);
	}
	const shown = [active, ...keys.filter((key) => key !== active)];
	return <>{shown.map((key) => (
		<Activity key={key} mode={key === active ? "visible" : "hidden"}>
			<div
				ref={(node) => {
					if (node) pages.current.set(key, node);
					else pages.current.delete(key);
				}}
				className={`${pageClassName} flex min-h-0 min-w-0 flex-1 flex-col`}
				data-view={key}
				data-active={key === active ? "true" : "false"}
				data-fresh={key === active && fresh ? "true" : "false"}
			>
				{render(key)}
			</div>
		</Activity>
	))}</>;
}
