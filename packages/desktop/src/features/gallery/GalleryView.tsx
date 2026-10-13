/**
 * 画廊：每个对话里画过的图，像相册一样按天排开；点一张，看它是怎么一步步变成这样的。
 *
 * The grid stays mounted under an open picture, so closing it lands back where you were scrolled to,
 * and the picture can fly back into the very tile it came from.
 */

import { Images } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLayout } from "../../app/layout.tsx";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { SkeletonBar } from "../../ui/primitives/Skeleton.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { GalleryDetail } from "./GalleryDetail.tsx";
import { GalleryGrid } from "./GalleryGrid.tsx";
import { indexGallery, matches } from "./model.ts";
import { openPicture, refreshGallery, setGalleryQuery, useGallery } from "./store.ts";

/** Asks for the list again when a picture lands anywhere, when a conversation in it is renamed or goes. */
function useLiveGallery(): void {
	useEffect(() => {
		void refreshGallery();
		/*
		 * A drawing's `tool_end` arrives before its result is written; the write is announced right after
		 * as a change to that conversation. Read on the change, so the read finds the record.
		 */
		const drawing = new Set<string>();
		const offEvent = bridge.agent.onEvent(({ sessionId, event }) => {
			if (event.type === "tool_end" && (event.toolName === "image_generate" || event.toolName === "video_generate") && !event.isError) drawing.add(sessionId);
		});
		const offChange = bridge.sessions.onChanged((change) => {
			const known = useGallery.getState().gallery?.sessions.find((session) => session.id === change.id);
			const drawn = drawing.delete(change.id);
			const renamed = known && (!change.meta || change.meta.title !== known.title || Boolean(change.meta.archived) !== known.archived);
			if (drawn || renamed) void refreshGallery();
		});
		return () => {
			offEvent();
			offChange();
		};
	}, []);
}

/**
 * Read the list before the first visit, so it opens on the album rather than its skeleton. The rail
 * asks when the pointer reaches its button; every visit reads again on its own, so only a first is
 * worth starting early.
 */
export function warmGallery(): void {
	if (!useGallery.getState().gallery) void refreshGallery();
}

/**
 * Where an open picture is drawn: over the window's whole panel when the window has one beside the
 * rail, so the picture gets the room the sidebar would take if it were opened there. The rail stays
 * out of it, and with it every way to somewhere else. In a narrow window it covers the gallery's own
 * page, the strip it keeps clear at the top included — that strip only spaces the heading.
 */
function useDetailHost(root: React.RefObject<HTMLElement | null>): HTMLElement | null {
	const { framed, compact } = useLayout();
	const [host, setHost] = useState<HTMLElement | null>(null);
	useLayoutEffect(() => {
		setHost(framed && !compact ? document.querySelector<HTMLElement>("[data-ly-frame-panel]") : (root.current?.closest<HTMLElement>("[data-ly-solo-screen]") ?? null));
	}, [framed, compact, root]);
	return host;
}

