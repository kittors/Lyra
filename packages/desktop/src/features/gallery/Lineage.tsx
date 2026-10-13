/**
 * A picture's history, top to bottom: every picture it went through, in one column, with what was said.
 *
 * The geometry is `lineageTree`'s: the pictures never leave their column, an edit listed right under
 * its picture hangs off it by a short line, and every other link runs down the gutter on the left and
 * turns into the picture it led to. The links that led to the picture on the stage are drawn in the
 * accent, so its own story reads first however many branches the family has.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { sessionMediaUrl, SESSION_THUMB_EDGE } from "../../../shared/session-image.ts";
import { useI18n } from "../../i18n/index.ts";
import { familyOf, lineageTree, type TreeLink } from "../../lib/lineage-tree.ts";
import { askText, type Entry, type GalleryIndex } from "./model.ts";

const ROW = 64;
const THUMB = 44;
const TOP = (ROW - THUMB) / 2;
/** Lines stop short of the pictures: they join two pictures without touching either, or the ring round the current one. */
const CLEAR = 4;
const RADIUS = 5;
/** Between two gutter lanes, and from the column to the first. */
const LANE = 9;
const FIRST = 11;
/** The highlight starts this far before the picture, so the gutter's lines stay outside it. */
const INSET = 6;

export function useFamily(media: string, index: GalleryIndex) {
	return useMemo(() => familyOf(media, index.nodes), [media, index.nodes]);
}

export function Lineage({ current, index, onSelect }: { current: string; index: GalleryIndex; onSelect: (media: string) => void }) {
	const { t, formatDate } = useI18n();
	const family = useFamily(current, index);
	const { order, links, lanes } = useMemo(() => lineageTree(family, current), [family, current]);
	// Where the column of pictures starts: past the gutter when there is one, and never flush with the highlight's edge.
	const column = lanes > 0 ? FIRST + 3 + (lanes - 1) * LANE : INSET;
	const list = useRef<HTMLOListElement>(null);
	// The picture on the stage is kept in view as it changes; a long history scrolls under it.
	useLayoutEffect(() => {
		list.current?.querySelector<HTMLElement>("[aria-current='step']")?.scrollIntoView({ block: "nearest" });
	}, [current]);

	return (
		<ol ref={list} data-ly-lineage="" className="relative" style={{ height: order.length * ROW }}>
			{order.map((node) => {
				const entry = index.byMedia.get(node.id) as Entry;
				const active = node.id === current;
				/*
				 * A picture put in rather than drawn says what it is, not what was asked: the message that
				 * carried it is the instruction for the next step, and saying it twice reads as two requests.
				 */
				const words = entry.kind === "given" ? (entry.from ? t("gallery.markedStep") : t("gallery.givenStep")) : askText(entry) || t("gallery.noWords");
				const kind = entry.kind === "given" ? "" : entry.sources.length || entry.untraced ? t("gallery.edited") : t("gallery.drawn");
				const meta = [
					kind,
					formatDate(entry.at, { hour: "2-digit", minute: "2-digit" }),
					entry.kind === "drawn" && entry.count > 1 ? `${entry.index + 1}/${entry.count}` : "",
					entry.kind === "drawn" && entry.untraced > 0 && entry.sources.length === 0 ? t("gallery.untraced") : "",
				]
					.filter(Boolean)
					.join(" · ");
				return (
					<li key={node.id} style={{ height: ROW, paddingLeft: column - INSET }}>
						<button
							type="button"
							data-ly-lineage-step={node.id}
							aria-current={active ? "step" : undefined}
							data-ly-tip={words}
							onClick={() => onSelect(node.id)}
							className={`ly-lineage-step flex h-full w-full items-center gap-3 rounded-[10px] pr-3 text-left transition-colors duration-[var(--ly-t-quick)] ${
								active ? "bg-card-hover" : "hover:bg-card-hover/60"
							}`}
							style={{ paddingLeft: INSET }}
						>
							<img
								src={sessionMediaUrl(node.id, SESSION_THUMB_EDGE)}
								alt=""
								draggable={false}
								className={`shrink-0 rounded-[8px] bg-card object-cover ${active ? "ly-lineage-current" : ""}`}
								style={{ width: THUMB, height: THUMB }}
							/>
							<span className="min-w-0 flex-1">
								<span data-ly-lineage-words="" className={`block truncate text-label ${entry.kind === "drawn" ? "text-ink" : "text-ink-muted"}`}>
									{words}
								</span>
								<span data-ly-lineage-meta="" className="mt-0.5 block truncate text-caption text-ink-faint">
									{meta}
								</span>
							</span>
						</button>
					</li>
				);
			})}
			<Links links={links} column={column} rows={order.length} />
		</ol>
	);
}

/** Every link as one path; the ones that led to the picture on the stage drawn last, on top, in the accent. */
function Links({ links, column, rows }: { links: TreeLink[]; column: number; rows: number }) {
	if (links.length === 0) return null;
	const middle = (row: number) => row * ROW + ROW / 2;
	const centre = column + THUMB / 2;
	const edge = column - CLEAR;
	const draw = (link: TreeLink) => {
		if (link.lane === null) return `M ${centre} ${link.from * ROW + TOP + THUMB + CLEAR} V ${link.to * ROW + TOP - CLEAR}`;
		const x = column - FIRST - link.lane * LANE;
		const top = middle(link.from);
		const bottom = middle(link.to);
		// Out of the left edge, round the corner, down the gutter, round again and into the left edge.
		return `M ${edge} ${top} H ${x + RADIUS} Q ${x} ${top} ${x} ${top + RADIUS} V ${bottom - RADIUS} Q ${x} ${bottom} ${x + RADIUS} ${bottom} H ${edge}`;
	};
	const quiet = links.filter((link) => !link.onPath).map(draw);
	const path = links.filter((link) => link.onPath).map(draw);
	return (
		<svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={column + THUMB} height={rows * ROW}>
			{quiet.length > 0 && <path d={quiet.join(" ")} className="ly-lineage-line" />}
			{path.length > 0 && <path d={path.join(" ")} className="ly-lineage-line" data-on-path="" />}
		</svg>
	);
}
