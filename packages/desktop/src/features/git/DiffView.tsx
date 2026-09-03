import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DiffHunk } from "@lyra/core";
import { useDiffHighlight } from "./diff-highlight.ts";

/**
 * Unified diff: a gutter of line numbers, a green rail on additions and a red rail on removals,
 * and the code itself syntax-coloured underneath both.
 *
 * The two colour systems answer different questions and do not compete — the row's tint and rail
 * say whether a line changed, the glyphs say what the line is. This used to paint whole added
 * lines green and whole removed lines red, which said "changed" a second time in the one channel
 * that could have carried syntax, and left a review to be read as three colours of prose. The
 * tint alone already marks the change; nothing is lost by letting the text mean something else.
 *
 * Long lines scroll sideways, and that is the whole reason for the layering here. The rows sit
 * on a layer as wide as the longest line, so a tint or a separator runs the full length of what
 * it belongs to instead of stopping at the fold. The line numbers and the rail are pinned to the
 * left edge, because the moment a line is long enough to need scrolling is the moment you most
 * want to know which line you are on. Everything that is metadata rather than code — the hunk
 * headers, the truncation notice — is pinned as well, since scrolling it away helps nobody.
 */
export function DiffView({
	hunks,
	path,
	showPath = false,
	maxLines = 600,
}: {
	hunks: DiffHunk[];
	/**
	 * Which file this is, which is two separate things it is needed for.
	 *
	 * The grammar comes from its extension, so a diff without a path can only be plain text —
	 * and this used to be passed only where the path was also being *displayed*, which is why
	 * a review had no syntax colours while the same patch in a tool card did. Whether to draw
	 * the header is `showPath`, and it is a question about layout, not about the file.
	 */
	path?: string;
	/** Draw the path above the hunks. Off where the caller already shows it on its own row. */
	showPath?: boolean;
	maxLines?: number;
}) {
	let emitted = 0;
	const scroller = useRef<HTMLDivElement>(null);
	// Null until the grammar has loaded, and for anything there is no grammar for. Rows fall back
	// to plain text in both cases, so a diff is never waiting on a parser to be readable.
	const coloured = useDiffHighlight(hunks, path);

	return (
		<div className="ly-diff-host relative">
			{/* `text-code`, not the UI scale: this is code, and it follows 代码字号 like every other
			    place code is read. It used to be a UI step with a hand-written leading on top, so
			    the same patch came out one size in a review and another in a chat transcript. */}
			<div ref={scroller} className="ly-diff-scroll overflow-x-auto font-mono text-code">
				<div className="w-max min-w-full">
					{showPath && path && (
						<div className="sticky left-0 w-max border-b border-line-soft px-3 py-1.5 text-caption text-ink-faint">
							{path}
						</div>
					)}

					{hunks.map((hunk, hunkIndex) => (
						<div key={hunkIndex} className="border-b border-line-soft last:border-b-0">
							{hunkIndex > 0 && (
								<div className="sticky left-0 w-max bg-panel/60 px-3 py-0.5 text-caption text-ink-faint">
									@@ -{hunk.oldStart} +{hunk.newStart} @@
								</div>
							)}

							{hunk.lines.map((line, lineIndex) => {
								if (emitted >= maxLines) return null;
								// The colours are generated in the same order these rows are drawn, so
								// the running count doubles as the index into them.
								const tokens = coloured?.[emitted];
								emitted += 1;
								const added = line.type === "add";
								const removed = line.type === "remove";
								return (
									<div
										key={lineIndex}
										className={`flex ${added ? "ly-diff-add bg-ok/8" : removed ? "ly-diff-remove bg-danger/8" : ""}`}
									>
										{/* Pinned columns need an opaque fill of their own: the row's tint is
										    translucent, and the code would otherwise show through as it passes. */}
										<span className="ly-diff-gutter sticky left-0 z-[1] w-[42px] shrink-0 pr-2 text-right text-ink-faint/70 select-none">
											{line.newLine ?? line.oldLine ?? ""}
										</span>
										<span
											className={`sticky left-[42px] z-[1] w-[3px] shrink-0 ${
												added ? "bg-ok/70" : removed ? "bg-danger/70" : "ly-diff-rail"
											}`}
										/>
										{/*
										 * Coloured by grammar when there is one, by change type when there
										 * is not — an unparseable file still has to read as a diff.
										 */}
										<span
											className={`shrink-0 px-2.5 whitespace-pre ${
												tokens ? "text-ink" : added ? "text-ok" : removed ? "text-danger/90" : "text-ink-muted"
											}`}
										>
											{tokens?.length
												? tokens.map((token, index) => (
														// biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
														<span key={index} className={token.className}>
															{token.text}
														</span>
													))
												: line.text || " "}
										</span>
									</div>
								);
							})}
						</div>
					))}

					{emitted >= maxLines && (
						<div className="sticky left-0 w-max px-3 py-1.5 text-caption text-ink-faint">
							… 差异过长，已截断显示
						</div>
					)}
				</div>
			</div>

			<HorizontalThumb viewport={scroller} />
		</div>
	);
}

