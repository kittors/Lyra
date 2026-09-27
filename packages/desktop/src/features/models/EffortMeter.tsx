/**
 * The reasoning level as a small meter, for a phone's composer.
 *
 * The desktop says the level in words beside the model's name — 中, Medium, Средняя — and a word is
 * as wide as its language makes it: 「中」 is one glyph, "Очень высокая" is thirteen letters. On a
 * phone the row has no width to give it. In English "Medium" left the model's name at
 * `Claude Sonn…` on a 390pt screen, and in Russian it was worse, so what the row showed depended on
 * the language rather than on the model.
 *
 * A meter is the same width in every language and still says what the word said: how far along
 * its model's own scale this conversation is set — one bar per level the model offers, lit up to
 * the chosen one, the same scale the menu's slider draws. The word is one tap away, at the top of
 * that menu, and it stays the button's accessible name.
 */

import type { ModelConfig, ThinkingLevel, ThinkingOption } from "@lyra/core";
/*
 * From the leaf, not the barrel: `@lyra/core`'s index reaches the provider transports and a native
 * module the renderer cannot bundle. See `EffortMenu.tsx`.
 */
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";

/**
 * Past this many, bars stop being countable at a glance and the meter outgrows its 44pt button.
 * A longer scale is squeezed onto this many rather than drawn bar for bar.
 */
const MOST_BARS = 7;
/** The first bar's height and the last one's, in px; the ones between climb evenly. */
const SHORTEST = 6;
const TALLEST = 16;

/**
 * How many bars to draw and how many of them are lit.
 *
 * The level is resolved exactly as `effortLabel` resolves the word, so the meter and the menu can
 * never disagree: a level this model does not offer shows its default, and 「关」 lights nothing. A
 * model without reasoning gets a short dark scale, which is what "off" looks like.
 */
export function effortSteps(level: ThinkingLevel, model?: ModelConfig | null): { bars: number; lit: number } {
	const options: ThinkingOption[] = resolveModelThinkingOptions(model);
	const steps = options.filter((option) => option.id !== "off");
	if (steps.length === 0) return { bars: 3, lit: 0 };
	let lit = 0;
	if (level !== "off") {
		const selected = options.find((option) => option.id === level) ?? options.find((option) => option.isDefault) ?? options[0];
		lit = selected.id === "off" ? 0 : steps.indexOf(selected) + 1;
	}
	if (steps.length <= MOST_BARS) return { bars: steps.length, lit };
	// Squeezed, a lit level must still light something: the lowest one is not "off".
	return { bars: MOST_BARS, lit: lit === 0 ? 0 : Math.max(1, Math.round((lit * MOST_BARS) / steps.length)) };
}

function barHeight(index: number, bars: number): number {
	if (bars <= 1) return TALLEST;
	return SHORTEST + ((TALLEST - SHORTEST) * index) / (bars - 1);
}

export function EffortMeter({ level, model }: { level: ThinkingLevel; model?: ModelConfig | null }) {
	const { bars, lit } = effortSteps(level, model);
	return (
		// Past four bars they are drawn thinner, so seven still fit the 44pt the button has.
		<span className="ly-effort-meter" aria-hidden data-lit={lit} data-dense={bars > 4 ? "" : undefined}>
			{Array.from({ length: bars }, (_, index) => (
				<span key={index} data-on={index < lit ? "" : undefined} style={{ height: `${barHeight(index, bars)}px` }} />
			))}
		</span>
	);
}
