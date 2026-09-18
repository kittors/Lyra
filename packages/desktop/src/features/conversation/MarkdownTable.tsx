/**
 * A table in a reply, and the two things it needs that the markup does not give it.
 *
 * Cells are `white-space: nowrap` — breaking 「一键新机」 across two lines to save eight pixels is
 * worse than scrolling — so a table with more columns than the reading column has pixels is wider
 * than its box. That was already true and already handled: the wrapper scrolls. What it had no way
 * of saying was that it scrolls. Native scrollbars are off everywhere (see `base.css`), so the
 * overflow was silent: a table that ended mid-word looked like a table that ended.
 *
 * So: the app's own thumb along the bottom edge, on hover, and a control that turns the nowrap off
 * for people who would rather read the whole thing at once than drag it into view. Wrapping is per
 * table and not remembered — it is a way to look at *this* one, the same as scrolling it.
 */

import { CornerDownLeft, MoveHorizontal } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { Block } from "../../lib/markdown/blocks.ts";
import { useI18n } from "../../i18n/index.ts";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";

type TableBlock = Extract<Block, { kind: "table" }>;

export function MarkdownTable({
	block,
	inline,
	preview = false,
}: {
	block: TableBlock;
	/**
	 * Cell text to elements, passed in rather than imported.
	 *
	 * It lives in `Markdown.tsx`, which is what renders this — importing it back would be a cycle,
	 * and the renderer is the one that knows how a cell's emphasis and links are drawn.
	 */
	inline: (text: string) => ReactNode;
	/** A bounded, non-interactive excerpt: no thumb, no control, nothing to reach for. */
	preview?: boolean;
}) {
	const { t } = useI18n();
	const viewport = useRef<HTMLDivElement>(null);
	const [wrap, setWrap] = useState(false);
	const [overflow, setOverflow] = useState(false);

	/*
	 * Whether there is anything hidden to the right, watched rather than measured once.
	 *
	 * Two things move it and neither is a render of this component: the pane gets narrower, and — in
	 * a reply still streaming — rows arrive and widen a column. The table itself is observed as well
	 * as the box, for the same reason `Scroller` observes its children: the box is a block whose
	 * width comes from the layout above it, so it does not resize when its contents do.
	 */
	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		const measure = () => setOverflow(el.scrollWidth - el.clientWidth > 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		return () => observer.disconnect();
	}, []);

	const control = !preview && (overflow || wrap);
	const label = t(wrap ? "markdown.tableNowrap" : "markdown.tableWrap");

	return (
		<div className="ly-table group relative" data-wrap={wrap ? "true" : "false"} data-control={control ? "true" : undefined}>
			{/*
			 * Same seat as the copy control on a fenced block: top-right of the frame, out of
			 * flow. A reserved strip or a gutter rail both changed the table's proportions.
			 * The corner wash is the fence's `pt-7` turned sideways, so a header never sits
			 * under the icon.
			 */}
			{control && (
				<span className="ly-table-corner">
					<button
						type="button"
						aria-label={label}
						aria-pressed={wrap}
						data-ly-tip={label}
						className="ly-table-toggle"
						onClick={() => setWrap((on) => !on)}
					>
						{wrap ? <MoveHorizontal size={13} strokeWidth={1.9} /> : <CornerDownLeft size={13} strokeWidth={1.9} />}
					</button>
				</span>
			)}
			<div ref={viewport} className="ly-table-scroll">
				<table>
					<thead>
						<tr>
							{block.header.map((cell, index) => (
								<th key={index} style={{ textAlign: block.align[index] ?? "left" }}>
									{inline(cell)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{block.rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{row.map((cell, cellIndex) => (
									<td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? "left" }}>
										{inline(cell)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{!preview && <OverlayScrollbar viewport={viewport} orientation="horizontal" />}
		</div>
	);
}
