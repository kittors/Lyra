/**
 * A position in a video, the way players write it: `0:05`, `12:34`, `1:02:03`.
 *
 * Minutes are not padded and hours appear only when there are any — the shape every player uses, so
 * nobody has to read it twice. Anything that is not a finite, non-negative number of seconds (a
 * duration not known yet is `NaN`, a live stream's is `Infinity`) reads as `0:00` rather than "NaN:NaN".
 */
export function formatClock(seconds: number): string {
	const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const two = (value: number) => String(value).padStart(2, "0");
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const rest = whole % 60;
	return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}
