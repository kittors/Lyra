/**
 * What of the reasoning goes on the thinking line's ticker.
 *
 * Kept apart from the component so it can be tested as text in, runs out. The ticker's
 * measuring needs a window, and is not where this goes wrong.
 */

/**
 * The reasoning as a row of short runs, one per line the model wrote.
 *
 * The ticker is one line, so a line break cannot be a break — it becomes a wider gap in the
 * run, which is what "next thought" looks like when everything is on one line. Every break
 * counts, not only blank lines: models write their reasoning as numbered steps one per line,
 * and folding those together gives "1. Read the diff 2. Check the tests" with nothing to say
 * where one ends and the next begins.
 *
 * Markdown is stripped rather than rendered. Reasoning arrives as markdown — backticked
 * identifiers, bold, list markers — and on a ticker those characters are noise: a `**` reads
 * as a typo and a `#` as a heading whose shape nobody can see.
 */
export function thinkingRuns(text: string): string[] {
	return text
		.split("\n")
		.map((line) => plain(line).replace(/\s+/g, " ").trim())
		.filter((line) => line.length > 0);
}

function plain(line: string): string {
	return (
		line
			// A fence line carries no words; its language tag is not for reading.
			.replace(/^\s*```.*$/, "")
			// Block prefixes: heading marks, quote bars, bullets, numbered steps.
			.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
			// Emphasis keeps its words and loses its marks. The italic rule wants a non-word
			// character on both sides, so an `_` inside `snake_case` is left alone.
			.replace(/(\*\*|__)(.+?)\1/g, "$2")
			.replace(/(^|[^\w*])[*_]([^*_]+?)[*_](?=[^\w*]|$)/g, "$1$2")
			// Inline code without the ticks.
			.replace(/`([^`]+)`/g, "$1")
			// Links and images keep their label.
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
	);
}
