/**
 * Syntax colours for a diff, on top of the change colours rather than instead of them.
 *
 * The two are different questions about the same line — "what kind of code is this" and "did it
 * change" — and they have a channel each: the glyphs carry syntax, the row's tint and rail carry
 * the change. Painting a whole added line green answers the second question twice and the first
 * one not at all, which is how a review ends up being read as three colours of prose.
 *
 * Each hunk is parsed as two passages rather than line by line. A removed line belongs to the
 * old file and an added one to the new, so reassembling each side and parsing it whole is what
 * lets a block comment or a template literal keep its colour across the lines it spans — the
 * case that per-line parsing always gets wrong.
 */

import type { Language } from "@codemirror/language";
import type { DiffHunk } from "@lyra/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { GRAMMARS, highlightGeneration, onHighlightChange, sharedHighlightStyle, type Token, tokenizeLines } from "../../lib/code/highlight.ts";

/** Colours for every rendered row, in render order, or null while nothing can be parsed. */
export function useDiffHighlight(hunks: DiffHunk[], path?: string): Token[][] | null {
	const [lines, setLines] = useState<Token[][] | null>(null);
	// 换代码主题就是换一整套类名，存下来的这份于是指向一批不存在的规则——跟 `CodeBlock` 一样要重算。
	const generation = useSyncExternalStore(onHighlightChange, highlightGeneration, highlightGeneration);

	useEffect(() => {
		const load = path ? GRAMMARS[extensionOf(path)] : undefined;
		if (!load) {
			// A language nothing here can parse — a lockfile, a log — renders as plain text.
			setLines(null);
			return;
		}

		let cancelled = false;
		void load().then((extension) => {
			if (cancelled) return;
			const language = (extension as { language?: Language }).language;
			if (!language) return;
			// Shared, not built here: a second style would generate its own class names and none
			// of them would match the one set of rules that is actually in the document.
			const style = sharedHighlightStyle();
			setLines(highlightHunks(hunks, (code) => tokenizeLines(code, language, style)));
		});

		return () => {
			cancelled = true;
		};
		// oxlint-disable-next-line exhaustive-deps -- `generation` 不出现在函数体里，它就是「重算」的信号
	}, [hunks, path, generation]);

	return lines;
}

function extensionOf(path: string): string {
	return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

/**
 * Rebuild each side of the hunk, colour it, then deal the rows back out in render order.
 *
 * A context line belongs to both passages, so both cursors advance past it. Miss that and every
 * colour after the first change is off by one line — which is the failure worth guarding,
 * because it does not look broken. It looks like the syntax colours are simply wrong.
 *
 * `toLines` is injected rather than imported so this can be tested for that alignment without
 * standing up a grammar and a stylesheet to do it.
 */
export function highlightHunks(hunks: DiffHunk[], toLines: (code: string) => Token[][]): Token[][] {
	const rows: Token[][] = [];

	for (const hunk of hunks) {
		const after = toLines(text(hunk, "remove"));
		const before = toLines(text(hunk, "add"));
		let a = 0;
		let b = 0;

		for (const line of hunk.lines) {
			if (line.type === "add") rows.push(after[a++] ?? []);
			else if (line.type === "remove") rows.push(before[b++] ?? []);
			else {
				rows.push(after[a++] ?? []);
				b += 1;
			}
		}
	}

	return rows;
}

/** One side of the hunk as continuous source: everything except the lines the other side owns. */
function text(hunk: DiffHunk, exclude: "add" | "remove"): string {
	return hunk.lines
		.filter((line) => line.type !== exclude)
		.map((line) => line.text)
		.join("\n");
}
