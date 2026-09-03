import { useLayoutEffect, useRef, useState } from "react";

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
 * Nothing animates unless the text really overflows: a row that already fits must not twitch
 * when the pointer crosses it. The parent row carries `ly-scroll`, which is what the hover
 * rules in styles.css key off.
 */
export function ScrollText({ text, className = "" }: { text: string; className?: string }) {
	const box = useRef<HTMLSpanElement>(null);
	const body = useRef<HTMLSpanElement>(null);
	const [overflow, setOverflow] = useState(0);
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
			const part = Math.round(inner.getBoundingClientRect().width);
			const next = Math.max(0, part - outer.clientWidth);
			setWidth((prev) => (Math.abs(part - prev) > 1 ? part : prev));
			setOverflow((prev) => (Math.abs(next - prev) > 1 ? next : prev));
		};
		measure();

		// The row is re-measured when the sidebar changes width (drawer vs pushed) and when a
		// webfont lands and the text reflows.
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		observer.observe(inner);
		return () => observer.disconnect();
	}, [text]);

	const scrolls = overflow > 1;
	// One full cycle carries the first copy off the left, leaving the second exactly where the
	// first began. Constant speed rather than constant duration, so a slightly-too-long title
	// does not crawl while a very long one races.
	const distance = width + GAP;
	const duration = Math.max(2200, Math.round((distance / SPEED) * 1000));

	return (
		<span
			ref={box}
			className={`block overflow-hidden whitespace-nowrap ${scrolls ? "ly-fade-edge" : ""} ${className}`}
			style={
				scrolls
					? ({ "--ly-marquee": `-${distance}px`, "--ly-scroll": `${duration}ms` } as React.CSSProperties)
					: undefined
			}
		>
			<span className={scrolls ? "ly-marquee-track" : "inline-block"}>
				<span ref={body} className="inline-block">
					{text}
				</span>
				{/* The trailing copy is decoration; screen readers and copy-paste get one line. */}
				{scrolls && (
					<span aria-hidden className="inline-block">
						{text}
					</span>
				)}
			</span>
		</span>
	);
}
