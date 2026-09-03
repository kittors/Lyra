/**
 * Taking the system emoji out of text this app did not write.
 *
 * Everything drawn here is a line icon at one weight, in one of six ink colours. A colour emoji
 * lands in the middle of that as a small photograph: it is drawn by the OS from a different font,
 * at a different weight, in colours from nobody's palette, and on macOS it is glossy. One `🤖` in
 * a pull request description is the loudest thing on the screen, and it is loud by accident —
 * whoever typed it was writing for GitHub, not for this.
 *
 * So it comes out on the way in. Only from remote text — descriptions, comments, commit messages.
 * Nothing in this app types one.
 *
 * `Extended_Pictographic` is the property that means "is drawn as a picture", which is exactly the
 * question being asked. It deliberately does not match the typographic symbols this app uses on
 * purpose — `→`, `✓`, `✕`, `↵` are arrows and marks in the text font, not pictures, and they stay.
 *
 * Sequences are matched whole. A single emoji can be a base plus a skin tone, plus a variation
 * selector, joined by zero-width joiners to more of the same — `👨‍👩‍👧‍👦` is seven code points. Removing
 * them one at a time leaves the joiners behind, and a stray ZWJ is an invisible character that
 * makes the surrounding text impossible to search.
 */

const EMOJI_WITH_TRAILING_SPACE =
	/(\p{Extended_Pictographic}|\p{Regional_Indicator})(\p{Emoji_Modifier}|️|︎|\p{Regional_Indicator})*(‍(\p{Extended_Pictographic}|\p{Regional_Indicator})(\p{Emoji_Modifier}|️|︎)*)*[^\S\n]*/gu;

/**
 * The same text with pictographic characters removed.
 *
 * Line structure is preserved throughout: this runs before Markdown, so collapsing a newline
 * would turn a list into a sentence, and eating an indent would turn a code block into prose. A
 * line that held nothing but an emoji is left empty rather than deleted, for the same reason —
 * removing it would join the paragraphs either side of it.
 */
export function stripEmoji(text: string): string {
	if (!text) return text;

	return (
		text
			/*
			 * The picture takes its trailing space with it.
			 *
			 * `🤖 Generated with…` should become `Generated with…`, not ` Generated with…`. Taking
			 * the space on the way out is what makes that happen without a second pass over the line
			 * — and a second pass is exactly where this went wrong before: stripping leading
			 * whitespace everywhere also ate the indentation an indented code block is made of.
			 */
			.replace(EMOJI_WITH_TRAILING_SPACE, "")
			// What is left at the end of a line, from an emoji that sat there. Never touches
			// indentation, which is at the other end.
			.replace(/[^\S\n]+$/gm, "")
	);
}
