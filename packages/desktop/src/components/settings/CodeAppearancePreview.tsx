/**
 * What code will look like, under every setting on this page.
 *
 * It carries the typography as well as the palette, because those are the settings people actually
 * hesitate over — a weight or a line height is not something anyone can picture from a number, and
 * a preview that ignored them showed the same specimen whatever you moved.
 *
 * Three rules follow from where it sits, which is in the middle of a settings page:
 *
 *   - Its height is fixed. It is a *specimen*, and one that grows when you widen the leading pushes
 *     the very controls you are reaching for down the page — you move a control, the row moves out
 *     from under the pointer, and the effect you were judging is buried under the movement it
 *     caused. Whatever does not fit scrolls, on this app's own thumb.
 *   - You type straight into it. There used to be a pencil button that switched the box into an
 *     edit mode, which is a step asking permission for something that should just be true: the
 *     stock three lines answer "how does this look" and not "how does *my* code look", which is
 *     the question anyone choosing a mono face is actually asking.
 *   - What you type stays highlighted. The old edit mode dropped the colours, so the moment the
 *     specimen became yours it stopped showing you the thing you came to compare — which is the
 *     palette. A transparent textarea sits over a coloured render of the same text, both set with
 *     the same metrics, so the caret is real and the colours are real.
 */

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeThemeSpec } from "../../lib/code/themes.ts";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";
import { highlightPieces, type Piece } from "./preview-highlight.ts";

export interface CodeTypography {
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: number;
	lineHeight?: number;
	/** In `em`, so it tracks the size. */
	letterSpacing?: number;
}

/**
 * How tall a specimen box is, whatever is in it.
 *
 * Enough for the stock sample at the loosest leading and the largest size this page offers, so the
 * common case never scrolls; anything longer, or anything you paste in, does.
 */
const BOX_HEIGHT = 168;

/**
 * The stock specimen: a signature, a type, a string, a comment and a template literal.
 *
 * Chosen so that every one of the eleven colours a theme declares has something to land on —
 * a sample that exercises four of them makes two themes look more alike than they are.
 */
const SAMPLE = `// 把名字招呼一下
function greet(name: string): string {
  const times = 2;
  return \`Hello, \${name}!\`.repeat(times);
}`;

/**
 * The two lines the diff colours are shown on, keyed by their index in the sample.
 *
 * The added and removed backgrounds are part of a theme and nothing else on this page shows them,
 * so the specimen carries a one-line change. Only while the stock text is showing: your own code
 * is not a diff, and tinting two arbitrary lines of it would be noise.
 */
const DIFF_ROWS: Record<number, "add" | "remove"> = { 2: "remove", 3: "add" };

export function CodeAppearancePreview({
	lightTheme,
	darkTheme,
	type,
}: {
	lightTheme: CodeThemeSpec;
	darkTheme: CodeThemeSpec;
	type: CodeTypography;
}) {
	/*
	 * One draft for both boxes.
	 *
	 * They are two renderings of the same specimen — the point is to compare the palettes, and
	 * editing one to find the other still showing the old text would defeat that.
	 */
	const [draft, setDraft] = useState<string | null>(null);
	const code = draft ?? SAMPLE;

	/*
	 * Parsed once for both boxes, not once each.
	 *
	 * The colouring differs between them; the parse does not. Doing it per box would run the
	 * TypeScript grammar twice on every keystroke for a result that is identical both times.
	 */
	const [pieces, setPieces] = useState<Piece[]>([{ text: SAMPLE, token: null }]);
	useEffect(() => {
		let live = true;
		void highlightPieces(code, "ts").then((next) => {
			if (live) setPieces(next);
		});
		return () => {
			live = false;
		};
	}, [code]);

	return (
		<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
			<CodeSnippetBox
				theme={lightTheme}
				type={type}
				label="浅色预览"
				code={code}
				pieces={pieces}
				stock={draft === null}
				onDraft={setDraft}
			/>
			<CodeSnippetBox
				theme={darkTheme}
				type={type}
				label="深色预览"
				code={code}
				pieces={pieces}
				stock={draft === null}
				onDraft={setDraft}
			/>
		</div>
	);
}

