/**
 * Text in a detail pane, coloured by what it is.
 *
 * One component for every code surface in the panels, so a command looks the same wherever it is
 * shown. Two things are layered here and they have to compose: what the text *is* (a flag, a
 * string, a JSON key) and what the reader is *looking for* (the search query). Colour carries the
 * first, a mark carries the second — so a match inside a string is still visibly a string.
 *
 * Composing them means the search marks are applied inside each token rather than over the whole
 * text: a match that straddles two tokens is drawn as two marks, which is correct, because it
 * straddles two different things.
 */

import { matchRanges } from "@lyra/core/trajectory-view";
import { TOKEN_CLASS, tokenizeJson, tokenizeShell, type Token } from "./tokens.ts";

export type CodeKind = "shell" | "json" | "text";

export function CodeText({ text, kind, query = "" }: { text: string; kind: CodeKind; query?: string }) {
	const tokens: Token[] =
		kind === "shell" ? tokenizeShell(text) : kind === "json" ? tokenizeJson(text) : [{ text, kind: "plain" }];

	let offset = 0;
	return (
		<>
			{tokens.map((token, index) => {
				const start = offset;
				offset += token.text.length;
				return <Piece key={index} token={token} query={query} offset={start} />;
			})}
		</>
	);
}

/** One token, with any part of the query inside it marked. */
function Piece({ token, query, offset }: { token: Token; query: string; offset: number }) {
	const className = TOKEN_CLASS[token.kind];
	const ranges = query.trim() ? matchRanges(token.text, query) : [];

	if (ranges.length === 0) {
		return className ? <span className={className}>{token.text}</span> : <>{token.text}</>;
	}

	const parts: React.ReactNode[] = [];
	let at = 0;
	for (const [index, range] of ranges.entries()) {
		if (range.start > at) parts.push(token.text.slice(at, range.start));
		parts.push(
			<mark key={`${offset}-${index}`} className="rounded-[2px] bg-accent/25 text-inherit">
				{token.text.slice(range.start, range.end)}
			</mark>,
		);
		at = range.end;
	}
	if (at < token.text.length) parts.push(token.text.slice(at));

	return <span className={className}>{parts}</span>;
}
