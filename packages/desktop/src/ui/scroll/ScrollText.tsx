import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Space between the two copies, so the text does not run into its own repeat. */
const GAP = 44;
/** Pixels per second. Slow enough to read a long path without chasing it. */
const SPEED = 46;

/**
 * One line of text that fades out at the edge instead of ending in an ellipsis, and reads
 * itself out when the row it sits in is hovered.
 *
 * An ellipsis reports that the title was cut without saying what was cut — every session that
 * opens with "帮我梳理这个项目的整体架构" collapses into the same unusable row. The fade says
 * the same thing more quietly, and the hover scroll actually answers the question.
 *
 * The scroll runs one way, continuously. It used to sweep left and right, which reads as the
 * row twitching rather than as text being read: your eye keeps having to reacquire the start.
 * A second, hidden copy trailing the first is what makes a single direction loop seamlessly —
 * by the time the original has left, the copy is exactly where it began.
 *
 * Nothing animates unless the text really is unreadable: a row that already fits must not twitch
 * when the pointer crosses it. The parent row carries `ly-scroll`, which is what the hover
 * rules in styles.css key off.
 */
export function ScrollText({ text, className = "" }: { text: ReactNode; className?: string }) {
	const box = useRef<HTMLSpanElement>(null);
	const body = useRef<HTMLSpanElement>(null);
	/** 越出盒子的那一截，和悬停时读不到的那一截——后者把控件占掉的宽度也算进去。 */
	const [over, setOver] = useState(0);
	const [hidden, setHidden] = useState(0);
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const outer = box.current;
		const inner = body.current;
		if (!outer || !inner) return;

		/*
		 * Sub-pixel differences are noise — a fitting row must not claim 0.4px of overflow and
		 * animate for it. The dead band matters as much as the rounding: a measurement that
		 * oscillates by a pixel would re-render on every observer callback forever.
		 */
		const measure = () => {
			// Overflow compares layout sizes, not the transient scale of a moving dock pane.
			const part = inner.offsetWidth;
			const room = outer.clientWidth;
			/*
			 * 悬停时会有控件落在这一行最后的一段上，那段宽度写在 `--ly-row-controls` 上。
			 *
			 * 装不装得下要分两次问，而从前只问了一次。「比盒子宽」只管得住静止的样子；悬停一来，
			 * 图钉和归档压在标题最后那 47px 上，遮罩把那一段整个抹平——于是一个 13 个字、盒子明明
			 * 装得下的标题，鼠标一放上去就少掉最后一个字，而且是一刀切的，因为不滚的行没有
			 * `ly-fade-edge`，右边那道渐隐的深度是 0。
			 *
			 * 读不到就是装不下，跟是谁挡的没关系。所以这里问的是「悬停之后还剩多少地方」，控件占掉的
			 * 算进去；答案是「不够」，这一行就该跟长标题走同一条路：化开，并且悬停时自己读出来。
			 *
			 * 列表之外的用法读不到这个变量（没有人写），于是 reserve 是 0，判定和从前一模一样。
			 */
			const reserve = Number.parseFloat(getComputedStyle(outer).getPropertyValue("--ly-row-controls")) || 0;
			const spill = Math.max(0, part - room);
			const unread = Math.max(0, part - (room - reserve));
			setWidth((prev) => (Math.abs(part - prev) > 1 ? part : prev));
			setOver((prev) => (Math.abs(spill - prev) > 1 ? spill : prev));
			setHidden((prev) => (Math.abs(unread - prev) > 1 ? unread : prev));
		};
		measure();

		/*
		 * 内容变了也靠这个观察器，不再靠 effect 的依赖。
		 *
		 * 从前依赖 `[text]`，于是每收到一个字就把观察器拆了重建一次；而 `text` 一旦可以是节点而不
		 * 只是字符串，每次渲染都是一个新对象，那就成了每帧重建。文字变了、宽度跟着变，观察 inner
		 * 的这只手本来就会报——宽度没变的改动也确实不需要重测。
		 *
		 * 侧边栏改宽度（抽屉/推开）和网页字体落地时的重排，同样从这里来。
		 */
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		observer.observe(inner);
		return () => observer.disconnect();
	}, []);

	/** 悬停时读不全就滚：被控件盖住和越出盒子，对读的人是同一件事。 */
	const scrolls = hidden > 1;
	/** 静止时就装不下的那一种，右边那道虚化要常驻——它说的是「后面还有」。 */
	const clipped = over > 1;
	// One full cycle carries the first copy off the left, leaving the second exactly where the
	// first began. Constant speed rather than constant duration, so a slightly-too-long title
	// does not crawl while a very long one races.
	const distance = width + GAP;
	const duration = Math.max(2200, Math.round((distance / SPEED) * 1000));

	return (
		<span
			ref={box}
			/*
			 * 两种「装不下」分开说，因为它们化开的时机不同。
			 *
			 * `over` 静止时就该虚化；`yield` 静止时一点事没有，只有控件压上来的那一刻才需要让位。
			 * 给 yield 的行也常驻一道虚化，等于把一个本来完整的标题平白抹淡——那是另一个方向的同一个错。
			 */
			data-ly-scroll-fit={scrolls ? (clipped ? "over" : "yield") : undefined}
			className={`block overflow-hidden whitespace-nowrap ${scrolls ? "ly-fade-edge" : ""} ${className}`}
			style={
				scrolls
					? ({ "--ly-marquee": `-${distance}px`, "--ly-scroll": `${duration}ms` } as React.CSSProperties)
					: undefined
			}
		>
			<span className={scrolls ? "ly-marquee-track ly-scroll-text-track" : "inline-block"}>
				<span ref={body} className="inline-block">
					{text}
				</span>
				{/* The duplicate must not change the flex basis and feed back into overflow measurement. */}
				{scrolls && (
					<span
						aria-hidden
						data-ly-scroll-dup
						className="absolute top-0 inline-block invisible"
						style={{ left: width + GAP }}
					>
						{text}
					</span>
				)}
			</span>
		</span>
	);
}
