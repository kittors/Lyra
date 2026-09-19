/** Async work belongs to the capture that started it, even though the overlay window is reused. */
export function createCaptureActions() {
	let session: number | undefined;
	let downloading: number | undefined;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	return {
		reset(next?: number): void {
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			session = next;
			downloading = undefined;
		},
		isCurrent(capture: number): boolean { return session === capture; },
		startDownload(capture: number): boolean {
			if (session !== capture || downloading !== undefined) return false;
			downloading = capture;
			return true;
		},
		finishDownload(capture: number): void {
			if (downloading === capture) downloading = undefined;
		},
		after(delay: number, action: () => void): void {
			const capture = session;
			const timer = setTimeout(() => {
				timers.delete(timer);
				if (session === capture) action();
			}, delay);
			timers.add(timer);
		},
	};
}
