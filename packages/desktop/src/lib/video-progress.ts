/**
 * How far along a video probably is, by the clock — the companion of `image-progress.ts`.
 *
 * Most video APIs say only "pending" until the file is ready; the relays carrying the `/v1/videos`
 * format sometimes report a percentage, and when they do it is used instead (`VideoGenerationDetails.
 * progress`). Otherwise the estimate rises against how long this kind of clip usually takes, slows,
 * and stops short of the end, for the reason the picture gauge does: the real end is the file arriving.
 */

/** Typical wall time for a short clip at 720p, by line: xAI's are quick, Seedance and Wan take minutes. */
function baseMs(modelId: string): number {
	const id = modelId.toLowerCase();
	if (/grok-imagine-video/.test(id)) return 45_000;
	if (/veo/.test(id)) return 90_000;
	if (/seedance|kling|hailuo|vidu|jimeng/.test(id)) return 120_000;
	if (/wan/.test(id)) return 180_000;
	return 120_000;
}

/** Expected wall time: longer clips and higher resolutions take longer, several run side by side. */
export function expectedVideoMs(modelId: string, seconds?: number, resolution?: string, count = 1): number {
	const length = seconds ? Math.max(0.6, seconds / 6) : 1;
	const detail = resolution === "1080p" ? 1.8 : resolution === "480p" ? 0.7 : 1;
	return baseMs(modelId) * length * detail * (1 + 0.1 * (count - 1));
}
