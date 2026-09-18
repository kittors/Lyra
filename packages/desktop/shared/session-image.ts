/**
 * A URL the renderer can put on a thumbnail without already holding the pixels.
 *
 * Display thumbs use `ly-media://m/<sha.ext>` — a file that was parked when the
 * message was written, or when an old fat line was first opened. The `i/` host
 * still extracts from a live log for older callers; conversation tiles no longer
 * go that way.
 */
export const SESSION_IMAGE_HOST = "i";
export const SESSION_MEDIA_HOST = "m";
export const SESSION_THUMB_EDGE = 128;

export function sessionMediaUrl(name: string, thumb?: number): string {
	const url = `ly-media://${SESSION_MEDIA_HOST}/${encodeURIComponent(name)}`;
	return thumb ? `${url}?thumb=${thumb}` : url;
}

export function sessionImageUrl(
	projectId: string,
	sessionId: string,
	timestamp: number,
	imageIndex: number,
	thumb?: number,
): string {
	const url = `ly-media://${SESSION_IMAGE_HOST}/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}/${timestamp}/${imageIndex}`;
	return thumb ? `${url}?thumb=${thumb}` : url;
}

export function parseSessionImageUrl(href: string): {
	projectId: string;
	sessionId: string;
	timestamp: number;
	imageIndex: number;
	thumb: number | null;
} | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== "ly-media:" || url.hostname !== SESSION_IMAGE_HOST) return null;
	const parts = url.pathname.replace(/^\//, "").split("/");
	if (parts.length !== 4) return null;
	const timestamp = Number(parts[2]);
	const imageIndex = Number(parts[3]);
	if (!Number.isFinite(timestamp) || !Number.isInteger(imageIndex) || imageIndex < 0) return null;
	const raw = url.searchParams.get("thumb");
	const thumb = raw ? Number(raw) : null;
	return {
		projectId: decodeURIComponent(parts[0] ?? ""),
		sessionId: decodeURIComponent(parts[1] ?? ""),
		timestamp,
		imageIndex,
		thumb: thumb && Number.isFinite(thumb) && thumb > 0 ? Math.min(512, Math.round(thumb)) : null,
	};
}
