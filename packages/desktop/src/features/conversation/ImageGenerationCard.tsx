/**
 * What an `image_generate` call is drawing, in the conversation: a field of dots at the picture's
 * shape while it is being made, the picture when it arrives.
 *
 * Drawn outside the turn's process block, like the browser card (`Conversation.tsx`): the process
 * folds to one line when the turn ends, and the picture is the answer, not part of how it was reached.
 *
 * The line above the picture says where the drawing is while it runs, and what drew it once it has
 * — one row in both states, so nothing below moves when one becomes the other.
 */

import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ImageGenerationDetails, ToolCallContent } from "@lyra/core";
import { mediaModelRows } from "@lyra/core/image-models";
import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { useScopedFromToolRuns, useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { expectedMs, progressAt, stageAt } from "../../lib/image-progress.ts";
import { useApp } from "../../store/index.ts";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { attachToComposer, openViewer } from "../image/index.ts";
import { MediaPickMenu } from "../models/index.ts";
import { ImageFrame } from "./ImageFrame.tsx";
import { filmFrom, remakeWith } from "./regenerate.ts";
import { stoppedByUser } from "./tool-status.ts";

/** `"16:9"` as a width/height ratio, or `null` for auto and anything unreadable. */
function ratioOf(value: unknown): number | null {
	const match = typeof value === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
	return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : null;
}

/** `45s`, `12m`, `1h 53m` — the shape the turn meter uses, read the same in every language. */
function span(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A clock that ticks only while something is being drawn. A percentage is a reading, not a rhythm. */
function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => setNow(Date.now()), 400);
		return () => window.clearInterval(timer);
	}, [active]);
	return active ? now : Date.now();
}

/**
 * Save the picture as it was drawn, bytes untouched.
 *
 * The link's own `download` name would be ignored — the media URL is not this page's origin — so the
 * readable name is given by the main process when the download starts (`electron/media-downloads.ts`).
 */
function save(src: string): void {
	const link = document.createElement("a");
	link.href = src;
	link.download = "";
	link.click();
}

export function ImageGenerationCards({ calls }: { calls: ToolCallContent[] }) {
	return (
		<div className="flex flex-col gap-4" data-ly-image-cards>
			{calls.map((call) => (
				<ImageGenerationCard key={call.id} call={call} />
			))}
		</div>
	);
}

