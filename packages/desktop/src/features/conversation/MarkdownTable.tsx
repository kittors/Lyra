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
import { IconButton } from "../../ui/primitives/IconButton.tsx";
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

	return (
		<div className="ly-table" data-wrap={wrap ? "true" : "false"}>
			{/*
			 * A strip of its own inside the frame, above the box that scrolls.
			 *
			 * The control has to be reachable at the table's top right and it must never sit on a
			 * cell — and anywhere *inside* the scrolling box those two are in conflict, because the
			 * content slides under whatever is pinned there. Empty at the left edge, over 「一键新机
			 * 后的合理行为」 two hundred pixels along. So the strip is outside the scroller and
			 * inside the frame: it holds still, and nothing ever passes beneath it.
			 *
			 * Reserved whether or not the pointer is here. Giving it height on hover would make the
			 * table jump down the page as you approached it.
			 */}
			{control && (
				<div className="ly-table-bar">
					{/*
					 * The fade lives on this wrapper, not on the button.
					 *
					 * `IconButton` carries `transition-colors` as a Tailwind utility, and utilities
					 * outrank `@layer components` whatever the selector — so a `transition: opacity`
					 * written for the button in the stylesheet is replaced by one that does not list
					 * opacity, and the control appears as a hard cut. A plain element the utilities do
					 * not touch is where the transition can live.
					 */}
					<span className="ly-table-toggle">
						<IconButton
							size="sm"
							label={t(wrap ? "markdown.tableNowrap" : "markdown.tableWrap")}
							active={wrap}
							/* 「↵」 for the break itself and 「↔」 for the sideways scrolling it replaces —
							   two strokes each, which is what stays legible at 13px. */
							icon={wrap ? <MoveHorizontal size={13} strokeWidth={2} /> : <CornerDownLeft size={13} strokeWidth={2} />}
							onClick={() => setWrap((on) => !on)}
						/>
					</span>
				</div>
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