/**
 * A sideways scrollbar, drawn rather than native.
 *
 * macOS hides overlay scrollbars until something moves, which on a diff is exactly backwards:
 * a long line that runs off the edge with no visible bar reads as truncated, and there is no
 * other cue, because nothing shifts until you already know to scroll. This stays put whenever
 * there is more to the right, and matches the overlay thumb the rest of the app draws.
 */
function HorizontalThumb({ viewport }: { viewport: React.RefObject<HTMLDivElement | null> }) {
	const track = useRef<HTMLDivElement>(null);
	const drag = useRef<{ startX: number; startLeft: number } | null>(null);
	const [metrics, setMetrics] = useState({ left: 0, width: 0, overflow: false });
	const [active, setActive] = useState(false);

	const measure = useCallback(() => {
		const el = viewport.current;
		if (!el) return;
		const { scrollLeft, scrollWidth, clientWidth } = el;
		const overflow = scrollWidth - clientWidth > 1;
		// Reserves the strip the thumb sits in, so it never covers the last line of code.
		el.dataset.hscroll = overflow ? "on" : "off";
		const width = overflow ? Math.max(32, (clientWidth / scrollWidth) * clientWidth) : 0;
		const travel = clientWidth - width;
		const progress = scrollWidth - clientWidth <= 0 ? 0 : scrollLeft / (scrollWidth - clientWidth);
		setMetrics({ left: travel * progress, width, overflow });
	}, [viewport]);

	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		if (el.firstElementChild) observer.observe(el.firstElementChild);
		return () => {
			el.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [measure, viewport]);

	useEffect(() => {
		if (!active) return;
		const onMove = (event: MouseEvent) => {
			const el = viewport.current;
			const state = drag.current;
			if (!el || !state) return;
			const travel = el.clientWidth - metrics.width;
			if (travel <= 0) return;
			const ratio = (event.clientX - state.startX) / travel;
			el.scrollLeft = state.startLeft + ratio * (el.scrollWidth - el.clientWidth);
		};
		const onUp = () => {
			drag.current = null;
			setActive(false);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [active, metrics.width, viewport]);

	if (!metrics.overflow) return null;

	return (
		<div
			ref={track}
			/*
			 * Sticky, not absolute, and relative to the vertical scroller outside this component.
			 *
			 * A diff can be hundreds of rows long; pinned to the bottom of the content it would
			 * only come into view once you had already scrolled past everything it was meant to
			 * help you read. The negative margin lets it sit on the strip the rows reserve at the
			 * end rather than adding height of its own.
			 */
			className="sticky bottom-0 z-[2] -mt-[10px] h-[10px]"
			onMouseDown={(event) => {
				if (event.target !== track.current) return;
				const el = viewport.current;
				if (!el || !track.current) return;
				const rect = track.current.getBoundingClientRect();
				const travel = el.clientWidth - metrics.width;
				const ratio = (event.clientX - rect.left - metrics.width / 2) / Math.max(1, travel);
				el.scrollLeft = Math.min(1, Math.max(0, ratio)) * (el.scrollWidth - el.clientWidth);
			}}
		>
			{/* Hidden from assistive technology: the diff viewport underneath is what scrolls. */}
			<div
				aria-hidden
				tabIndex={-1}
				onMouseDown={(event) => {
					event.preventDefault();
					const el = viewport.current;
					if (!el) return;
					drag.current = { startX: event.clientX, startLeft: el.scrollLeft };
					setActive(true);
				}}
				style={{ left: metrics.left, width: metrics.width }}
				className={`ly-hthumb absolute bottom-[2px] h-[6px] rounded-full bg-ink-faint ${active ? "ly-hthumb-active" : ""}`}
			/>
		</div>
	);
}
