import { Activity, useEffect, useRef, useState } from "react";

/** Retain a small number of visited pages; hidden pages suspend effects and keep local state. */
export function RetainedViews<T extends string>({
	active,
	render,
	limit = 3,
	pageClassName = "ly-page-enter",
}: {
	active: T;
	render: (key: T) => React.ReactNode;
	limit?: number;
	/** Arrival class. Settings uses a longer fade-and-rise than the workspace pages. */
	pageClassName?: string;
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
	let keys = recent;
	if (recent[recent.length - 1] !== active) {
		keys = [...recent.filter((key) => key !== active), active].slice(-limit);
		setRecent(keys);
	}
	const shown = [active, ...keys.filter((key) => key !== active)];
	return <>{shown.map((key) => (
		<Activity key={key} mode={key === active ? "visible" : "hidden"}>
			<div
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
