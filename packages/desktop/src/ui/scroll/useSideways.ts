/**
 * 一条横着滚的东西，怎么让人滚得动、以及怎么说明它还没滚完。
 *
 * 两件事一直缺，而且缺在每一个横向容器上——标签栏、附件条、宽表格。
 *
 * **滚得动。** 横向滚动在这个应用里此前只有触摸板能做：两指一划。用鼠标的人手上只有一个垂直
 * 滚轮，而垂直滚轮在一个只能横着滚的容器上什么也不做——内容明明溢出了，滚轮转起来毫无反应，看
 * 起来就像卡住了。Shift + 滚轮是这件事在别处的通用手势，这里把它接上。
 *
 * 只接管按住 Shift 的那一下，不碰光秃秃的垂直滚轮。后者要留给上层：附件条就躺在输入框里，输入
 * 框躺在转录区里，吃掉它等于让人滚不动这一整页。
 *
 * **说明还没滚完。** 两端各一道渐隐，按滚动位置来：左边滚出去了左边才有，右边还有货右边才有。
 * 硬边缘和「刚好排满」长得一模一样，而它们的意思相反——一个是「右边还有三个标签」，另一个是
 * 「就这些了」。`ly-fade-tail` 那张遮罩早就在，只是 `--ly-fade-left/right` 从来没人喂过值，于是
 * 三个标签栏都挂着一张全不透明的遮罩，等于没有。
 *
 * 量的是滚动条自己的三个数，不是鼠标做了什么：内容变了、窗口宽了、程序改了 `scrollLeft`，渐隐
 * 都得跟着变，而这些一个都不经过滚轮。
 */

import { useEffect, useState } from "react";

/** 渐隐多深。够看出「那边还有」，又不至于把一整个标签吃掉半个。 */
const FADE = 20;

/** 两头各自还有没有东西。渐隐和方向键读的是同一份，所以永远同进同出。 */
export interface SidewaysEdges {
	canLeft: boolean;
	canRight: boolean;
}

export function useSideways(ref: React.RefObject<HTMLElement | null>): SidewaysEdges {
	const [edges, setEdges] = useState<SidewaysEdges>({ canLeft: false, canRight: false });

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const paint = () => {
			const max = el.scrollWidth - el.clientWidth;
			// 1px 的容差：缩放和小数宽度下，滚到底的 scrollLeft 常常差那么一点点。
			const left = max > 1 ? Math.min(FADE, el.scrollLeft) : 0;
			const right = max > 1 ? Math.min(FADE, max - el.scrollLeft) : 0;
			el.style.setProperty("--ly-fade-left", `${Math.max(0, Math.round(left))}px`);
			el.style.setProperty("--ly-fade-right", `${Math.max(0, Math.round(right))}px`);
			/*
			 * 按 1px 判定「还有没有」，不按渐隐那 20px。
			 *
			 * 两者问的是同一件事而答案的精度不同：还剩 3px 的时候渐隐已经收到 3px 了，但那一侧确实
			 * 还有东西没露出来，箭头就该在。用 `FADE` 当门槛的话，最后那几像素会既没有渐隐提示、
			 * 也没有箭头可按，而它明明还能滚。
			 */
			setEdges((was) => {
				const next = { canLeft: el.scrollLeft > 1, canRight: max - el.scrollLeft > 1 };
				return was.canLeft === next.canLeft && was.canRight === next.canRight ? was : next;
			});
		};

		const onWheel = (event: WheelEvent) => {
			if (!event.shiftKey) return;
			/*
			 * 有些设备自己就把 Shift + 滚轮报成横向了（macOS 的鼠标、部分驱动），那一下 `deltaX`
			 * 非零——再加一次就是滚两倍。让给浏览器。
			 */
			if (event.deltaX !== 0) return;
			if (el.scrollWidth <= el.clientWidth) return;
			event.preventDefault();
			el.scrollLeft += event.deltaY;
		};

		// `passive: false`，否则 `preventDefault` 会被忽略：滚轮默认是被动的。
		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("scroll", paint, { passive: true });
		/* 内容和尺寸都能改变「还剩多少」，而两者都不经过滚动事件。 */
		const observer = new ResizeObserver(paint);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		const mutations = new MutationObserver(() => {
			for (const child of el.children) observer.observe(child);
			paint();
		});
		mutations.observe(el, { childList: true });
		paint();

		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("scroll", paint);
			observer.disconnect();
			mutations.disconnect();
		};
	}, [ref]);

	return edges;
}
