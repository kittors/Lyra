import { translate } from "../../i18n/translate.ts";
import { Brain } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "./Markdown.tsx";
import { thinkingRuns } from "./thinking-ticker.ts";
import { useTranscriptDisclosure } from "./view-state.ts";

/** How deep the ticker's mask goes at each end while the text is arriving. */
const FADE = 24;
/** Space between the two copies of a finished line reading itself out — see `ScrollText`. */
const LOOP_GAP = 44;
/** Pixels per second for that reading. Slow enough to follow a sentence. */
const SPEED = 46;

/**
 * How fast the line writes itself out, in characters per second.
 *
 * The line used to have no pace of its own: whatever arrived was put into the DOM whole, and a
 * CSS transition slid the track to its new end in a fixed span of time. That makes the speed a
 * function of how much turned up at once — a provider that flushes six hundred characters in one
 * frame threw them past in the same fraction of a second as it took to ease six. The bigger the
 * batch the faster it went, which is exactly backwards from reading.
 *
 * So the text is revealed a character at a time, and the rate comes from how far behind the line
 * is. A floor, because a trickle should still look deliberate rather than stall; a ceiling,
 * because past roughly three or four characters a frame there is nothing to read, only a blur
 * travelling left. Between them it is "clear the backlog in `catchUp` seconds", which keeps a
 * steady stream about two thirds of a second behind the model — close enough to feel live, far
 * enough behind to actually be writing.
 */
const TYPE = {
	/** Characters per second when there is barely anything waiting. */
	floor: 42,
	/** Characters per second at full tilt: about 3.5 a frame, which is as fast as reading survives. */
	ceiling: 210,
	/** Seconds allowed to absorb whatever is waiting; the rate follows from it. */
	catchUp: 0.9,
	/**
	 * The ceiling once the reasoning has stopped arriving.
	 *
	 * Finishing at reading pace would leave the line typing under work that has already moved on.
	 * Cutting to the end instead would be a jump. So it accelerates out.
	 */
	finish: 520,
} as const;

/**
 * The model's reasoning, behind one line that is the reasoning.
 *
 * The line used to say 「思考过程」 with a chevron. The words only said that reasoning existed,
 * which the icon already says, and the chevron was a second control on a line that is itself
 * the control. What a reader wants from the line is what the model is thinking, so that is
 * what it shows: while the reasoning arrives it writes itself out a character at a time, the
 * newest words entering at the right and the older ones sliding off the left under a fade; once
 * it has finished, the line holds its opening words and reads the rest out on hover, the way a
 * long title in the sidebar does.
 *
 * Clicking the line unfolds the whole text beneath it, as it always has. Once opened it stays
 * open, including as the text keeps arriving.
 */