function ImageGenerationCard({ call }: { call: ToolCallContent }) {
	const { t } = useI18n();
	const run = useScopedFromToolRuns((toolRuns) => toolRuns[call.id]);
	// This screen's conversation: 完成 on a marked-up picture puts it in this composer, not the focused one.
	const sessionId = useScopedSessionId();
	const live = run?.status === "running";
	// Seen drawing while mounted: the picture's arrival is played. A reopened conversation's is not.
	const watched = useRef(false);
	if (live) watched.current = true;
	const now = useNow(live);
	const providers = useApp((s) => s.settings?.providers);
	const again = usePopover();
	const [chosen, setChosen] = useState(0);
	if (!run) return null;

	const details = run.result?.details as ImageGenerationDetails | undefined;
	const known = details?.kind === "image_generation";
	if (!live && (!known || details.status !== "done")) {
		// Refused before it started (bad arguments, no model): the tool's own row says why.
		if (!known && !stoppedByUser(run.result)) return null;
		return <DrawFailed details={known ? details : undefined} stopped={stoppedByUser(run.result) || details?.status === "running"} />;
	}

	const args = call.arguments;
	const count = known ? details.count : Math.max(1, Math.min(4, Math.round(Number(args.count) || 1)));
	// Asked for, or — for an edit left to keep its input's shape — that shape: what the place is held at.
	const asked = ratioOf(known ? details.aspectRatio : args.aspect_ratio) ?? (known ? details.shapeHint : undefined);
	const pictures = !live && known ? (details.images ?? []) : [];
	const slots = live ? count : pictures.length;
	const columns = slots > 1 ? 2 : 1;
	const prompt = known ? details.prompt : typeof args.prompt === "string" ? args.prompt : "";

	const imageRows = mediaModelRows(providers, "image");
	let caption: string;
	let percent: number | null = null;
	if (live) {
		const startedAt = details?.startedAt ?? run.startedAt;
		const progress = progressAt(now - startedAt, expectedMs(details?.model.id ?? "", details?.quality, count, details?.edit ?? false));
		percent = Math.round(progress * 100);
		caption = details?.retry ? t("imageGen.retrying") : t(stageAt(progress));
	} else {
		const first = pictures[0];
		const size = first?.width && first.height && pictures.length === 1 ? ` · ${first.width}×${first.height}` : "";
		const missing = count - pictures.length;
		caption = `${madeBy(details, imageRows)}${size}${missing > 0 ? ` · ${t("imageGen.partial", { n: missing })}` : ""}`;
	}

	const sources = pictures.map((picture) => ({ src: sessionMediaUrl(picture.media), alt: prompt, onAttach: attachToComposer(sessionId, picture.media) }));
	/*
	 * Another model, or a video made from it — offered only when there is another model to offer: a
	 * second image model to redraw with, or any video model to film it with.
	 */
	const videoCount = mediaModelRows(providers, "video").length;
	const regenerable = !live && known && (imageRows.length > 1 || videoCount > 0);
	const frameOf = (event: React.MouseEvent<HTMLElement>) => event.currentTarget.closest<HTMLElement>("[data-ly-image-frame]");

	return (
		// `data-ly-image-call` is what the gallery asks the transcript to scroll to (`reveal.ts`).
		<figure data-ly-image-card={live ? "drawing" : "done"} data-ly-image-call={call.id} className="m-0 flex w-fit max-w-full flex-col gap-2">
			<figcaption className="truncate text-detail text-ink-muted">
				<RollingText>{caption}</RollingText>
			</figcaption>
			<div className={columns > 1 ? "grid w-fit max-w-full grid-cols-2 gap-2" : "flex"}>
				{Array.from({ length: slots }, (_, index) => {
					const picture = pictures[index];
					const ratio = picture?.width && picture.height ? picture.width / picture.height : (asked ?? 1);
					return (
						<ImageFrame
							key={index}
							ratio={ratio}
							columns={columns}
							src={picture ? sources[index].src : undefined}
							alt={prompt}
							live={live}
							reveal={watched.current && !live}
							// One reading for the whole card, in the last frame's corner.
							percent={index === slots - 1 && (live || watched.current) ? (live ? (percent ?? 0) : 100) : null}
							// The frame, not the button inside it: the frame is what has the corners, and the hover
							// buttons beside the picture go with it while it is out.
							onOpen={picture ? (event) => {
								const frame = frameOf(event);
								openViewer(sources, index, frame?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(), frame ?? event.currentTarget);
							} : undefined}
							onEdit={
								picture
									? (event) => {
											const frame = frameOf(event);
											openViewer([sources[index]], 0, frame?.getBoundingClientRect() ?? null, frame, true);
										}
									: undefined
							}
							onDownload={picture ? () => save(sources[index].src) : undefined}
							onRegenerate={
								picture && regenerable
									? (event) => {
											setChosen(index);
											again.openAt(event.currentTarget);
										}
									: undefined
							}
						/>
					);
				})}
			</div>
			{again.open && known && pictures[chosen] && (
				<MediaPickMenu
					anchor={again.anchor}
					onClose={again.close}
					label={t("imageGen.regenerateTip")}
					made={details.model.id}
					sections={[
						...(imageRows.length > 1 ? [{ kind: "image" as const, title: t("imageGen.redrawWith") }] : []),
						...(videoCount > 0 ? [{ kind: "video" as const, title: t("imageGen.toVideo") }] : []),
					]}
					onPick={(kind, modelId) => {
						if (kind === "image") remakeWith(sessionId, "image", modelId, prompt);
						else void filmFrom(sessionId, pictures[chosen], modelId);
					}}
				/>
			)}
		</figure>
	);
}

/** The model's name — with its provider when another provider has a model of the same name. */
function madeBy(details: ImageGenerationDetails | undefined, rows: { model: { name: string } }[]): string {
	const name = details?.model.name ?? "";
	const twins = rows.filter((row) => row.model.name.trim().toLowerCase() === name.trim().toLowerCase()).length;
	return twins > 1 && details?.model.provider ? `${name} · ${details.model.provider}` : name;
}

function DrawFailed({ details, stopped }: { details?: ImageGenerationDetails; stopped: boolean }) {
	const { t } = useI18n();
	const error = details?.error;
	const model = details?.model.name ?? "";
	let title = t("imageGen.failed");
	let note = error ? error.summary : "";
	if (stopped) {
		title = t("imageGen.stopped");
		note = "";
	} else if (error?.hint === "check-billing") {
		title = t("imageGen.quotaSpent", { model });
		note = error.retryAfterMs ? t("imageGen.resetsIn", { time: span(error.retryAfterMs) }) : "";
	} else if (error?.hint === "check-key") {
		title = t("imageGen.notAllowed", { model });
		note = t("imageGen.notAllowedHint");
	} else if (error?.hint === "blocked") {
		title = t("imageGen.refused");
		note = t("imageGen.refusedHint");
	}
	return (
		<div data-ly-image-card={stopped ? "stopped" : "error"} className="flex w-fit max-w-[420px] items-start gap-2.5 rounded-xl border border-line bg-card/30 px-3 py-2.5 text-label">
			<ImageOff size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ink-faint" />
			<div className="min-w-0">
				<p className="text-ink">{title}</p>
				{note && <p className="mt-0.5 text-caption text-ink-faint" data-ly-tip={error?.detail?.slice(0, 400)}>{note}</p>}
			</div>
		</div>
	);
}
