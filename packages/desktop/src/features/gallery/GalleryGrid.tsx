/**
 * The album: a heading per day, and under it rows of pictures at their own shape (`justify`).
 */

import { Layers, Play } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { aspectOf, byDay, justify } from "../../lib/gallery-layout.ts";
import { familyOf } from "../../lib/lineage-tree.ts";
import { isVideo, MediaStill } from "./MediaStill.tsx";
import { askText, type Entry, type GalleryIndex } from "./model.ts";

/** Longest edge of a tile's picture: sharp at 2× in the tallest row a tile gets, a fraction of the original's bytes. */
export const TILE_THUMB = 800;
const GAP = 8;

type Drawn = Extract<Entry, { kind: "drawn" }>;

export function GalleryGrid({ entries, index, compact, onOpen }: { entries: Drawn[]; index: GalleryIndex; compact: boolean; onOpen: (media: string, tile: HTMLElement) => void }) {
	const { t, formatDate } = useI18n();
	const box = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver(() => setWidth(el.clientWidth));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const sections = useMemo(() => byDay(entries, (entry) => entry.at), [entries]);
	// How many pictures each one's history holds, for the mark on its tile. One family is one walk.
	const families = useMemo(() => {
		const sizes = new Map<string, number>();
		for (const entry of entries) {
			if (sizes.has(entry.media)) continue;
			const family = familyOf(entry.media, index.nodes);
			for (const member of family) sizes.set(member.id, family.length);
		}
		return sizes;
	}, [entries, index.nodes]);

	const today = new Date();
	const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	const heading = (day: number) => {
		if (day === midnight) return t("gallery.today");
		if (day === midnight - 86_400_000) return t("gallery.yesterday");
		const sameYear = new Date(day).getFullYear() === today.getFullYear();
		return formatDate(day, sameYear ? { month: "long", day: "numeric", weekday: "short" } : { year: "numeric", month: "long", day: "numeric" });
	};

	return (
		<div ref={box} data-ly-gallery-grid="" className="w-full">
			{width > 0 &&
				sections.map((section) => {
					const rows = justify(
						section.items.map((entry) => aspectOf(entry)),
						width,
						{ target: compact ? 150 : 220, gap: GAP },
					);
					return (
						<section key={section.day} data-ly-gallery-day={section.day} className="pt-5">
							<h2 className="mb-2.5 flex items-baseline gap-2 text-label font-medium text-ink">
								{heading(section.day)}
								<span className="text-caption font-normal text-ink-faint tabular-nums">{section.items.length}</span>
							</h2>
							<div className="flex flex-col" style={{ gap: GAP }}>
								{rows.map((row, at) => (
									<div key={at} className="flex" style={{ gap: GAP }}>
										{row.tiles.map((tile) => {
											const entry = section.items[tile.index];
											return (
												<Tile
													key={entry.media}
													entry={entry}
													width={tile.width}
													height={tile.height}
													family={families.get(entry.media) ?? 1}
													session={index.sessions.get(entry.sessionId)?.title ?? ""}
													onOpen={onOpen}
												/>
											);
										})}
									</div>
								))}
							</div>
						</section>
					);
				})}
		</div>
	);
}

const Tile = memo(function Tile({
	entry,
	width,
	height,
	family,
	session,
	onOpen,
}: {
	entry: Drawn;
	width: number;
	height: number;
	family: number;
	session: string;
	onOpen: (media: string, tile: HTMLElement) => void;
}) {
	const { t } = useI18n();
	const [loaded, setLoaded] = useState(false);
	const words = askText(entry) || entry.prompt;
	return (
		<button
			type="button"
			data-ly-gallery-tile={entry.media}
			aria-label={words}
			onClick={(event) => onOpen(entry.media, event.currentTarget)}
			className="ly-gallery-tile group/tile relative shrink-0 overflow-hidden rounded-[10px] bg-card"
			style={{ width, height }}
		>
			<MediaStill
				media={entry.media}
				mimeType={entry.mimeType}
				edge={TILE_THUMB}
				loaded={loaded}
				onLoad={() => setLoaded(true)}
				className="ly-gallery-picture size-full object-cover"
			/>
			{isVideo(entry) && (
				<span className="ly-gallery-chip" data-side="end" aria-hidden>
					<Play size={10} strokeWidth={2.4} className="fill-current" />
					{entry.seconds ? <span className="tabular-nums">{entry.seconds}s</span> : null}
				</span>
			)}
			{family > 1 && (
				<span className="ly-gallery-chip" data-ly-tip={t("gallery.chainTip", { n: family })} aria-label={t("gallery.chainTip", { n: family })}>
					<Layers size={11} strokeWidth={2} />
					<span className="tabular-nums">{family}</span>
				</span>
			)}
			<span aria-hidden className="ly-gallery-caption">
				<span className="line-clamp-2 text-detail leading-snug">{words}</span>
				{session && <span className="mt-0.5 block truncate text-caption opacity-70">{session}</span>}
			</span>
		</button>
	);
});
