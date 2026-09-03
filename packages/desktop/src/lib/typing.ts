/**
 * One string being rewritten into another, a character at a time.
 *
 * A conversation is filed under 「新对话」 for as long as it takes the runtime to read the first
 * message, and then the real title lands. Replacing one with the other in a single frame is the
 * one moment in the sidebar where a row changes for reasons that have nothing to do with what you
 * just did, and swapped outright it reads as the list having re-sorted itself under your cursor.
 * Rewriting it is the same information, delivered as an event you can follow.
 *
 * The shared prefix is kept rather than deleted, so 「查一下依赖」 → 「查一下依赖为什么装不上」
 * does not walk all the way back to nothing first — it types the tail. That case is common:
 * the stored title is derived from the prompt, so it and its replacement often start alike.
 *
 * Code points, not UTF-16 units: `[...text]` keeps an emoji or any astral character whole, where
 * `slice` would cut a surrogate pair in half and paint a replacement glyph for one frame.
 */

/**
 * How many steps the rewrite is allowed to take.
 *
 * A 60-character title deleted and retyped one glyph at a time is over a hundred frames — three
 * seconds of a sidebar row churning, which is no longer feedback but an animation being watched.
 * Past this many steps each frame moves several characters instead, so a long title and a short
 * one take about the same time and that time stays under a second.
 */
const MAX_FRAMES = 26;

/**
 * Every intermediate string between `from` and `to`, in order, ending on `to`.
 *
 * Empty when there is nothing to show — identical strings, or a first value arriving where there
 * was none — which the caller reads as "no animation, just render it".
 */
export function typingFrames(from: string, to: string, maxFrames: number = MAX_FRAMES): string[] {
	if (from === to) return [];

	const before = [...from];
	const after = [...to];

	let shared = 0;
	while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared += 1;

	const deletions = before.length - shared;
	const additions = after.length - shared;
	// Ceil, so the step is always at least one and the loops below always terminate.
	const step = Math.max(1, Math.ceil((deletions + additions) / maxFrames));

	const frames: string[] = [];
	for (let length = before.length - step; length > shared; length -= step) frames.push(before.slice(0, length).join(""));
	if (deletions > 0) frames.push(before.slice(0, shared).join(""));
	for (let length = shared + step; length < after.length; length += step) frames.push(after.slice(0, length).join(""));
	frames.push(to);

	// Deleting to the shared prefix can land on the target itself — trimming a title down to a
	// shorter one that starts the same way. A repeated frame is a frame of nothing happening.
	return frames.filter((frame, index) => index === 0 || frame !== frames[index - 1]);
}
