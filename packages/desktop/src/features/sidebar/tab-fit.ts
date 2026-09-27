/**
 * How the sidebar's tab strip fits the room its row leaves it.
 *
 * Apart from the component so the arithmetic can be tested without a layout engine: `SidebarTabs`
 * measures, this decides.
 */

interface TabFit {
	/** Padding either side of each tab's content, in CSS pixels — never more than `pad.full`. */
	pad: number;
	/** Whether the words are shown. Without them each tab is its mark alone. */
	words: boolean;
}

/**
 * Words while they fit, the marks alone once they do not.
 *
 * The two words were once both two characters, and the strip was drawn for that. In most other
 * languages they are longer and of different lengths, and at the default width the row runs out:
 * English by about five pixels, Russian and Japanese by twenty-odd, French by nearly forty.
 *
 * The padding gives first, the same amount from every side, down to `pad.floor`. That is all
 * English needs at the default width, and why it looks as it always has — the same strip width,
 * both words — rather than being the first language to lose them. Past the floor the words go and
 * each tab is its mark alone, at full padding: a word cut short loses a character or two to the
 * ellipsis even when it is only a pixel over, and the mark says which tab it is in any language.
 *
 * `labels` are the words' own widths, and `mark` is one mark plus its gap to the word.
 */
export function fitTabs(
	room: number,
	labels: readonly number[],
	mark: number,
	pad: { full: number; floor: number },
): TabFit {
	const content = labels.reduce((sum, width) => sum + width + mark, 0);
	// Rounded down to a quarter pixel, so rounding can only ever leave room over, never run short.
	const spare = Math.floor(((room - content) / (labels.length * 2)) * 4) / 4;
	return spare >= pad.floor ? { pad: Math.min(pad.full, spare), words: true } : { pad: pad.full, words: false };
}
