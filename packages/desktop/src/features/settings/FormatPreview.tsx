/**
 * A place to actually try the formatter, not a picture of one.
 *
 * It leads the page because these are settings whose effect nobody can picture from a name —
 * 尾随逗号 has three values and two of them look identical until you see a multi-line call — so
 * the answer belongs above the question, already on screen when you reach the control.
 *
 * It is a sandbox rather than a specimen, which is the difference between showing and letting
 * someone check:
 *
 *   - the code is yours. Type into it, paste a file that formats badly, delete the lot. A fixed
 *     sample answers "what does this option do" and never "what will it do to *my* code", which
 *     is the only question worth opening this page for.
 *   - 格式化 is a button you press. Change an option below, press it again, watch the difference.
 *     Formatting on every keystroke would fight you while you typed.
 *   - it is drawn exactly like the editor: the same `--ly-code-*` surface, the same font, weight,
 *     leading and tracking from 代码外观, the same palette from 代码高亮主题. If it looked like
 *     anything else it would not be a preview of anything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, Wand2 } from "lucide-react";
import type { FormattingSettings } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { findCodeTheme, type CodeThemeSpec } from "../../lib/code/themes.ts";
import { MenuBody, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";
import { formatCode } from "../editor/index.ts";
import { highlightPieces, type Piece } from "./preview-highlight.ts";
import { LANGUAGES, searchLanguages, type LanguageEntry } from "./format-catalog.ts";

/**
 * Fixed height, whatever is in it.
 *
 * Reformatting at a different width changes how many lines the code takes, and a box that resized
 * would move every control below it while you were still holding the arrow key on the one that
 * caused it. Anything longer scrolls, on this app's own thumb.
 */
const BOX_HEIGHT = 260;