function CodeSnippetBox({
	theme,
	type,
	label,
	code,
	pieces,
	stock,
	onDraft,
}: {
	theme: CodeThemeSpec;
	type: CodeTypography;
	label: string;
	code: string;
	pieces: Piece[];
	/** Whether the stock sample is showing, which is when the diff rows are drawn. */
	stock: boolean;
	onDraft: (next: string | null) => void;
}) {
	const body = useRef<HTMLDivElement>(null);

	/*
	 * Identical metrics on both layers, or the caret drifts from the glyphs.
	 *
	 * This is the whole trick and the whole risk of overlaying a textarea on a rendered copy:
	 * every property that affects where a character lands has to be stated once and used twice.
	 * `whiteSpace` and `tabSize` are in here for the same reason as the font — a textarea's
	 * defaults for both differ from a `<pre>`'s.
	 */
	const metrics = {
		fontFamily: type.fontFamily || "var(--ly-code-font)",
		fontSize: `${type.fontSize ?? 12}px`,
		fontWeight: type.fontWeight ?? 400,
		lineHeight: type.lineHeight ?? 1.65,
		letterSpacing: `${type.letterSpacing ?? 0}em`,
		whiteSpace: "pre" as const,
		tabSize: 2,
	};

	/** The pieces cut at line breaks, so the diff rows can be drawn as rows. */
	const lines = useMemo(() => splitLines(pieces), [pieces]);

	return (
		<div
			/*
			 * Its own colour scheme, which is what lets two themes sit side by side.
			 *
			 * Anything inside resolving a `light-dark()` — the app's own controls, a scrollbar —
			 * answers to this rather than to the window, so the dark specimen renders dark on a
			 * light settings page.
			 */
			style={{
				backgroundColor: theme.background,
				color: theme.foreground,
				colorScheme: theme.mode,
				fontFamily: metrics.fontFamily,
			}}
			className="group/spec relative overflow-hidden rounded-xl border border-line-soft transition-colors duration-[var(--ly-t-base)]"
		>
			{/*
			 * Header, and the only control on the box.
			 *
			 * 还原 sits *in the row*, to the left of the theme's name, rather than floating over the
			 * corner. Floated, it landed on top of the name — the one piece of text up here anyone
			 * needs to read — and it was the second of two buttons in a place with room for neither.
			 * The pencil that was beside it is gone: the specimen is editable without asking.
			 */}
			<div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-1.5 text-caption opacity-60 dark:border-white/5">
				<span className="font-sans text-[11px] font-medium tracking-wide">{label}</span>
				<div className="flex min-w-0 items-center gap-1.5">
					{!stock && (
						<button
							type="button"
							data-ly-tip="还原示例内容"
							aria-label="还原示例内容"
							onClick={() => onDraft(null)}
							className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/spec:opacity-70 hover:!opacity-100 group-has-[:focus-visible]/spec:opacity-70"
						>
							<RotateCcw size={11} strokeWidth={2} />
						</button>
					)}
					<span className="truncate text-[11px]">{theme.label}</span>
				</div>
			</div>

			<div className="ly-scroll-host relative">
				<div ref={body} className="ly-scroll relative overflow-auto py-2" style={{ height: BOX_HEIGHT }}>
					{/*
					 * The coloured copy, and the textarea over it.
					 *
					 * Both are in the flow at the same size — the render sets the box's dimensions and
					 * the textarea is stretched to match it — so a long line scrolls both together
					 * rather than sliding one under the other.
					 */}
					<div className="relative w-max min-w-full px-3" style={metrics}>
						{lines.map((line, index) => {
							const diff = stock ? DIFF_ROWS[index + 1] : undefined;
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity but their position.
								<div
									key={index}
									className="-mx-3 px-3"
									style={
										diff
											? { backgroundColor: diff === "add" ? theme.addedBg : theme.removedBg }
											: undefined
									}
								>
									{line.length === 0 ? (
										// A blank line still needs height, and an empty div has none.
										<span>{"​"}</span>
									) : (
										line.map((piece, at) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: same.
											<span key={at} style={piece.token ? { color: theme.tokens[piece.token] } : undefined}>
												{piece.text}
											</span>
										))
									)}
								</div>
							);
						})}
						{/*
						 * Transparent text, visible caret, real selection.
						 *
						 * `caretColor` is set from the theme rather than left to inherit, because the
						 * text itself is transparent and a caret that inherited it would be too. The
						 * selection stays visible: `::selection` paints over transparent glyphs.
						 */}
						<textarea
							value={code}
							onChange={(event) => onDraft(event.target.value)}
							spellCheck={false}
							aria-label={`${label}——可以改成你自己的代码`}
							className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent px-3 text-transparent outline-none"
							style={{ ...metrics, caretColor: theme.foreground }}
						/>
					</div>
				</div>
				<OverlayScrollbar viewport={body} orientation="vertical" />
				<OverlayScrollbar viewport={body} orientation="horizontal" />
			</div>
		</div>
	);
}

/**
 * The same runs, cut at line breaks.
 *
 * A token can legitimately span lines — a block comment, a template literal — which is exactly
 * what colouring each line separately gets wrong. Parsing whole and dividing afterwards keeps
 * those spans intact, the same way `tokenizeLines` does for the diff viewer.
 */
function splitLines(pieces: Piece[]): Piece[][] {
	const lines: Piece[][] = [[]];
	for (const piece of pieces) {
		const parts = piece.text.split("\n");
		for (const [index, part] of parts.entries()) {
			if (index > 0) lines.push([]);
			if (part) lines[lines.length - 1].push({ text: part, token: piece.token });
		}
	}
	return lines;
}
