import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { describeRetry } from "../../lib/retry-line.ts";
import { useCountUp } from "../../ui/primitives/useCountUp.ts";
import { moodFor, phraseFor } from "../../lib/thinking-words.ts";
import { useApp } from "../../store/index.ts";

/**
 * What the agent is spending while it works: elapsed time and tokens so far.
 *
 * A long turn is otherwise mostly silence — tool cards scroll past with no sense of whether
 * this has been going for ten seconds or ten minutes, or what it has cost. Three dots said
 * "something is happening"; this says what.
 */
/**
 * How long a finished tool keeps the line after it ends.
 *
 * Most calls are far shorter than this, so without it the mark they stand for is never actually
 * on screen. Two seconds reads as "it just did that" without outlasting the doing of it.
 */
const TOOL_HOLD_MS = 2000;

/**
 * How long the compaction notice stays on the running line.
 *
 * Long enough to be read by someone who was watching, short enough that it is gone before it
 * becomes part of the furniture. The clock ticks four times a second, so it expires on its own.
 */
const COMPACTED_NOTICE_MS = 8000;

export function RunningIndicator() {
	const startedAt = useApp((s) => s.turnStartedAt);
	const tokens = useApp((s) => s.turnTokens);
	const messages = useApp((s) => s.messages);
	const retrying = useApp((s) => s.retrying);
	const compactedAt = useApp((s) => s.compactedAt);
	const [now, setNow] = useState(() => Date.now());
	/*
	 * The phrase advances on its own clock, slower than the seconds.
	 *
	 * Tied to the timer it would change four times a second and read as noise; changed only when
	 * the work changes it would sit still through a long install. Every few seconds is fast
	 * enough to look alive and slow enough to be read.
	 */
	const [tick, setTick] = useState(0);
	/**
	 * The newest call, running or just finished, as `name \0 summary \0 finishedAt`.
	 *
	 * Just-finished matters as much as running, and leaving it out is why most of a turn showed the
	 * same mark. A `read` or an `ls` is over in tens of milliseconds — far too fast to see — so the
	 * state it stands for flashed past and the line spent nearly all its time on the "nothing is
	 * running" answer. The window is applied in the component rather than here: a selector only
	 * re-runs when the store changes, and nothing changes when a hold quietly expires.
	 */
	const doing = useApp((s) => {
		const runs = Object.values(s.toolRuns);
		const running = runs.filter((run) => run.status === "running").sort((a, b) => b.startedAt - a.startedAt)[0];
		if (running) return `${running.toolName}\u0000${running.summary}\u0000`;
		const finished = runs
			.filter((run) => run.finishedAt !== undefined)
			.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
		return finished ? `${finished.toolName}\u0000${finished.summary}\u0000${finished.finishedAt}` : "";
	});
	/**
	 * Whether the answer is being typed out, as opposed to being thought about.
	 *
	 * The last content block says which: `thinking` is the model reasoning with nothing to show yet,
	 * `text` is the reply arriving. From the outside both look like "no tool is running", and they
	 * are the two halves the silence is actually made of.
	 */
	const writing = useApp((s) => {
		const last = s.messages[s.messages.length - 1];
		if (last?.role !== "assistant" || last.stopReason !== "pending") return false;
		const block = last.content[last.content.length - 1];
		return block?.type === "text" && block.text.length > 0;
	});

	useEffect(() => {
		if (!startedAt) return;
		// Quarter-second so the seconds digit never appears to skip one.
		const timer = setInterval(() => setNow(Date.now()), 250);
		const words = setInterval(() => setTick((n) => n + 1), 4200);
		return () => {
			clearInterval(timer);
			clearInterval(words);
		};
	}, [startedAt]);

	// The reply still streaming has usage of its own; counting it keeps the number moving
	// between finished messages rather than jumping in steps.
	const last = messages[messages.length - 1];
	const live = last?.role === "assistant" && last.stopReason === "pending" ? last.usage.total : 0;
	const total = tokens + live;
	// Travelled to, not jumped to: usage lands per message, so this moves in steps of thousands.
	const counted = useCountUp(total);

	const [toolName, summary, finishedAt] = doing.split("\u0000");
	/*
	 * A finished tool keeps the line for a moment after it ends.
	 *
	 * Long enough to be seen — the work it stood for is over in a blink — and short enough that a
	 * turn which has moved on to thinking is not still claiming to be reading a file. `now` ticks
	 * four times a second, which is what lets this expire on its own.
	 */
	const fresh = Boolean(toolName) && (!finishedAt || now - Number(finishedAt) < TOOL_HOLD_MS);
	const elapsed = startedAt ? now - startedAt : 0;
	/*
	 * One reading of what is happening, drawn twice.
	 *
	 * The orb and the phrase are the same answer — see `thinking-words`. Deciding them separately
	 * was the obvious first shape and it is wrong: the two would disagree for a frame every time a
	 * tool started, which is exactly the moment anybody is looking at them.
	 */
	const mood = moodFor(fresh ? toolName : undefined, fresh ? summary : undefined, Boolean(retrying), writing);
	/*
	 * No phrase while reconnecting, because the line already has one.
	 *
	 * The orb is right — a dropped connection and a page fetch are the same picture, wires trying to
	 * find each other. The words are not: `connecting`'s pool is written for going out to the web,
	 * so a turn whose socket had just died announced 「Loading the page…」 immediately to the left of
	 * 「连接中断，14 秒后重试」. Two accounts of the same moment, one of them wrong.
	 *
	 * Dropped rather than given a pool of its own: the countdown on the right says what is happening
	 * and how long it will take, and anything here would be the same fact in fewer words.
	 */
	const phrase = retrying ? null : phraseFor(mood, tick, elapsed);

	return (
		/*
		 * Marked, because "is the turn still going" is a question asked from outside this file.
		 *
		 * The tests used to answer it by looking for the loader's own class — `.ly-flow`, the three
		 * dots — which tied every one of them to which loader this happens to draw. Swapping the
		 * loader is exactly the change that should not break them.
		 */
		<div
			data-ly-running
			/*
			 * The reading, on the element, so it can be checked from outside.
			 *
			 * The orb is a canvas: which of the nine it is drawing leaves no trace in the DOM, and a
			 * test that cannot see the state can only prove that *something* is animating. This is
			 * also the fastest way to see what the window thinks it is doing while using it.
			 */
			data-ly-mood={mood}
			className="ly-enter mb-2.5 flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-detail text-ink-muted whitespace-nowrap"
		>
			{/*
			 * Decorative, so `aria-hidden`: the phrase beside it already says what this is, and a
			 * reader announcing the orb's own label before "Hunting…" is the same fact twice.
			 *
			 * `20` rather than a scaled-down 64 — the two sizes are separate designs in that
			 * library, each with its own dot count and speed, and this one is drawn to sit in a
			 * line of text. Theme stays on `auto`, which reads the `dark`/`light` class this app
			 * already puts on `<html>` and follows it live.
			 */}
			<ThinkingOrb aria-hidden state={mood} size={20} className="shrink-0" />
			{/*
			 * Keyed on the words so one fades in as the other goes, rather than swapping in place.
			 *
			 * The phrase is the line's subject and reads at full strength; the meter after it —
			 * elapsed, tokens, why the wait is long — is reference, and sits a step back. They were
			 * the same weight before, which made a row of five things with no order to read them in.
			 */}
			{phrase && (
				<>
					<span key={phrase} className="ly-fade-in">
						{phrase}…
					</span>
					<span className="text-ink-faint">·</span>
				</>
			)}
			{startedAt && <span className="text-ink-faint tabular-nums">{formatElapsed(now - startedAt)}</span>}
			{total > 0 && (
				<>
					<span className="text-ink-faint">·</span>
					{/* `tabular-nums` matters more while it is moving: without it the glyph widths
					    change every frame and the whole line shuffles sideways as the number climbs. */}
					<span className="text-ink-faint tabular-nums">{formatTokens(Math.round(counted))} tokens</span>
				</>
			)}
			{/*
			 * Why the wait is longer than it should be, on the line that is already counting it.
			 *
			 * A dropped connection is not an event of its own to be announced elsewhere — it is
			 * the reason this particular turn is taking so long, and it stops being true the
			 * moment the turn does.
			 */}
			{/*
			 * Said once, where the turn's other business is said, and then gone.
			 *
			 * This used to be a rule drawn across the transcript, which is a permanent seam through
			 * someone's work in exchange for a fact about one request. It is worth knowing while it
			 * is happening — a turn that pauses to summarise is a turn that is doing something — and
			 * worth nothing at all a minute later.
			 */}
			{!retrying && compactedAt !== null && now - compactedAt < COMPACTED_NOTICE_MS && (
				<>
					<span className="text-ink-faint">·</span>
					<span className="ly-fade-in truncate text-ink-faint">已压缩较早的对话</span>
				</>
			)}
			{retrying && (
				<>
					<span className="text-ink-faint">·</span>
					<span className="text-ink-faint tabular-nums">{describeRetry(retrying, now)}</span>
				</>
			)}
		</div>
	);
}


function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		return `${hours}h ${minutes % 60}m`;
	}
	return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/**
 * A token count at a glance: 812, 12.3k, 4.1M, 2.7B.
 *
 * One decimal at every scale, because the digit after the point is the one that carries the
 * difference anyone acts on — 4.1M against 4.9M is a fifth of a bill. Billions are reachable on a
 * long-running project, and without a step for them the figure ran to five digits of millions.
 */
export function formatTokens(count: number): string {
	if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}
