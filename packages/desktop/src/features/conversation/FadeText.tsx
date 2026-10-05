/**
 * Text being written, with new characters fading in rather than popping in one by one.
 *
 * With only the even letting-out (`useSmoothText`), the characters arrive at a steady rate, but each still
 * cuts in from nothing to solid — it looks like text being spat out. This gives each new character a
 * moment to appear and fades it from clear to solid; characters of one batch are staggered a little,
 * spread out until the next batch is due, so what you see is one continuous flowing fade rather than
 * step after step. The idea is streamdown's `StreamTail`.
 *
 * **Only characters still fading are a `<span>`.** Faded ones merge back into the plain text before
 * them, or a long reply would collect thousands of spans. A span's key is its character index: when the
 * characters before it merge back, the spans after it are not rebuilt, so their animations do not
 * restart.
 *
 * **Appearance times live on this instance, not numbered across the whole block.** Numbering the whole
 * block in render order counts twice under StrictMode's double render; and while streaming only the last
 * piece of text grows while the instances before it stay as they are, so each keeping its own is enough.
 */

import { type CSSProperties, useRef } from "react";

/** How long one character takes to fade in. The same number as `.ly-fade-char`'s duration in `markdown.css`; change one, change the other. */
export const FADE = 180;
/** The most two neighbouring characters are staggered by. Any slower and the fade falls behind the rate characters are being let out at. */
const MAX_PACE = 18;
/** The gap between two batches is taken within this range: too short means nothing, too long (upstream paused) should not make the next batch crawl out. */
const MIN_GAP = 16;
const MAX_GAP = 160;
/**
 * How long a newly mounted piece of text is spread over. It has no previous batch to compare with; a short
 * reply that arrives as one sentence is this case, and spreading it a little reads as a fade from left to
 * right rather than the whole sentence surfacing at once.
 */
const FIRST_GAP = 120;

export function FadeText({ text }: { text: string }) {
	const chars = Array.from(text);
	const { settled, style } = useFade(chars.length);

	return (
		<>
			{chars.slice(0, settled).join("")}
			{chars.slice(settled).map((char, offset) => (
				<span key={settled + offset} className="ly-fade-char" style={style(settled + offset)}>
					{char}
				</span>
			))}
		</>
	);
}

/**
 * When each character of a growing piece of text appears: those before `settled` have finished fading
 * and draw as plain text; each one after draws as a fading span styled by `style(index)`, keyed by that
 * index. `length` counts code points (`Array.from`), not UTF-16 units.
 *
 * Code blocks use it too: the token boundaries highlighting cuts shift as characters grow in, but each
 * character's index does not, so its appearance time stays put.
 */
export function useFade(length: number): { settled: number; style: (index: number) => CSSProperties } {
	const state = useRef<{ births: number[]; last: number; styles: Map<number, CSSProperties> } | null>(null);
	state.current ??= { births: [], last: 0, styles: new Map() };
	const here = state.current;
	const now = performance.now();
	const births = here.births;

	if (length < births.length) births.length = length;
	const fresh = length - births.length;
	if (fresh > 0) {
		/*
		 * This batch is staggered to fill roughly the time until the next one is due: the gap is the actual
		 * interval between the last batch and this one. A newly mounted instance has no last batch and
		 * spreads over `FIRST_GAP`.
		 */
		const gap = here.last ? Math.min(MAX_GAP, Math.max(MIN_GAP, now - here.last)) : FIRST_GAP;
		const pace = Math.min(MAX_PACE, gap / fresh);
		let previous = births.length > 0 ? births[births.length - 1] : now - pace;
		while (births.length < length) {
			previous = Math.min(now + gap, Math.max(previous + pace, now));
			births.push(previous);
		}
		here.last = now;
	}

	// Appearance times only increase, so the faded characters are always one run at the start.
	let settled = 0;
	while (settled < length && now - births[settled] >= FADE) settled++;
	for (const key of here.styles.keys()) if (key < settled) here.styles.delete(key);

	return {
		settled,
		style: (index) => {
			// Fixed the first time it is drawn and never changed: changing `animation-delay` makes a fading character jump.
			let style = here.styles.get(index);
			if (!style) {
				style = { animationDelay: `${Math.round(births[index] - now)}ms` };
				here.styles.set(index, style);
			}
			return style;
		},
	};
}
