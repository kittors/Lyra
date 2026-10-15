/**
 * What is dimming the whole window right now.
 *
 * On Windows and Linux the system draws minimise, maximise and close itself, over the page, in a
 * colour the app hands it — and nothing in the page can cover them. A dialog's scrim darkened the
 * whole window except a 138×32 patch in the top right corner, which was left the brightest thing on
 * screen (measured on Windows 11: #f3f3f3 beside a scrim of #bfbfbf). Whatever dims the window holds
 * a scrim here while it does; whatever paints outside the page follows it (`window-tint.ts`).
 *
 * Plain state with no service behind it, so the overlays in `ui/` can say what they do without
 * reaching past their layer.
 */

export interface Scrim {
	/** `#rrggbb`. */
	color: string;
	/** How much of it covers what is under it, 0–1. */
	alpha: number;
}

const held = new Set<Scrim>();
const listeners = new Set<() => void>();

/** Dim the window by this scrim until the returned release is called. */
export function holdScrim(color: string, alpha: number): () => void {
	const scrim = { color, alpha };
	held.add(scrim);
	notify();
	return () => {
		if (held.delete(scrim)) notify();
	};
}

/** The scrims in the order they were laid down, the first underneath. */
export function heldScrims(): Scrim[] {
	return [...held];
}

export function onScrimsChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notify(): void {
	for (const listener of listeners) listener();
}