export function FormatPreview({ options }: { options: FormattingSettings }) {
	const [entry, setEntry] = useState<LanguageEntry>(() => LANGUAGES[0]);
	/** What is in the box: the language's sample until someone types, then theirs. */
	const [code, setCode] = useState(entry.sample);
	const [edited, setEdited] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [pieces, setPieces] = useState<Piece[]>([]);
	const body = useRef<HTMLDivElement>(null);
	const area = useRef<HTMLTextAreaElement>(null);

	const appearance = useApp((s) => s.settings?.appearance);
	/*
	 * The palette in force, and the surface the editor is actually using.
	 *
	 * Token colours come from the theme; the background and foreground come from the CSS variables
	 * — because the default theme takes those from the app rather than declaring its own, and
	 * reading the spec directly would paint this box a flat white over a window that is not.
	 * See `--ly-code-bg` in `theme.ts`.
	 */
	const theme: CodeThemeSpec = useMemo(() => {
		const dark = document.documentElement.classList.contains("dark");
		return findCodeTheme(dark ? appearance?.codeDarkTheme : appearance?.codeLightTheme, dark ? "dark" : "light");
	}, [appearance?.codeDarkTheme, appearance?.codeLightTheme]);

	/** Switching language throws away an untouched sample and keeps anything typed. */
	const pick = (next: LanguageEntry) => {
		setEntry(next);
		setFailure(null);
		if (!edited) setCode(next.sample);
	};

	const restore = () => {
		setCode(entry.sample);
		setEdited(false);
		setFailure(null);
	};

	const format = useCallback(async () => {
		if (entry.formatter !== "prettier") return;
		try {
			const printed = await formatCode(`sample.${entry.aliases[0]}`, code, options);
			if (printed !== null) {
				setCode(printed);
				setEdited(true);
			}
			setFailure(null);
		} catch (thrown) {
			// The formatter's own message, which names the line. Replacing it with 「格式化失败」
			// would throw away the only useful part — and on a box people paste into, a syntax
			// error is the ordinary case rather than the exceptional one.
			setFailure(thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
		}
	}, [entry, code, options]);

	/* Colouring follows the text; formatting does not. Debounced against typing. */
	useEffect(() => {
		let live = true;
		const timer = setTimeout(() => {
			void highlightPieces(code, entry.key).then((next) => {
				if (live) setPieces(next);
			});
		}, 60);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [code, entry.key]);

	const lines = useMemo(() => splitLines(pieces), [pieces]);

	/*
	 * One set of metrics for both layers.
	 *
	 * The transparent textarea sits over the coloured copy, so every property that decides where a
	 * character lands has to be stated once and used twice — including `whiteSpace` and `tabSize`,
	 * whose defaults differ between a textarea and a div. All of them come from 代码外观, which is
	 * what makes this box change when that page does.
	 */
	const metrics = {
		fontFamily: "var(--ly-code-font)",
		fontSize: "var(--text-code)",
		lineHeight: "var(--text-code--line-height)",
		fontWeight: "var(--text-code--weight)" as unknown as number,
		letterSpacing: "var(--text-code--tracking)",
		whiteSpace: "pre" as const,
		tabSize: options.tabWidth,
	};

	return (
		<div
			className="ly-scroll-host relative overflow-hidden rounded-xl border border-line-soft"
			style={{ background: "var(--ly-code-bg)", color: "var(--ly-code-fg)" }}
		>
			{/*
			 * The controls belong to the box, not to the page above it.
			 *
			 * Outside, they were three unrelated things stacked over a rectangle. In the header they
			 * read as this box's own — the same arrangement 代码外观's specimens use.
			 */}
			<div
				className="flex items-center justify-between gap-2 border-b px-2 py-1.5"
				style={{ borderColor: "color-mix(in srgb, var(--ly-code-fg) 10%, transparent)" }}
			>
				<LanguagePicker entry={entry} onPick={pick} />
				<div className="flex shrink-0 items-center gap-1">
					{edited && (
						<CodeButton onClick={restore} tip="把示例代码放回来">
							<RotateCcw size={11} strokeWidth={2} />
							还原
						</CodeButton>
					)}
					<CodeButton
						onClick={() => void format()}
						disabled={entry.formatter !== "prettier"}
						tip={
							entry.formatter === "prettier"
								? "用下面的设置格式化一遍"
								: entry.formatter === "external"
									? `${entry.label} 交给 ${entry.tool}，在编辑器里按 ⇧⌘F 用它格式化`
									: `${entry.label} 还没有可用的格式化工具`
						}
						primary
					>
						<Wand2 size={11} strokeWidth={2} />
						格式化
					</CodeButton>
				</div>
			</div>

			<div className="relative">
				<div
					ref={body}
					className="ly-scroll relative overflow-auto py-2.5"
					style={{ height: BOX_HEIGHT }}
				>
					<div className="relative w-max min-w-full px-3" style={metrics}>
						{lines.map((line, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity but their position.
							<div key={index}>
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
						))}
						{/*
						 * Transparent text, real caret, real selection.
						 *
						 * `caretColor` is stated because the text itself is transparent and an inherited
						 * caret would be too. Spellcheck off: this is code.
						 */}
						<textarea
							ref={area}
							value={code}
							onChange={(event) => {
								setCode(event.target.value);
								setEdited(true);
								setFailure(null);
							}}
							onKeyDown={(event) => {
								// The same key the editor uses, so the muscle memory is not a lie.
								if (event.key === "F" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									void format();
								}
							}}
							spellCheck={false}
							aria-label="试一段代码，然后按格式化"
							className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent px-3 text-transparent outline-none"
							style={{ ...metrics, caretColor: "var(--ly-code-fg)" }}
						/>
					</div>
				</div>
				<OverlayScrollbar viewport={body} orientation="vertical" />
				<OverlayScrollbar viewport={body} orientation="horizontal" />
			</div>

			{failure && (
				<div
					className="border-t px-3 py-1.5 text-detail text-danger"
					style={{ borderColor: "color-mix(in srgb, var(--ly-code-fg) 10%, transparent)" }}
				>
					{failure}
				</div>
			)}
		</div>
	);
}

/**
 * A button that lives on the code surface.
 *
 * Its colours are mixed from `--ly-code-fg` rather than taken from the app's tokens, because it
 * sits inside the box: `text-ink-faint` is derived from the *window's* background and comes out
 * as a grey smudge on a themed surface.
 */
function CodeButton({
	children,
	onClick,
	tip,
	disabled,
	primary,
}: {
	children: React.ReactNode;
	onClick: () => void;
	tip: string;
	disabled?: boolean;
	primary?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			data-ly-tip={tip}
			className="flex h-[22px] items-center gap-1 rounded-md px-1.5 text-detail transition-colors disabled:cursor-default"
			style={{
				color: disabled
					? "color-mix(in srgb, var(--ly-code-fg) 34%, var(--ly-code-bg))"
					: `color-mix(in srgb, var(--ly-code-fg) ${primary ? 96 : 74}%, var(--ly-code-bg))`,
				backgroundColor: disabled || !primary ? undefined : "color-mix(in srgb, var(--ly-code-fg) 8%, transparent)",
			}}
			onPointerEnter={(event) => {
				if (disabled) return;
				event.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--ly-code-fg) 14%, transparent)";
			}}
			onPointerLeave={(event) => {
				if (disabled) return;
				event.currentTarget.style.backgroundColor = primary
					? "color-mix(in srgb, var(--ly-code-fg) 8%, transparent)"
					: "";
			}}
		>
			{children}
		</button>
	);
}

