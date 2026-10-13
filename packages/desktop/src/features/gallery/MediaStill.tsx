/**
 * A picture or a video as a still, for the grid and the history: the picture's thumbnail, or the
 * video's first frame.
 *
 * A video has no thumbnail on the main process's side — `nativeImage` decodes pictures, not video —
 * so it is its own `<video>` with only its header loaded (`preload="metadata"`, a few kilobytes by
 * range request), and `#t=0.001` is what makes Chromium paint the first frame instead of black.
 */

import { sessionMediaUrl } from "../../../shared/session-image.ts";

export function isVideo(entry: { media: string; mimeType?: string }): boolean {
	return entry.mimeType?.startsWith("video/") === true || /\.(?:mp4|webm|mov)$/.test(entry.media);
}

export function MediaStill({
	media,
	mimeType,
	edge,
	className,
	style,
	onLoad,
	loaded,
	lazy = true,
}: {
	media: string;
	mimeType?: string;
	/** The thumbnail edge a picture is asked at; a video ignores it. */
	edge?: number;
	className?: string;
	style?: React.CSSProperties;
	onLoad?: () => void;
	/** Marked on the element once it has drawn, for the grid's fade-in (`.ly-gallery-picture[data-loaded]`). */
	loaded?: boolean;
	lazy?: boolean;
}) {
	const mark = loaded ? "" : undefined;
	if (isVideo({ media, mimeType })) {
		return <video src={`${sessionMediaUrl(media)}#t=0.001`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden onLoadedData={onLoad} data-loaded={mark} className={className} style={style} />;
	}
	return <img src={sessionMediaUrl(media, edge)} alt="" draggable={false} loading={lazy ? "lazy" : undefined} decoding="async" onLoad={onLoad} data-loaded={mark} className={className} style={style} />;
}
