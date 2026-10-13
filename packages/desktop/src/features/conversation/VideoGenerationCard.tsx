/**
 * What a `video_generate` call is making, in the conversation: a field of dots at the video's shape
 * while the task runs, the video when it arrives — `ImageGenerationCard`'s counterpart, outside the
 * turn's process block for the same reason (`Conversation.tsx`).
 *
 * A video is a task that can take minutes, so the line above it says where the task is — submitted,
 * queued, being made, being fetched — and how long it has been, rather than only a percentage. The
 * percentage is the provider's own where it reports one, and otherwise the clock against how long
 * this kind of clip usually takes (`lib/video-progress.ts`).
 */

import { Download, RefreshCw, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ToolCallContent, VideoGenerationDetails } from "@lyra/core";
import { mediaModelRows } from "@lyra/core/image-models";
import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { useScopedFromToolRuns, useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { progressAt } from "../../lib/image-progress.ts";
import { expectedVideoMs } from "../../lib/video-progress.ts";
import { useApp } from "../../store/index.ts";
import { VideoPlayer } from "../../ui/media/VideoPlayer.tsx";
import { Halftone } from "../../ui/motion/Halftone.tsx";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { MediaPickMenu } from "../models/index.ts";
import { frameWidth } from "./ImageFrame.tsx";
import { remakeWith } from "./regenerate.ts";
import { stoppedByUser } from "./tool-status.ts";

const STAGES: Record<NonNullable<VideoGenerationDetails["stage"]>, MessageKey> = {
	submitting: "videoGen.stage.submitting",
	queued: "videoGen.stage.queued",
	running: "videoGen.stage.running",
	downloading: "videoGen.stage.downloading",
};

function ratioOf(value: unknown): number | null {
	const match = typeof value === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
	return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : null;
}

/** `45s`, `3m 12s`, `1h 5m`. */
function span(ms: number): string {
	const seconds = Math.max(1, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active]);
	return active ? now : Date.now();
}

/** Save the file as it was made; the readable name comes from the main process (`media-downloads.ts`). */
function save(src: string): void {
	const link = document.createElement("a");
	link.href = src;
	link.download = "";
	link.click();
}

export function VideoGenerationCards({ calls }: { calls: ToolCallContent[] }) {
	return (
		<div className="flex flex-col gap-4" data-ly-video-cards>
			{calls.map((call) => (
				<VideoGenerationCard key={call.id} call={call} />
			))}
		</div>
	);
}

function VideoGenerationCard({ call }: { call: ToolCallContent }) {
	const { t } = useI18n();
	const run = useScopedFromToolRuns((toolRuns) => toolRuns[call.id]);
	const sessionId = useScopedSessionId();
	const providers = useApp((s) => s.settings?.providers);
	const again = usePopover();
	const live = run?.status === "running";
	const watched = useRef(false);
	if (live) watched.current = true;
	const now = useNow(live);
	if (!run) return null;

	const details = run.result?.details as VideoGenerationDetails | undefined;
	const known = details?.kind === "video_generation";
	if (!live && (!known || details.status !== "done")) {
		if (!known && !stoppedByUser(run.result)) return null;
		return <FilmFailed details={known ? details : undefined} stopped={stoppedByUser(run.result) || details?.status === "running"} />;
	}

	const args = call.arguments;
	const count = known ? details.count : Math.max(1, Math.min(4, Math.round(Number(args.count) || 1)));
	const asked = (known ? details.shapeHint : undefined) ?? ratioOf(known ? details.aspectRatio : args.aspect_ratio) ?? 16 / 9;
	const videos = !live && known ? (details.videos ?? []) : [];
	const slots = live ? count : videos.length;
	const columns = slots > 1 ? 2 : 1;
	const prompt = known ? details.prompt : typeof args.prompt === "string" ? args.prompt : "";
	const videoRows = mediaModelRows(providers, "video");

	let caption: string;
	let percent: number | null = null;
	if (live) {
		const startedAt = details?.startedAt ?? run.startedAt;
		const elapsed = now - startedAt;
		const reported = details?.progress;
		percent = Math.round(reported ?? progressAt(elapsed, expectedVideoMs(details?.model.id ?? "", details?.duration, details?.resolution, count)) * 100);
		const stage = details?.retry ? t("imageGen.retrying") : t(STAGES[details?.stage ?? "submitting"]);
		caption = `${stage} · ${t("videoGen.elapsed", { time: span(elapsed) })}`;
	} else {
		const first = videos[0];
		const twins = videoRows.filter((row) => row.model.name === details?.model.name).length > 1;
		const name = `${details?.model.name ?? ""}${twins && details?.model.provider ? ` · ${details.model.provider}` : ""}`;
		const size = first?.width && first.height && videos.length === 1 ? ` · ${first.width}×${first.height}` : "";
		const length = first?.seconds && videos.length === 1 ? ` · ${first.seconds}s` : "";
		const missing = count - videos.length;
		caption = `${name}${size}${length}${missing > 0 ? ` · ${t("videoGen.partial", { n: missing })}` : ""}`;
	}
	const remakeable = !live && known && videoRows.length > 1;

	return (
		<figure data-ly-video-card={live ? "making" : "done"} data-ly-image-call={call.id} className="m-0 flex w-fit max-w-full flex-col gap-2">
			<figcaption className="truncate text-detail text-ink-muted">
				<RollingText>{caption}</RollingText>
			</figcaption>
			<div className={columns > 1 ? "grid w-fit max-w-full grid-cols-2 gap-2" : "flex"}>
				{Array.from({ length: slots }, (_, index) => {
					const video = videos[index];
					const ratio = video?.width && video.height ? video.width / video.height : asked;
					return (
						<VideoFrame
							key={index}
							ratio={ratio}
							columns={columns}
							src={video ? sessionMediaUrl(video.media) : undefined}
							label={prompt}
							live={live}
							percent={index === slots - 1 && live ? percent : null}
							onDownload={video ? () => save(sessionMediaUrl(video.media)) : undefined}
							onRegenerate={video && remakeable ? (event) => again.openAt(event.currentTarget) : undefined}
						/>
					);
				})}
			</div>
			{again.open && known && (
				<MediaPickMenu
					anchor={again.anchor}
					onClose={again.close}
					label={t("videoGen.remakeWith")}
					made={details.model.id}
					sections={[{ kind: "video", title: t("videoGen.remakeWith") }]}
					onPick={(_, modelId) => remakeWith(sessionId, "video", modelId, prompt)}
				/>
			)}
		</figure>
	);
}

