/**
 * 一条横着滚的东西，和它两头那对方向键。
 *
 * `useSideways` 管的是「滚得动」和「看得出还没滚完」；这一层管的是「用鼠标也点得动」。三件事本
 * 来是一件：只有触摸板的人两指一划就走，只有鼠标的人在这里寸步难行——Shift + 滚轮是给知道这个
 * 手势的人准备的，而一对箭头是给所有人准备的。
 *
 * ## 几个当时踩到的点
 *
 * **箭头不占地方。** 绝对定位浮在两端，不进 flex 流：占位置的话，一条本来刚好排得下的标签栏会
 * 因为多了两个按钮而变成排不下——按钮出现，于是更需要按钮。
 *
 * **到头就没有。** 左边到底了左箭头就不画，右边同理。画一个按下去什么也不会发生的按钮，比不画
 * 更难解释；`disabled` 也不行——那是一块灰色的东西占着位置，还是不说明任何事。
 *
 * **和渐隐是同一件事的两面。** 两者读的是同一个「这边还有没有」，所以永远同进同出：有箭头的那
 * 一侧一定是化开的，化开的那一侧一定有箭头。箭头就压在渐隐上，正好是内容淡出的地方。
 *
 * **一次滚八成，不是一整屏。** 整屏翻页会把刚看到的那个也带走，留一点重叠，眼睛才接得上。
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { translate } from "../../i18n/translate.ts";
import { useSideways } from "./useSideways.ts";

/** 一次点按走多远：留两成重叠，让眼睛接得上。 */
const STEP = 0.8;

export function Sideways({
	children,
	className = "",
	outerClassName = "",
	trackRef,
	...rest
}: {
	children: React.ReactNode;
	/** 给真正会滚的那一层——原来写在 `overflow-x-auto` 那个 div 上的类，原样搬过来。 */
	className?: string;
	/**
	 * 给外面那层定位壳。
	 *
	 * 必须有这么一层：箭头要浮在滚动容器上方而不跟着滚，所以定位参照不能是滚动容器自己。
	 * 原来挂在滚动容器上的 `flex-1`、`min-w-0` 这类「我在父级里占多大」的类要挪到这里来。
	 */
	outerClassName?: string;
	/** 需要自己够到滚动容器的地方传进来——比如「把选中的标签滚进视野」。 */
	trackRef?: React.RefObject<HTMLDivElement | null>;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
	const own = useRef<HTMLDivElement>(null);
	const track = trackRef ?? own;
	const { canLeft, canRight } = useSideways(track);
	return (
		<div className={`relative min-w-0 ${outerClassName}`}>
			<div ref={track} className={`ly-fade-tail ${className}`} {...rest}>
				{children}
			</div>
			<SidewaysArrow side="left" shown={canLeft} track={track} />
			<SidewaysArrow side="right" shown={canRight} track={track} />
		</div>
	);
}

/**
 * 单独导出，给那些没法多包一层的地方。
 *
 * 附件条就是：它那一层的负外边距和 `align-self: stretch` 都指望自己是 `.ly-attachments` 的直接
 * 子元素，中间插一个壳，那一排格子就整体错位。那里自己有定位壳，缺的只是这两枚。
 */
export function SidewaysArrow({
	side,
	shown,
	track,
}: {
	side: "left" | "right";
	shown: boolean;
	track: React.RefObject<HTMLElement | null>;
}) {
	const left = side === "left";
	return (
		<button
			type="button"
			aria-label={translate(left ? "sideways.left" : "sideways.right")}
			data-ly-tip={translate(left ? "sideways.left" : "sideways.right")}
			// 到头之后不接受按下，也不接受 Tab 停留——它此刻不是一个控件。
			tabIndex={shown ? 0 : -1}
			aria-hidden={!shown}
			onClick={() => {
				const el = track.current;
				if (!el) return;
				el.scrollBy({ left: (side === "left" ? -1 : 1) * el.clientWidth * STEP, behavior: "smooth" });
			}}
			/*
			 * `pointer-events` 跟着可见性走。
			 *
			 * 淡出只是看不见，不按住这一条的话，那块透明的圆仍然接着点击——一条滚到头的标签栏，最
			 * 边上那个标签会变得点不中，而屏幕上根本没有东西挡在那里。
			 */
			className={`absolute inset-y-0 my-auto grid h-[22px] w-[22px] place-items-center rounded-full border border-line-soft bg-card/85 text-ink-muted shadow-sm backdrop-blur-sm transition-[opacity,transform,background-color] duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink ${
				left ? "left-0.5" : "right-0.5"
			} ${shown ? "scale-100 opacity-100" : `pointer-events-none opacity-0 ${left ? "-translate-x-1" : "translate-x-1"} scale-90`}`}
		>
			{left ? <ChevronLeft size={14} strokeWidth={2.1} /> : <ChevronRight size={14} strokeWidth={2.1} />}
		</button>
	);
}
