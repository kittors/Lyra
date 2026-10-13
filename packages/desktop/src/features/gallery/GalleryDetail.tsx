/**
 * One picture, large, with its history beside it and a field under it for what to change.
 *
 * Opened from a tile, the picture flies out of the tile onto the stage and back into it on the way
 * out, the way the image viewer opens pictures in a conversation. The tile shows the whole picture
 * (rows keep every picture's shape), so the flight is a plain move and scale with no crop to hide.
 *
 * On the stage the tile's thumbnail is drawn first — it is already decoded — and the full picture
 * fades in over it once it has arrived: a 5504×3072 original takes a moment, and the flight should
 * not wait for it.
 */

import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { useLayout } from "../../app/layout.tsx";
import { useI18n } from "../../i18n/index.ts";
import { aspectOf } from "../../lib/gallery-layout.ts";
import { CopyMark } from "../../ui/layout/CopyMark.tsx";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { DURATION, EASING } from "../../ui/motion/tokens.ts";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useApp } from "../../store/index.ts";
import { openViewer } from "../image/index.ts";
import { editInConversation, showInConversation } from "./actions.ts";
import { EditBar } from "./EditBar.tsx";
import { TILE_THUMB } from "./GalleryGrid.tsx";
import { Lineage, useFamily } from "./Lineage.tsx";
import { drawingFor, type Entry, type GalleryIndex } from "./model.ts";
import { awaitEdit, openPicture } from "./store.ts";

const RADIUS = 12;
const TILE_RADIUS = 10;

/** The largest box of this shape that fits, no bigger than the picture itself. */
function contain(space: { width: number; height: number }, aspect: number, natural?: { width?: number; height?: number }): { width: number; height: number } {
	let width = Math.max(0, Math.min(space.width, space.height * aspect));
	if (natural?.width) width = Math.min(width, natural.width);
	return { width, height: width / aspect };
}

/** Where a box is drawn to sit exactly on another of the same shape: its move and its scale. */
function onto(from: DOMRect, to: DOMRect): { transform: string; scale: number } {
	const scale = from.width / Math.max(1, to.width);
	const dx = from.left + from.width / 2 - (to.left + to.width / 2);
	const dy = from.top + from.height / 2 - (to.top + to.height / 2);
	return { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, scale };
}

/** A tile in the grid, if it is on screen to fly to. */
function tileOf(media: string): HTMLElement | null {
	const tile = document.querySelector<HTMLElement>(`[data-ly-gallery-tile="${CSS.escape(media)}"]`);
	if (!tile) return null;
	tile.scrollIntoView({ block: "nearest" });
	return tile;
}

/** Save the picture as drawn, named by the main process (`electron/media-downloads.ts`). */
function save(src: string): void {
	const link = document.createElement("a");
	link.href = src;
	link.download = "";
	link.click();
}

