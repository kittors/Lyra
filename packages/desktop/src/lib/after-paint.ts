/**
 * Yield until the current store write can become a frame.
 *
 * Cold session clicks set `loadingSession` and then immediately start a multi-megabyte
 * IPC read. Without a paint in between, React never commits the skeleton — the main
 * thread is already busy cloning the transcript.
 */
export function afterPaint(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			return;
		}
		setTimeout(resolve, 0);
	});
}
