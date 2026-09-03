/**
 * A row that opens into its own detail, as one object.
 *
 * The panels used to draw this as two things: a highlighted row, then a separate bordered box
 * floating under it at an indent that lined up with nothing. Two shapes, a seam between them, and
 * an inset borrowed from a different component's geometry — which is why it read as stuck on rather
 * than opened.
 *
 * Here the row and its detail are one shape: the row carries the top corners and the side borders,
 * the body continues them and carries the bottom ones. One border, drawn in two halves, so there is
 * no outer box whose radius has to be kept 1px apart from an inner one to stop the corners squaring
 * off — a sum that was wrong the moment either number changed.
 *
 * When it is open the row pins to the top of the panel while its own body scrolls past, so a long
 * detail never leaves you reading output with no idea which step produced it.
 *
 * The pinning is why the row sits in a wrapper it does not obviously need.
 *
 * A rounded corner is only visible when something of a different colour shows through it, and once
 * the row is pinned the thing behind its top corners is its own body — the same fill, so the corners
 * read as square and the side borders appear to run straight off the top edge. The wrapper is the
 * fix: it pins instead of the row, it is opaque in the panel's own colour, and it is square. The row
 * keeps its radius and draws inside it, so the corners show the panel through them whether the card
 * is sitting in the list or pinned halfway up its own contents.
 *
 * It cannot clip, either: `overflow: hidden` on an ancestor makes it the scroll container for
 * anything sticky inside, which would pin the row to a box exactly as tall as the row.
 *
 * And the open card is lifted above its siblings. The enter animation moves the card, which gives
 * every card a stacking context of its own for as long as the transform is retained — and a sticky
 * row inside one of those can never paint above the card that comes after it, however high its own
 * z-index. That is what made a pinned row appear to have the next row's text printed through it.
 */

import { ChevronRight } from "lucide-react";

/** Kept equal on the row's top corners and the body's bottom ones. */
const RADIUS = "9px";

export function DetailCard({
	open,
	onToggle,
	label,
	summary,
	trailing,
	children,
}: {
	open: boolean;
	onToggle: () => void;
	/** A short kind, shown before the summary. Optional: some rows are self-describing. */
	label?: string;
	summary: React.ReactNode;
	/** Duration, sequence number, status dot — whatever belongs at the end of the row. */
	trailing?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className={`ly-enter mb-1 ${open ? "relative z-20" : ""}`}>
			<div className={open ? "ly-pin sticky top-0 z-10" : ""}>
				<button
					type="button"
					onClick={onToggle}
					style={{ borderRadius: open ? `${RADIUS} ${RADIUS} 0 0` : RADIUS }}
					className={`ly-scroll flex w-full items-center gap-2 border px-2 py-[6px] text-left transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover/50 ${
						open ? "border-line-soft bg-card" : "border-transparent"
					}`}
				>
					{label && <span className="shrink-0 text-caption text-ink-faint">{label}</span>}
					<span className="min-w-0 flex-1 truncate text-detail text-ink-muted">{summary}</span>
					{trailing}
					<ChevronRight
						size={12}
						strokeWidth={2}
						className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-base)]"
						style={open ? { transform: "rotate(90deg)" } : undefined}
					/>
				</button>
			</div>

			{open && (
				<div
					className="border border-t-0 border-line-soft bg-card"
					style={{ borderRadius: `0 0 ${RADIUS} ${RADIUS}` }}
				>
					{children}
				</div>
			)}
		</div>
	);
}
