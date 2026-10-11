/**
 * How far along a drawing probably is, and what to call that stage.
 *
 * No image endpoint reports progress — the relay in front of Gemini answers once, with the whole
 * picture — so the number on the card is an estimate against how long this kind of drawing usually
 * takes. It rises quickly, slows as it nears the expected time, and stops short of the end: a gauge
 * that reached 100% while nothing had arrived would be a gauge that lied. The real end is the
 * picture arriving, and that is when it jumps.
 */

import type { MessageKey } from "../i18n/messages/index.ts";

/** Typical wall time for one picture, measured on relays: Gemini's flash models are quick, OpenAI's are not. */
function baseMs(modelId: string): number {
	const id = modelId.toLowerCase();
	if (/gpt-image|chatgpt-image|dall-e/.test(id)) return 45_000;
	if (/pro-image|imagen-4\.0-ultra|seedream/.test(id)) return 35_000;
	return 22_000;
}

/** Expected wall time for this call. Several pictures run side by side, so they cost a little, not n times. */
export function expectedMs(modelId: string, quality?: string, count = 1, edit = false): number {
	const detail = quality === "max" ? 2.6 : quality === "high" ? 1.5 : quality === "low" ? 0.8 : 1;
	return baseMs(modelId) * detail * (1 + 0.12 * (count - 1)) * (edit ? 1.15 : 1);
}

/** The ceiling the estimate approaches and never reaches on its own. */
export const ESTIMATE_CEILING = 0.96;

/**
 * Elapsed time as a fraction: about 85% at the expected time, then a slow approach to the ceiling.
 *
 * An exponential rather than a straight line so a drawing that runs long keeps moving instead of
 * sitting on a number — the reading people take as "stuck" is the one that stops changing.
 */
export function progressAt(elapsedMs: number, expected: number): number {
	if (elapsedMs <= 0) return 0;
	return ESTIMATE_CEILING * (1 - Math.exp((-elapsedMs * 2) / expected));
}

const STAGES: [number, MessageKey][] = [
	[0.12, "imageGen.stage.brief"],
	[0.38, "imageGen.stage.draft"],
	[0.66, "imageGen.stage.scene"],
	[0.88, "imageGen.stage.detail"],
	[Infinity, "imageGen.stage.finish"],
];

export function stageAt(progress: number): MessageKey {
	return (STAGES.find(([upTo]) => progress < upTo) ?? STAGES[STAGES.length - 1])[1];
}