export function GalleryView() {
	const { t } = useI18n();
	const { compact } = useLayout();
	const here = useApp((state) => state.view === "gallery");
	const page = useRef<HTMLDivElement>(null);
	const host = useDetailHost(page);
	const gallery = useGallery((state) => state.gallery);
	const status = useGallery((state) => state.status);
	const error = useGallery((state) => state.error);
	const query = useGallery((state) => state.query);
	const open = useGallery((state) => state.open);
	useLiveGallery();

	const index = useMemo(() => (gallery ? indexGallery(gallery) : null), [gallery]);
	const shown = useMemo(() => (index ? index.drawn.filter((entry) => matches(entry, index.sessions.get(entry.sessionId), query)) : []), [index, query]);
	/**
	 * The tile a picture was opened from, for the flight in. Only for that picture and only once: coming
	 * back to the gallery to a picture still open is not a click on its tile, and should not look like one.
	 */
	const [origin, setOrigin] = useState<{ media: string; tile: HTMLElement } | null>(null);
	const scroller = useRef<HTMLDivElement>(null);

	const opened = open && index?.byMedia.get(open);
	// A picture whose conversation was deleted while it was open has nothing left to show.
	useEffect(() => {
		if (open && index && !index.byMedia.has(open)) openPicture(null);
	}, [open, index]);

	return (
		<div ref={page} data-ly-gallery="" className="relative flex min-h-0 flex-1 flex-col">
			{/* Under an open picture the album is still laid out — the picture flies back into it — but takes no keys. */}
			<div inert={Boolean(opened)} className="flex min-h-0 flex-1 flex-col">
			<Scroller scrollRef={scroller} className="flex-1" contentClassName={`mx-auto w-full max-w-[1320px] pt-6 pb-10 ${compact ? "px-4" : "px-8"}`}>
				<header className="flex flex-wrap items-end justify-between gap-3 pb-2">
					<div className="min-w-0">
						<h1 className="text-heading leading-tight font-semibold tracking-tight text-ink">{t("gallery.title")}</h1>
						<p className="mt-1.5 text-label text-ink-muted" data-ly-gallery-count="">
							{index ? t("gallery.count", { n: index.drawn.length }) : " "}
						</p>
					</div>
					{index && index.drawn.length > 0 && (
						<SearchField value={query} onChange={setGalleryQuery} placeholder={t("gallery.search")} className="w-[240px] max-w-full" onEscape={() => setGalleryQuery("")} />
					)}
				</header>
				{!index && status !== "error" && <GallerySkeleton compact={compact} />}
				{!index && status === "error" && (
					<div className="flex flex-col items-center gap-3 py-24 text-center">
						<p className="text-label text-ink-muted">{t("gallery.loadFailed", { reason: error })}</p>
						<Button size="sm" onClick={() => void refreshGallery()}>
							{t("common.retry")}
						</Button>
					</div>
				)}
				{index && index.drawn.length === 0 && (
					<div data-ly-gallery-empty="" className="flex flex-col items-center gap-2 py-28 text-center">
						<Images size={28} strokeWidth={1.5} className="mb-2 text-ink-faint" />
						<p className="text-body text-ink">{t("gallery.empty")}</p>
						<p className="max-w-[360px] text-label leading-relaxed text-ink-muted">{t("gallery.emptyHint")}</p>
					</div>
				)}
				{index && index.drawn.length > 0 && shown.length === 0 && <p className="py-24 text-center text-label text-ink-muted">{t("gallery.noMatch")}</p>}
				{index && shown.length > 0 && (
					<GalleryGrid
						entries={shown}
						index={index}
						compact={compact}
						onOpen={(media, tile) => {
							setOrigin({ media, tile });
							openPicture(media);
						}}
					/>
				)}
			</Scroller>
			</div>
			{opened &&
				index &&
				here &&
				(() => {
					const detail = (
						<GalleryDetail
							entry={opened}
							index={index}
							order={shown}
							origin={origin?.media === opened.media ? origin.tile : null}
							onArrived={() => setOrigin(null)}
							onClose={() => {
								openPicture(null);
								setOrigin(null);
							}}
						/>
					);
					return host?.isConnected ? createPortal(detail, host) : detail;
				})()}
		</div>
	);
}

/** The shape of the page while the first read is out: a heading's height, then two rows of tiles. */
function GallerySkeleton({ compact }: { compact: boolean }) {
	const { t } = useI18n();
	const widths = compact ? [160, 120, 150] : [220, 300, 220, 170, 260];
	return (
		<div role="status" aria-label={t("common.loading")} className="pt-6">
			<SkeletonBar width="64px" height={12} className="mb-3" />
			{[0, 1].map((row) => (
				<div key={row} className="mb-2 flex gap-2">
					{widths.map((width, index) => (
						<span key={index} className="ly-skeleton block rounded-[10px]" style={{ width, height: compact ? 140 : 200, flex: `${width} 1 0` }} />
					))}
				</div>
			))}
		</div>
	);
}