/**
 * The language, chosen from a searchable list.
 *
 * A plain dropdown of fifty rows is a scroll hunt, and the thing people know is rarely the label —
 * it is the extension, or the tool. So the filter matches all three: 「mts」 finds TypeScript and
 * 「gofmt」 finds Go.
 */
function LanguagePicker({ entry, onPick }: { entry: LanguageEntry; onPick: (next: LanguageEntry) => void }) {
	const menu = usePopover();
	const [query, setQuery] = useState("");
	const found = useMemo(() => searchLanguages(query), [query]);

	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				className="flex h-[24px] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-label transition-colors"
				style={{
					color: "color-mix(in srgb, var(--ly-code-fg) 92%, var(--ly-code-bg))",
					backgroundColor: menu.open ? "color-mix(in srgb, var(--ly-code-fg) 9%, transparent)" : undefined,
				}}
				onPointerEnter={(event) => {
					event.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--ly-code-fg) 7%, transparent)";
				}}
				onPointerLeave={(event) => {
					event.currentTarget.style.backgroundColor = menu.open
						? "color-mix(in srgb, var(--ly-code-fg) 9%, transparent)"
						: "";
				}}
			>
				<span className="max-w-[180px] truncate">{entry.label}</span>
				<span
					className="font-mono text-caption"
					style={{ color: "color-mix(in srgb, var(--ly-code-fg) 50%, var(--ly-code-bg))" }}
				>
					.{entry.aliases[0]}
				</span>
				<ChevronDown size={13} strokeWidth={1.8} style={{ color: "color-mix(in srgb, var(--ly-code-fg) 50%, var(--ly-code-bg))" }} />
			</button>

			{menu.open && (
				<Popover
					anchor={menu.anchor}
					onClose={() => {
						menu.close();
						setQuery("");
					}}
					placement="bottom"
					align="start"
					width={340}
					maxHeight={380}
					label="选择语言"
					header={
						<div className="px-2 pt-2 pb-1.5">
							<SearchField
								value={query}
								onChange={setQuery}
								placeholder="按语言、扩展名或工具搜索"
								autoFocus
								onEscape={() => {
									menu.close();
									setQuery("");
								}}
							/>
						</div>
					}
				>
					<MenuBody>
						{found.length === 0 ? (
							<p className="px-3 py-4 text-center text-detail text-ink-faint">没有匹配的语言</p>
						) : (
							found.map((candidate) => (
								<button
									key={candidate.key}
									type="button"
									role="menuitem"
									onClick={() => {
										onPick(candidate);
										menu.close();
										setQuery("");
									}}
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-card-hover"
								>
									<Check
										size={13}
										strokeWidth={2}
										className={candidate.key === entry.key ? "shrink-0 text-accent" : "shrink-0 opacity-0"}
									/>
									<span className="min-w-0 flex-1 truncate text-label text-ink">{candidate.label}</span>
									{/* Which engine owns it, so the list answers the question people open it to
									    ask rather than making them try each one. */}
									<span className="shrink-0 font-mono text-caption text-ink-faint">
										{candidate.formatter === "prettier"
											? "Prettier"
											: candidate.formatter === "external"
												? candidate.tool
												: "—"}
									</span>
								</button>
							))
						)}
					</MenuBody>
				</Popover>
			)}
		</>
	);
}

/** The runs, cut at line breaks — a comment or a template literal can span them. */
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