export function ThinkingBlock({ text, redacted, live, stateKey }: { text: string; redacted: boolean; live?: boolean; stateKey?: string }) {
	const [open, setOpen] = useTranscriptDisclosure(stateKey);

	if (!text && !redacted) return null;

	return (
		<div data-ly-thinking="" className="mb-2.5 last:mb-0">
			{/* `ly-scroll` is what sets a finished line's read-back moving on hover — see styles.css. */}
			<button
				type="button"
				disabled={redacted}
				aria-label={translate("thinking.process")}
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
				{redacted ? translate("thinking.redacted") : <Ticker text={text} live={live === true} />}
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
 * The reasoning on one line, typing itself out and then holding still.
 *
 * Two motions, and the handover between them is the whole difficulty. While the text is arriving
 * a frame loop owns the line: it reveals a few more characters, measures how much of the track no
 * longer fits, and moves it left by exactly that — so the character being written sits at the
 * right edge and everything before it has slid under the fade. Once the reasoning stops arriving
 * the loop keeps going until it has caught up, and only then hands over: the line rests at its
 * beginning and reads itself back on hover, the same motion and the same CSS as a long title in
 * the sidebar.
 *
 * That order matters. Switching the moment the model stops would swap a line typed two thirds of
 * the way through for its own full text, which is a jump — and this component is remounted for
 * every stretch of reasoning in a turn, so on a long turn that would be forty of them.
 *
 * Nothing about the typing goes through React. Every token re-renders this component already, and
 * asking for a second pass per token to apply a number the DOM already knows is the difference
 * between a ticker and a stutter — so React renders empty spans while the line is live and the
 * frame loop writes their text, and only the handover to the finished state is state.
 */
function Ticker({ text, live }: { text: string; live: boolean }) {
	const box = useRef<HTMLSpanElement>(null);
	const track = useRef<HTMLSpanElement>(null);
	const runs = useMemo(() => thinkingRuns(text), [text]);
	/**
	 * Whether the line has finished writing itself out.
	 *
	 * Starts true for anything that was never live — a reopened session is hundreds of finished
	 * lines, and none of them should type themselves out on the way in.
	 */
	const [done, setDone] = useState(!live);
	const [loop, setLoop] = useState<{ distance: number; duration: number } | null>(null);

	/*
	 * What the frame loop reads, kept off the render path.
	 *
	 * The loop must see the newest text without being torn down and rebuilt for it: an effect that
	 * depended on `runs` would restart on every token, and restarting is where a frame's worth of
	 * position gets lost.
	 */
	const state = useRef({ runs, total: 0, shown: 0, live, held: false });
	state.current.runs = runs;
	state.current.total = runs.reduce((n, run) => n + run.length, 0);
	state.current.live = live;

	/** Put `count` characters on the line, spending them run by run. */
	const reveal = (count: number) => {
		const spans = track.current?.firstElementChild?.children;
		if (!spans) return;
		let left = count;
		for (let at = 0; at < spans.length; at++) {
			const run = state.current.runs[at] ?? "";
			const take = Math.max(0, Math.min(left, run.length));
			const span = spans[at] as HTMLElement;
			const next = run.slice(0, take);
			if (span.textContent !== next) span.textContent = next;
			// A run that has not started must not hold its gap open, or the line begins indented.
			span.style.display = take > 0 ? "" : "none";
			left -= run.length;
		}
	};

	/** Move the track so the character being written sits at the right edge. */
	const follow = () => {
		const outer = box.current;
		const inner = track.current;
		if (!outer || !inner) return;
		const overflow = Math.max(0, inner.offsetWidth - outer.clientWidth);
		// Held under the pointer: the reader is looking at something, and the line stops for them.
		if (!state.current.held) inner.style.transform = `translateX(${-overflow}px)`;
		const fade = overflow > 0 ? `${FADE}px` : "0px";
		outer.style.setProperty("--ly-fade-left", fade);
		outer.style.setProperty("--ly-fade-right", fade);
	};

	// The frame loop: reveal, measure, move. Runs only while the line is still writing.
	useEffect(() => {
		if (done) return;
		let raf = 0;
		let last = performance.now();
		const step = (now: number) => {
			// Clamped, so a backgrounded tab does not come back and spend its whole absence in one frame.
			const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
			last = now;
			const here = state.current;
			if (here.shown > here.total) here.shown = here.total;
			const backlog = here.total - here.shown;
			if (backlog > 0) {
				const ceiling = here.live ? TYPE.ceiling : TYPE.finish;
				const rate = Math.min(ceiling, Math.max(TYPE.floor, backlog / TYPE.catchUp));
				here.shown = Math.min(here.total, here.shown + rate * dt);
				reveal(Math.floor(here.shown));
				follow();
			} else if (!here.live) {
				// Caught up, and nothing more is coming: hand over with the same text already on screen.
				reveal(here.total);
				follow();
				setDone(true);
				return;
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [done]);

	/*
	 * The pointer holds a live line still.
	 *
	 * Landing on a line that is scrolling itself away is how you lose the sentence you were reading,
	 * so the pointer stops the movement — the text carries on being written, it just stops sliding
	 * out from under you. Letting go glides back to the end rather than snapping, which is the one
	 * moment this line wants a transition.
	 *
	 * Native listeners rather than React's: a hover that went through state would re-render this
	 * component, and while the line is live its spans are written by hand and rendered empty.
	 */
	useLayoutEffect(() => {
		if (done) return;
		const line = box.current?.closest(".ly-scroll") as HTMLElement | null;
		if (!line) return;
		const here = state.current;
		const hold = () => {
			here.held = true;
		};
		const release = () => {
			here.held = false;
			const inner = track.current;
			if (!inner) return;
			inner.style.transition = "transform 420ms var(--ly-e-out)";
			window.setTimeout(() => inner.style.removeProperty("transition"), 460);
		};
		line.addEventListener("pointerenter", hold);
		line.addEventListener("pointerleave", release);
		return () => {
			line.removeEventListener("pointerenter", hold);
			line.removeEventListener("pointerleave", release);
			here.held = false;
		};
	}, [done]);

	/*
	 * The finished line: how far it has to travel to read itself out, and how long that should take.
	 *
	 * Measured rather than assumed, and re-measured when the column changes width — a panel
	 * opening, the sidebar being dragged.
	 */
	useLayoutEffect(() => {
		if (!done) return;
		const outer = box.current;
		const inner = track.current;
		if (!outer || !inner) return;
		/*
		 * The marks the typing left behind, cleared before the other motion starts.
		 *
		 * An inline transform and a pair of mask depths outrank the classes that draw the finished
		 * line, so leaving them would pin it wherever the typing stopped, permanently.
		 */
		inner.style.removeProperty("transform");
		inner.style.removeProperty("transition");
		outer.style.removeProperty("--ly-fade-left");
		outer.style.removeProperty("--ly-fade-right");
		const measure = () => {
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
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		return () => observer.disconnect();
	}, [done, runs]);

	const looping = done && loop !== null;
	const copy = (hidden: boolean) => (
		<span aria-hidden={hidden || undefined} className="ly-think-runs">
			{runs.map((run, index) => (
				// Empty while the line is live: the frame loop owns this text until it hands over.
				<span key={index}>{done ? run : null}</span>
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
