import { Brain } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "./Markdown.tsx";
import { thinkingRuns } from "./thinking-ticker.ts";

/** How deep the ticker's mask goes at each end while the text is arriving. */
const FADE = 24;
/** Space between the two copies of a finished line reading itself out — see `ScrollText`. */
const LOOP_GAP = 44;
/** Pixels per second for that reading. Slow enough to follow a sentence. */
const SPEED = 46;

/**
 * The model's reasoning, behind one line that is the reasoning.
 *
 * The line used to say 「思考过程」 with a chevron. The words only said that reasoning existed,
 * which the icon already says, and the chevron was a second control on a line that is itself
 * the control. What a reader wants from the line is what the model is thinking, so that is
 * what it shows: while the reasoning arrives, the newest words enter at the right and the
 * older ones slide off the left under a fade; once it has finished, the line holds its opening
 * words and reads the rest out on hover, the way a long title in the sidebar does.
 *
 * Clicking the line unfolds the whole text beneath it, as it always has. Once opened it stays
 * open, including as the text keeps arriving.
 */
export function ThinkingBlock({ text, redacted, live }: { text: string; redacted: boolean; live?: boolean }) {
	const [open, setOpen] = useState(false);

	if (!text && !redacted) return null;
	const mode = live ? "follow" : "loop";

	return (
		<div data-ly-thinking="" className="mb-2.5">
			{/* `ly-scroll` is what sets a finished line's read-back moving on hover — see styles.css. */}
			<button
				type="button"
				disabled={redacted}
				aria-label="思考过程"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				/*
				 * `text-label`，和 `ToolGroup` 那一行一样——这两个是同一种东西。
				 *
				 * 一条工具行和一条思考行在文稿里是并排出现的同类：一行灰字、点开有内容。它们过去
				 * 一个 13px 一个 12px，行高就差 1.5px，于是连着几条摘要排下来，行距一宽一窄，看着
				 * 像是没对齐。外边距早就是一样的 `mb-2.5` 了，不齐的是字本身。
				 */
				className="ly-scroll flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-label text-ink-faint transition-colors hover:text-ink-muted"
			>
				<Brain size={13} strokeWidth={1.8} className={`shrink-0 ${live ? "ly-pulse" : ""}`} />
				{redacted ? (
					"思考内容已被安全过滤"
				) : (
					/*
					 * Remounted when the reasoning finishes rather than switched in place. The two
					 * motions leave different state on the same elements — an inline transform, a pair
					 * of mask depths — and a fresh element is simpler than undoing one motion's marks
					 * before the other starts.
					 */
					<Ticker key={mode} text={text} mode={mode} />
				)}
			</button>

			{open && !redacted && (
				<div className="ly-enter mt-1.5 border-l-2 border-line pl-3">
					{/*
					 * Rendered, not raw. Models write their reasoning in markdown — backticked
					 * identifiers, numbered steps, the occasional block — so showing it verbatim
					 * meant reading `handle()` with the backticks still on.
					 */}
					<Markdown text={text} className="text-label text-ink-muted" />
				</div>
			)}
		</div>
	);
}

/**
 * The reasoning on one line, in one of two motions.
 *
 * `follow` is for text still arriving: the track is laid out at its full width and moved left
 * by however much of it does not fit, so the end of the text — the part being written — always
 * sits at the right edge, and every new word pushes the line along by its own width. A
 * transition on that movement is what makes the words arrive as a slide rather than a jump;
 * the mask at each end is what makes the ends look like ends rather than cuts. Neither fade
 * exists until there is text under it: a line that fits should start where text starts.
 *
 * `loop` is for finished text: it rests at its beginning, fading out at the right if there is
 * more, and on hover the whole run scrolls past at a steady pace with a trailing copy so the
 * loop is seamless — the same motion, and the same CSS, as a long title in the sidebar.
 * Nothing moves if the text fits.
 *
 * Following is measured and moved by hand rather than through state. Every token re-renders
 * this component already; asking React for a second pass per token to apply a number the DOM
 * already knows is the difference between a ticker and a stutter. The loop needs a second copy
 * in the tree, so that one goes through state — it is set up once, when the text settles.
 */
function Ticker({ text, mode }: { text: string; mode: "follow" | "loop" }) {
	const box = useRef<HTMLSpanElement>(null);
	const track = useRef<HTMLSpanElement>(null);
	const runs = useMemo(() => thinkingRuns(text), [text]);
	const [loop, setLoop] = useState<{ distance: number; duration: number } | null>(null);

	useLayoutEffect(() => {
		const outer = box.current;
		const inner = track.current;
		if (!outer || !inner) return;
		const measure = () => {
			if (mode === "follow") {
				const overflow = Math.max(0, inner.offsetWidth - outer.clientWidth);
				inner.style.transform = `translateX(${-overflow}px)`;
				const fade = overflow > 0 ? `${FADE}px` : "0px";
				outer.style.setProperty("--ly-fade-left", fade);
				outer.style.setProperty("--ly-fade-right", fade);
				return;
			}
			// One copy's width against the box: the copies are identical, so the first will do.
			const width = Math.round((inner.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0);
			const overflow = width - outer.clientWidth;
			// Constant speed rather than constant duration, so a slightly-too-long line does not
			// crawl while a very long one races. The dead band keeps a sub-pixel wobble from
			// re-rendering on every observer callback.
			const distance = width + LOOP_GAP;
			const duration = Math.max(2200, Math.round((distance / SPEED) * 1000));
			setLoop((prev) => {
				if (overflow <= 1) return prev === null ? prev : null;
				return prev && Math.abs(prev.distance - distance) <= 1 ? prev : { distance, duration };
			});
		};
		measure();
		// Re-measured when the column changes width — a panel opening, the sidebar being dragged.
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		return () => observer.disconnect();
	}, [runs, mode]);

	const looping = mode === "loop" && loop !== null;
	const copy = (hidden: boolean) => (
		<span aria-hidden={hidden || undefined} className="ly-think-runs">
			{runs.map((run, index) => (
				<span key={index}>{run}</span>
			))}
		</span>
	);

	return (
		<span
			ref={box}
			aria-hidden
			className={`ly-think-ticker ${looping ? "ly-fade-edge" : ""}`}
			style={
				looping
					? ({ "--ly-marquee": `-${loop.distance}px`, "--ly-scroll": `${loop.duration}ms` } as React.CSSProperties)
					: undefined
			}
		>
			<span ref={track} className={looping ? "ly-marquee-track" : "ly-think-track"}>
				{copy(false)}
				{/* The trailing copy is decoration; the line is already hidden from readers. */}
				{looping && copy(true)}
			</span>
		</span>
	);
}
