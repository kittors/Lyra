import { useCallback, useLayoutEffect, useState } from "react";

/**
 * 一个装不下字的输入框，两头化开。
 *
 * 只做一件事：把「上面藏了多少」「下面还剩多少」写成两个长度，交给 `.ly-field-fade` 的遮罩去画
 * （见 `styles/fields.css`）。深浅不是常数——`min(一行, 已经滚过去多少)`——所以刚推开几个像素时
 * 虚化也只有几个像素，跟着手走；推满一行之后就停在一行，再深就开始吃正在读的那一行了。
 *
 * 写在外壳上，不写在 textarea 上。两个变量是可继承的（这是它们和 `--ly-fade-top` 那一族唯一的
 * 差别），而主输入框的字有两层：textarea 和铺在它上面画标记的镜像层。写一处、两层继承，虚化才
 * 不会一层淡了另一层没淡；各写各的，总有一天会漏掉后加的那一层。
 */

/**
 * 一行，但在矮框里还要再收一收。
 *
 * 一行是化开的自然单位：被切掉的正是那一行，让它淡出去就够了，更深就开始吃还在读的下一行，更浅
 * 则看不出是渐隐还是没对齐。
 *
 * 不超过可视高度的五分之一，是因为「一行」在不同的框里份量差很远：主输入框十几行，淡掉一行是
 * 边缘；提交信息框只有三行，上下各淡一行就是一半内容在雾里。`scrollFade` 给短面板留的是同一条
 * 线，同一个理由——中间那几行得能读。
 */
function depthOf(el: HTMLElement): number {
	const line = Number.parseFloat(getComputedStyle(el).lineHeight);
	const row = Number.isFinite(line) ? Math.min(32, Math.max(16, line)) : 20;
	return Math.min(row, el.clientHeight / 5);
}

export function useFieldFade(
	field: React.RefObject<HTMLElement | null>,
	host: React.RefObject<HTMLElement | null>,
): void {
	/*
	 * 被量的那个元素放进 state，理由和 `OverlayScrollbar` 那边一样：参数是 ref，而 ref 改指向
	 * 不惊动任何人——换一次挂载点，监听就全留在上一个已经没人看的元素上。每次渲染之后对一次，
	 * 值没变 React 直接跳过。
	 */
	const [element, setElement] = useState<HTMLElement | null>(null);
	// oxlint-disable-next-line react-hooks/exhaustive-deps
	useLayoutEffect(() => setElement(field.current));

	const sync = useCallback(() => {
		const el = field.current;
		const box = host.current;
		if (!el || !box) return;
		const hidden = el.scrollHeight - el.clientHeight;
		/*
		 * 一屏装得下就两头都不画。`<= 1` 而不是 `<= 0`：子像素的高度差在缩放不是整数倍的屏上到
		 * 处都是，一个 0.5px 的「溢出」会让一个根本没滚的框顶上挂着半像素的渐隐。
		 */
		if (hidden <= 1) {
			box.style.setProperty("--ly-field-fade-top", "0px");
			box.style.setProperty("--ly-field-fade-bottom", "0px");
			return;
		}
		const depth = depthOf(el);
		const above = Math.max(0, Math.min(depth, el.scrollTop));
		const below = Math.max(0, Math.min(depth, hidden - el.scrollTop));
		box.style.setProperty("--ly-field-fade-top", `${above.toFixed(1)}px`);
		box.style.setProperty("--ly-field-fade-bottom", `${below.toFixed(1)}px`);
	}, [field, host]);

	/*
	 * 每次渲染之后也对一次，没有依赖数组。
	 *
	 * 滚动事件管不到这两件事：打了一个字，内容高了；框自适应长高了一行，可滚的量变了。两者都不
	 * 是滚动，而两者都会改变「上面藏了多少」。`sync` 只写两个 style 变量，同一个数写第二遍不会
	 * 再引起渲染，所以这里不会连环。
	 */
	// oxlint-disable-next-line react-hooks/exhaustive-deps
	useLayoutEffect(sync);

	useLayoutEffect(() => {
		if (!element) return;
		element.addEventListener("scroll", sync, { passive: true });
		const observer = new ResizeObserver(sync);
		observer.observe(element);
		return () => {
			element.removeEventListener("scroll", sync);
			observer.disconnect();
		};
	}, [element, sync]);
}