/**
 * One video's place: dots at its shape while it is made, the app's player when it lands
 * (`ui/media/VideoPlayer.tsx`). The card's own actions sit at the top, because the player's bar owns
 * the bottom edge.
 */
function VideoFrame({
	ratio,
	columns,
	src,
	label,
	live,
	percent,
	onDownload,
	onRegenerate,
}: {
	ratio: number;
	columns: number;
	src?: string;
	label: string;
	live: boolean;
	percent: number | null;
	onDownload?: () => void;
	onRegenerate?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
	const { t } = useI18n();
	return (
		<div
			data-ly-video-frame={live ? "making" : src ? "done" : "empty"}
			className="group/frame relative max-w-full overflow-hidden rounded-2xl bg-card/45"
			style={{ width: frameWidth(ratio, columns), aspectRatio: ratio }}
		>
			{live && (
				<div className="absolute inset-0 text-ink" aria-hidden>
					<Halftone />
				</div>
			)}
			{src && <VideoPlayer src={src} label={label} className="absolute inset-0 size-full" />}
			{percent !== null && (
				<span
					data-ly-image-progress
					className="pointer-events-none absolute right-2.5 bottom-2.5 rounded-full bg-float px-2.5 py-0.5 text-caption font-medium text-ink tabular-nums shadow-[0_2px_10px_rgba(0,0,0,0.12)]"
				>
					{percent}%
				</span>
			)}
			{src && (onDownload || onRegenerate) && (
				<div className="pointer-events-none absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100">
					{onRegenerate && (
						<button type="button" onClick={onRegenerate} className="ly-image-action pointer-events-auto w-8 justify-center" aria-label={t("videoGen.remakeWith")} data-ly-tip={t("videoGen.remakeWith")} data-ly-regenerate="">
							<RefreshCw size={15} strokeWidth={2} />
						</button>
					)}
					{onDownload && (
						<button type="button" onClick={onDownload} className="ly-image-action pointer-events-auto w-8 justify-center" aria-label={t("imageGen.download")} data-ly-tip={t("imageGen.download")}>
							<Download size={15} strokeWidth={2} />
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function FilmFailed({ details, stopped }: { details?: VideoGenerationDetails; stopped: boolean }) {
	const { t } = useI18n();
	const error = details?.error;
	const model = details?.model.name ?? "";
	let title = t("videoGen.failed");
	let note = error ? error.summary : "";
	if (stopped) {
		title = t("videoGen.stopped");
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
	} else if (error?.reason === "lost") {
		title = t("videoGen.lost");
		note = t("videoGen.lostHint");
	} else if (error?.reason === "timeout") {
		title = t("videoGen.timeout");
		note = t("videoGen.timeoutHint");
	}
	return (
		<div data-ly-video-card={stopped ? "stopped" : "error"} className="flex w-fit max-w-[420px] items-start gap-2.5 rounded-xl border border-line bg-card/30 px-3 py-2.5 text-label">
			<VideoOff size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ink-faint" />
			<div className="min-w-0">
				<p className="text-ink">{title}</p>
				{note && <p className="mt-0.5 text-caption text-ink-faint" data-ly-tip={error?.detail?.slice(0, 400)}>{note}</p>}
			</div>
		</div>
	);
}
