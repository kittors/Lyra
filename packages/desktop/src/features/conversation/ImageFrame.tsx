/**
 * One picture's place in an image card: dots while it is being drawn, the picture when it lands.
 *
 * The place exists before the picture does, at the picture's shape, and nothing about its size
 * changes when the picture arrives — the dots fade out from under it rather than being swapped for
 * it, so the card does not jump and the transcript below it does not move.
 *
 * The arrival plays only when it happens in front of you. A conversation reopened later shows its
 * pictures as pictures; replaying the reveal each time one scrolled into view would be a flourish
 * that has stopped meaning anything.
 */

import { Download, PencilLine, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { Halftone } from "../../ui/motion/Halftone.tsx";

/** The widest a single picture is drawn, and the tallest; a pair of columns shares the width. */
const MAX_WIDTH = 420;
const MAX_HEIGHT = 460;
const GAP = 8;

/** Width for a picture of this shape, so a tall one is held to the height cap rather than running on. */
export function frameWidth(ratio: number, columns: number): number {
	const room = columns === 1 ? MAX_WIDTH : (MAX_WIDTH - GAP) / 2;
	const tallest = columns === 1 ? MAX_HEIGHT : room * 1.5;
	return Math.round(Math.min(room, tallest * ratio));
}

export function ImageFrame({
	ratio,
	columns,
	src,
	alt,
	live,
	reveal,
	percent,
	onOpen,
	onEdit,
	onDownload,
	onRegenerate,
}: {
	ratio: number;
	columns: number;
	/** Absent while drawing. */
	src?: string;
	alt: string;
	/** Being drawn right now. */
	live: boolean;
	/** The picture arrived while this was on screen: play its arrival. */
	reveal: boolean;
	/** Shown in the corner while drawing; `null` hides it. */
	percent: number | null;
	onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
	onEdit?: (event: React.MouseEvent<HTMLElement>) => void;
	onDownload?: () => void;
	/** Another model, or a video made from it: opens the card's list of models at the button. */
	onRegenerate?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
	const { t } = useI18n();
	const [loaded, setLoaded] = useState(false);
	const [dotsGone, setDotsGone] = useState(false);
	const settled = Boolean(src) && loaded;
	// The dots stay until the picture has actually decoded, fade out from under it, and then leave —
	// a transparent canvas still animating is a frame loop spent on nothing.
	const dots = live || (reveal && !dotsGone);

	return (
		<div
			data-ly-image-frame={live ? "drawing" : src ? "done" : "empty"}
			className="group/frame relative max-w-full overflow-hidden rounded-2xl bg-card/45"
			style={{ width: frameWidth(ratio, columns), aspectRatio: ratio }}
		>
			{dots && (
				<div
					className="absolute inset-0 text-ink transition-opacity duration-500 ease-out"
					style={{ opacity: settled ? 0 : 1 }}
					onTransitionEnd={() => settled && setDotsGone(true)}
					aria-hidden
				>
					<Halftone />
				</div>
			)}
			{src && (
				<button
					type="button"
					onClick={onOpen}
					aria-label={alt}
					className="absolute inset-0 block cursor-zoom-in"
				>
					<img
						src={src}
						alt={alt}
						draggable={false}
						onLoad={() => setLoaded(true)}
						className={`h-full w-full object-cover ${reveal && loaded ? "ly-image-reveal" : ""}`}
						style={{ opacity: loaded ? undefined : 0 }}
					/>
				</button>
			)}
			{percent !== null && (
				// `bg-float`, not `bg-elevated`: elevated is a translucent veil, and over a dense patch of
				// dots the number under it could not be read.
				<span
					data-ly-image-progress
					className="pointer-events-none absolute right-2.5 bottom-2.5 rounded-full bg-float px-2.5 py-0.5 text-caption font-medium text-ink tabular-nums shadow-[0_2px_10px_rgba(0,0,0,0.12)] transition-opacity duration-300"
					style={{ opacity: settled ? 0 : 1 }}
				>
					{percent}%
				</span>
			)}
			{src && loaded && (onEdit || onDownload || onRegenerate) && (
				<div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex items-end justify-between opacity-0 transition-opacity duration-200 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100">
					{onEdit ? (
						<button type="button" onClick={onEdit} className="ly-image-action pointer-events-auto gap-1.5 px-3 text-detail font-medium" aria-label={t("imageGen.edit")}>
							<PencilLine size={14} strokeWidth={2} />
							<span>{t("imageGen.edit")}</span>
						</button>
					) : (
						<span />
					)}
					<span className="flex items-end gap-1.5">
						{onRegenerate && (
							<button type="button" onClick={onRegenerate} className="ly-image-action pointer-events-auto w-8 justify-center" aria-label={t("imageGen.regenerate")} data-ly-tip={t("imageGen.regenerateTip")} data-ly-regenerate="">
								<RefreshCw size={15} strokeWidth={2} />
							</button>
						)}
						{onDownload && (
							<button type="button" onClick={onDownload} className="ly-image-action pointer-events-auto w-8 justify-center" aria-label={t("imageGen.download")} data-ly-tip={t("imageGen.download")}>
								<Download size={15} strokeWidth={2} />
							</button>
						)}
					</span>
				</div>
			)}
		</div>
	);
}