export function GalleryDetail({
	entry,
	index,
	order,
	origin,
	onArrived,
	onClose,
}: {
	entry: Entry;
	index: GalleryIndex;
	order: Extract<Entry, { kind: "drawn" }>[];
	/** The tile it was opened from, to fly out of; null when it was not just opened from one. */
	origin: HTMLElement | null;
	onArrived: () => void;
	onClose: () => void;
}) {
	const { t, formatDate } = useI18n();
	const { compact } = useLayout();
	const backdrop = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLButtonElement>(null);
	const chrome = useRef<HTMLElement[]>([]);
	const [space, setSpace] = useState<{ width: number; height: number } | null>(null);
	const [full, setFull] = useState<string | null>(null);
	const [marked, setMarked] = useState<string | null>(null);
	const leaving = useRef(false);
	const back = useRef<HTMLDivElement>(null);
	// The keyboard comes with the picture: Tab walks this view's controls, not the album hidden under it.
	useEffect(() => {
		back.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
	}, []);
	const family = useFamily(entry.media, index);
	const session = index.sessions.get(entry.sessionId);
	// The way the composer tells: the conversation on screen by its own flag, any other by the sidebar's.
	const running = useApp((state) => (state.activeSessionId === entry.sessionId ? state.running : state.activity[entry.sessionId] === "running"));
	const drawing = drawingFor(entry, index);
	const at = order.findIndex((item) => item.media === entry.media);

	useLayoutEffect(() => {
		const el = stage.current;
		if (!el) return;
		// The picture keeps clear of the stage's edges: it is set down on the page, not fitted into it.
		const measure = () => setSpace({ width: el.clientWidth - 2 * (compact ? 16 : 40), height: el.clientHeight - 24 });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [compact]);

	const aspect = aspectOf(entry.kind === "drawn" ? entry : {});
	const box = space ? contain(space, aspect, entry.kind === "drawn" ? entry : undefined) : null;

	// The arrival: backdrop and controls fade up while the picture flies from its tile. Once, on the first measured frame.
	const arrived = useRef(false);
	useLayoutEffect(() => {
		if (!box || arrived.current) return;
		arrived.current = true;
		onArrived();
		if (motionReduced()) return;
		backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.base, easing: EASING.out });
		for (const part of chrome.current) part.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: DURATION.base, delay: 70, easing: EASING.out, fill: "backwards" });
		const el = frame.current;
		if (!el || !origin?.isConnected) return;
		const { transform, scale } = onto(origin.getBoundingClientRect(), el.getBoundingClientRect());
		origin.style.visibility = "hidden";
		const flight = el.animate([{ transform, borderRadius: `${TILE_RADIUS / scale}px` }, { transform: "none", borderRadius: `${RADIUS}px` }], { duration: DURATION.slow, easing: EASING.out });
		const settle = () => {
			origin.style.visibility = "";
		};
		flight.addEventListener("finish", settle);
		flight.addEventListener("cancel", settle);
		// Once, on the first measured frame: what changes after that is not an arrival.
		// oxlint-disable-next-line exhaustive-deps
	}, [box]);

	const close = () => {
		if (leaving.current) return;
		leaving.current = true;
		const el = frame.current;
		if (motionReduced() || !el) {
			onClose();
			return;
		}
		const fade = { duration: DURATION.base, easing: EASING.out, fill: "forwards" } as const;
		backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], fade);
		for (const part of chrome.current) part.animate([{ opacity: 1 }, { opacity: 0 }], { ...fade, duration: DURATION.quick });
		const tile = entry.kind === "drawn" ? tileOf(entry.media) : null;
		let flight: Animation;
		if (tile) {
			const { transform, scale } = onto(tile.getBoundingClientRect(), el.getBoundingClientRect());
			tile.style.visibility = "hidden";
			flight = el.animate([{ transform: "none", borderRadius: `${RADIUS}px` }, { transform, borderRadius: `${TILE_RADIUS / scale}px` }], { duration: DURATION.slow, easing: EASING.out, fill: "forwards" });
			flight.addEventListener("finish", () => {
				tile.style.visibility = "";
			});
		} else {
			flight = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], fade);
		}
		flight.addEventListener("finish", onClose);
	};

	const step = (delta: number) => {
		if (at < 0 || order.length < 2) return;
		openPicture(order[(at + delta + order.length) % order.length].media);
	};

	// Stepping to another picture starts it from its thumbnail again, and drops marks made on the last one.
	useEffect(() => {
		setFull(null);
		setMarked(null);
	}, [entry.media]);

	const closeRef = useRef(close);
	closeRef.current = close;
	const stepRef = useRef(step);
	stepRef.current = step;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']");
			// The image viewer, or any other dialog, is on top and takes its own keys.
			if (event.defaultPrevented || document.querySelector("[aria-modal='true']")) return;
			if (event.key === "Escape" && !typing) {
				event.preventDefault();
				closeRef.current();
			} else if (!typing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
				event.preventDefault();
				stepRef.current(event.key === "ArrowLeft" ? -1 : 1);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const src = sessionMediaUrl(entry.media);
	const keep = (el: HTMLElement | null) => {
		if (el && !chrome.current.includes(el)) chrome.current.push(el);
	};

	const zoom = (startEditing: boolean, from: HTMLElement | null) => {
		const target = from ?? frame.current;
		openViewer([{ src, alt: entry.kind === "drawn" ? entry.prompt : "", onAttach: setMarked }], 0, target?.getBoundingClientRect() ?? null, target, startEditing);
	};

	const sendEdit = async (words: string) => {
		const sent = await editInConversation({ sessionId: entry.sessionId, media: entry.media, mimeType: entry.mimeType }, words, marked ?? undefined);
		if (sent) {
			// When the new picture lands, the gallery opens on it rather than on the one it was made from.
			if (words.trim()) awaitEdit(entry.media);
			setMarked(null);
		}
		return sent;
	};

	return (
		<div data-ly-gallery-detail={entry.media} className={`absolute inset-0 z-30 flex ${compact ? "flex-col" : ""}`}>
			<div ref={backdrop} aria-hidden className="absolute inset-0 bg-shell" />
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<div
					ref={(el) => {
						keep(el);
						back.current = el;
					}}
					className="flex h-12 shrink-0 items-center gap-1 px-3"
				>
					<IconButton data-ly-gallery-close="" label={t("gallery.back")} icon={<ArrowLeft size={16} />} onClick={close} />
					<span className="flex-1" />
					{at >= 0 && order.length > 1 && (
						<>
							<span className="mr-1 text-caption text-ink-faint tabular-nums">
								{at + 1} / {order.length}
							</span>
							<IconButton label={t("gallery.previous")} icon={<ChevronLeft size={16} />} onClick={() => step(-1)} />
							<IconButton label={t("gallery.next")} icon={<ChevronRight size={16} />} onClick={() => step(1)} />
						</>
					)}
				</div>
				<div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center">
					{box && (
						<button
							ref={frame}
							type="button"
							data-ly-gallery-stage=""
							aria-label={t("gallery.zoom")}
							onClick={(event) => zoom(false, event.currentTarget)}
							className="relative cursor-zoom-in overflow-hidden bg-card"
							style={{ width: box.width, height: box.height, borderRadius: RADIUS }}
						>
							<img src={sessionMediaUrl(entry.media, TILE_THUMB)} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
							<img
								key={entry.media}
								src={src}
								alt={entry.kind === "drawn" ? entry.prompt : ""}
								draggable={false}
								decoding="async"
								onLoad={() => setFull(entry.media)}
								className={`absolute inset-0 size-full object-cover transition-opacity duration-[var(--ly-t-base)] ${full === entry.media ? "opacity-100" : "opacity-0"}`}
							/>
						</button>
					)}
				</div>
				<div ref={keep} className={`shrink-0 ${compact ? "px-3 py-3" : "px-8 pt-4 pb-6"}`}>
					<EditBar
						marked={marked}
						running={running}
						onAnnotate={() => zoom(true, frame.current)}
						onUnmark={() => setMarked(null)}
						onSend={sendEdit}
						onStop={() => void useApp.getState().abort(entry.sessionId)}
					/>
				</div>
			</div>
			<aside
				ref={keep}
				data-ly-gallery-panel=""
				className={`relative flex min-h-0 shrink-0 flex-col border-line-soft ${compact ? "max-h-[46%] border-t" : "w-[340px] border-l"}`}
			>
				<Scroller className="min-h-0 flex-1" contentClassName="flex flex-col gap-7 px-5 pt-4 pb-8">
					<section>
						<button
							type="button"
							data-ly-gallery-session=""
							disabled={!drawing}
							onClick={() => drawing && showInConversation(drawing.sessionId, drawing.toolCallId)}
							className="group/session flex max-w-full items-center gap-1 text-left text-title font-semibold text-ink"
						>
							<span className="truncate group-enabled/session:group-hover/session:underline">{session?.title || t("gallery.untitled")}</span>
						</button>
						<p className="mt-1 truncate text-caption text-ink-faint">
							{formatDate(entry.at, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
							{session?.projectName ? ` · ${session.projectName}` : ""}
						</p>
						<div className="mt-3 flex items-center gap-1.5">
							<Button size="sm" data-ly-gallery-locate="" icon={<ArrowUpRight size={14} />} disabled={!drawing} onClick={() => drawing && showInConversation(drawing.sessionId, drawing.toolCallId)}>
								{t("gallery.inConversation")}
							</Button>
							<IconButton label={t("imageGen.download")} icon={<Download size={15} />} onClick={() => save(src)} />
						</div>
					</section>

					<section>
						<h3 className="mb-2 flex items-baseline gap-2 text-detail font-medium text-ink-muted">
							{t("gallery.lineage")}
							<span className="text-caption font-normal text-ink-faint tabular-nums">{t("gallery.steps", { n: family.length })}</span>
						</h3>
						<Lineage current={entry.media} index={index} onSelect={(media) => openPicture(media)} />
					</section>

					{entry.kind === "drawn" && (
						<section>
							<h3 className="mb-2 flex items-center justify-between text-detail font-medium text-ink-muted">
								{t("gallery.prompt")}
								<CopyMark text={entry.prompt} />
							</h3>
							<p data-ly-gallery-prompt="" className="text-label leading-relaxed whitespace-pre-wrap text-ink select-text">
								{entry.prompt}
							</p>
							{entry.revisedPrompt && entry.revisedPrompt !== entry.prompt && (
								<p className="mt-2 text-detail leading-relaxed text-ink-muted select-text">
									{t("gallery.revised")}
									{entry.revisedPrompt}
								</p>
							)}
						</section>
					)}

					{entry.kind === "drawn" && (
						<section>
							<h3 className="mb-2 text-detail font-medium text-ink-muted">{t("gallery.details")}</h3>
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-detail">
								<Fact name={t("gallery.model")} value={entry.model.name} />
								<Fact name={t("gallery.size")} value={entry.width && entry.height ? `${entry.width} × ${entry.height}` : ""} />
								<Fact name={t("gallery.ratio")} value={entry.aspectRatio ?? t("gallery.auto")} />
								<Fact name={t("gallery.quality")} value={entry.quality ?? t("gallery.auto")} />
								<Fact name={t("gallery.duration")} value={entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : ""} />
							</dl>
						</section>
					)}
				</Scroller>
			</aside>
		</div>
	);
}

function Fact({ name, value }: { name: string; value: string }) {
	if (!value) return null;
	return (
		<>
			<dt className="text-ink-faint">{name}</dt>
			<dd className="min-w-0 truncate text-ink">{value}</dd>
		</>
	);
}
