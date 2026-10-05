/**
 * 展开显示和收起时，列表高度过渡到新高度，而不是行一下子冒出来或消失。
 *
 * 展开：按下时量一次高度，新行挂上之后再量一次，两者之间用 Web Animations 过渡，新行从上往下被露出来。
 * 收起：行不能先卸——卸了就没有内容可以收。所以先把高度收到第 `keep` 行的下沿，播完再真正收起。
 * 两种都只由按下触发，新建会话、搜索过滤这类行数变化照旧直接出现。
 *
 * `ref` 只包住行，不包「展开显示」按钮：按钮在外面才能贴着下沿一起走，包在里面会在动画期间被裁掉。
 * 动画期间用 `overflow: clip` 而不是 `hidden`，理由见 `Collapsible`：`hidden` 会截断里面的吸顶标题。
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { DURATION, EASING } from "../../ui/motion/tokens.ts";

export function useUnfold(ref: RefObject<HTMLElement | null>) {
	const from = useRef<number | null>(null);
	const running = useRef<{ el: HTMLElement; animation: Animation } | null>(null);

	// 停掉正在播的一段（不触发它结束时的收起），高度回到内容自己的高度。
	const stop = () => {
		const current = running.current;
		if (!current) return;
		running.current = null;
		current.animation.cancel();
		current.el.style.overflow = "";
	};

	const play = (el: HTMLElement, start: number, end: number, done?: () => void) => {
		el.style.overflow = "clip";
		// 停在终点，直到收起真正提交：否则播完到提交之间会有一帧回到全部行的高度。
		const animation = el.animate([{ height: `${start}px` }, { height: `${end}px` }], {
			duration: DURATION.slow,
			easing: EASING.out,
			fill: "forwards",
		});
		running.current = { el, animation };
		animation.onfinish = () => {
			if (running.current?.animation !== animation) return;
			if (done) flushSync(done);
			stop();
		};
	};

	useLayoutEffect(() => {
		const el = ref.current;
		const start = from.current;
		from.current = null;
		if (!el || start === null) return;

		// 连按时上一段还在播：起点已经按播放中的高度量好，先停掉它，量到的才是真正的终点。
		stop();
		const end = el.offsetHeight;
		if (end > start) play(el, start, end);
	});

	return {
		/** 包住「展开显示」的回调：先记下当前高度，再让列表变长。 */
		unfold: (reveal: () => void) => () => {
			from.current = motionReduced() ? null : (ref.current?.offsetHeight ?? null);
			reveal();
		},
		/** 包住「收起」的回调：先收到只剩前 `keep` 行的高度，播完再收起。 */
		fold: (keep: number, collapse: () => void) => () => {
			const el = ref.current;
			const last = el?.querySelectorAll<HTMLElement>("[data-ly-row]")[keep - 1];
			if (!el || !last || motionReduced()) {
				stop();
				collapse();
				return;
			}
			const start = el.offsetHeight;
			stop();
			const end = last.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
			if (end < start) play(el, start, end, collapse);
			else collapse();
		},
	};
}
