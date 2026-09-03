/**
 * What to call the waiting, and what to draw while it lasts.
 *
 * A turn is mostly silence — a loader and a number counting up. The number says how long, the
 * loader says it is alive, and neither says what kind of waiting this is. Reading a file, running
 * a test and hunting through a codebase feel different to sit through, and naming the difference
 * is most of what makes a long turn bearable.
 *
 * Written here, not asked of the model. Making it produce a status line would cost a request per
 * phrase, arrive too late to describe what it is doing now, and put one more thing in the way of
 * the actual answer. These are picked from what the agent has just done, which the window already
 * knows.
 *
 * The tone is deliberately colloquial, and in English — it sits beside `42s · 63.6k tokens`, and
 * a Chinese phrase in that row read as a different voice interrupting a technical readout. This
 * is the app muttering to itself in the corner of the screen, not a progress dialog reporting to
 * a manager.
 *
 * One classification, two consumers. The words below and the orb beside them are the same answer
 * drawn twice, so `Mood` *is* `OrbState` rather than a parallel vocabulary that has to be kept in
 * step by hand — a mood the orb cannot draw stops compiling, and an orb state nothing ever picks
 * is a missing key in `WORDS`.
 */

import type { OrbState } from "thinking-orbs";

/**
 * The kinds of waiting worth distinguishing.
 *
 * Nine, because that is what the orbs draw, and each one had to earn its tool rather than be
 * assigned one to fill the set — the animation and the work have to be about the same thing or the
 * mark is decoration. What each one looks like is in `thinking-orbs`' own docs; what it means here:
 *
 * - `breathing`  — a ring slowly morphing: the model is thinking, nothing is running
 * - `listening`  — a waveform rolling through rings: taking something in, i.e. reading
 * - `searching`  — a scan meridian sweeping the globe: grep, glob, ls
 * - `working`    — particles on tilted orbits: a command is running
 * - `solving`    — bands scrambling and clicking back: a test suite, which either passes or does not
 * - `connecting` — a constellation wiring itself: anything that leaves this machine
 * - `weaving`    — three strands plaiting: a plan being laid out, or subagents running
 * - `composing`  — an undulating sash: writing something new
 * - `shaping`    — a dotted outline morphing circle → triangle → square: reworking something there
 */
export type Mood = OrbState;

const WORDS: Record<Mood, string[]> = {
	listening: ["Reading up", "Skimming", "Digging in", "Getting the lay of it", "Poking around the source"],
	composing: ["Writing", "Drafting", "Putting it down", "Getting it on paper", "Laying down code"],
	shaping: ["Reworking", "Editing", "Reshaping it", "Moving things around", "Knocking it into shape"],
	working: ["Running it", "Kicking it off", "Letting it rip", "Waiting on the shell", "Turning the crank"],
	searching: ["Hunting", "Rummaging", "Casting about", "Following the thread", "Combing through"],
	solving: ["Proving it", "Running the gauntlet", "Making sure", "Putting it through its paces"],
	connecting: ["Having a look", "Loading the page", "Peeking at the web", "Reaching out"],
	weaving: ["Plotting", "Lining it up", "Sketching the order", "Working out the steps"],
	breathing: ["Thinking", "Mulling", "Turning it over", "Chewing on it", "Working it out", "Pondering"],
};

/** After this long on one step, the wording acknowledges that it is taking a while. */
const PATIENCE_MS = 45_000;
const LONG_WORDS = ["Still at it", "This one's stubborn", "Taking its time", "Nearly there", "Wrestling with it"];

const BY_TOOL: Record<string, Mood> = {
	read: "listening",
	symbol: "listening",
	write: "composing",
	preview: "composing",
	edit: "shaping",
	bash: "working",
	bash_output: "working",
	glob: "searching",
	grep: "searching",
	ls: "searching",
	todo_write: "weaving",
	task: "weaving",
	web_fetch: "connecting",
	web_search: "connecting",
	browser_act: "connecting",
};

/** Commands that are really a test run, whatever tool they arrived through. */
const TEST_HINT = /\b(test|jest|vitest|pytest|spec|coverage)\b/i;

/**
 * What the agent is doing, in the order these questions have to be asked.
 *
 * `retrying` wins over everything: a turn waiting on a reconnect is not doing whatever its last
 * tool was, it is doing nothing at all until the network comes back, and the orb saying otherwise
 * would be the only thing on screen still claiming progress.
 *
 * `writing` is the difference between the two halves of the silence, and without it most of a turn
 * looked identical. A model with no tool running is either reasoning — nothing to show yet — or
 * streaming its answer, which is `composing`, the same thing `write` does. Reading it off the last
 * content block is what makes that free: a `thinking` block means the first, a `text` block the
 * second. Tools still win, because a tool running while text streams is the more specific fact.
 */
export function moodFor(
	toolName: string | undefined,
	summary: string | undefined,
	retrying = false,
	writing = false,
): Mood {
	if (retrying) return "connecting";
	if (summary && TEST_HINT.test(summary)) return "solving";
	if (toolName) return BY_TOOL[toolName] ?? "breathing";
	return writing ? "composing" : "breathing";
}

/**
 * One phrase, chosen without a random number generator.
 *
 * Seeded by the mood and a slowly advancing tick so the same mood does not repeat the same word
 * back to back, and so a re-render never swaps the phrase on its own — only time does. Random
 * would change it on every paint, which is the flicker this is meant to avoid.
 */
export function phraseFor(mood: Mood, tick: number, elapsedMs: number): string {
	if (elapsedMs > PATIENCE_MS) return LONG_WORDS[tick % LONG_WORDS.length];
	const pool = WORDS[mood];
	return pool[tick % pool.length];
}
