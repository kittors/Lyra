/**
 * A screen being reached for — the pointer on its rail button — said by the rail and heard by
 * `screens.tsx`, which can fetch it.
 *
 * A handler set from outside rather than an import: the rail is drawn by the window frame, the frame
 * is drawn by settings too, and settings is one of the screens `screens.tsx` loads — the rail naming
 * that file closes a loop through all four.
 */

let heard: ((name: string) => void) | null = null;

/** Who fetches a screen when it is reached for. Returns the way to stop. */
export function hearScreenReach(handler: (name: string) => void): () => void {
	heard = handler;
	return () => {
		if (heard === handler) heard = null;
	};
}

export function reachScreen(name: string): void {
	heard?.(name);
}
