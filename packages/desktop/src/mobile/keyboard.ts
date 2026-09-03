/**
 * Keeping the composer above the on-screen keyboard.
 *
 * A phone keyboard does not resize the window. It slides over it, and the page is never told —
 * `window.innerHeight` is the same number before and after, so a composer pinned to the bottom of
 * the layout ends up pinned underneath the keyboard, with the caret in a field nobody can see. The
 * only thing that does notice is `visualViewport`, which reports the part of the window still
 * actually visible.
 *
 * So the height of the covered strip is computed from that and published as a CSS variable, and the
 * shell reserves it. Written as a function of the viewport rather than as an effect because the
 * arithmetic has a handful of cases that are awkward to reproduce in a real browser and trivial to
 * state here: a keyboard dismissed by scrolling, a viewport pushed up rather than shortened, and
 * the small shifts that are not keyboards at all and must not be mistaken for one.
 */

/** The part of `VisualViewport` this needs; a plain object in tests, the real one at runtime. */
export interface Viewport {
	height: number;
	offsetTop: number;
	/** Present on the real object, and how iOS reports a *zoomed* viewport rather than a covered one. */
	scale?: number;
}

/**
 * Below this, a shrunken viewport is not a keyboard.
 *
 * Mobile browsers shrink it by smaller amounts for their own reasons — a collapsing address bar, a
 * find-in-page bar, the accessory strip above some keyboards appearing on its own. Reserving space
 * for those makes the composer jump around while someone is reading. No real keyboard is this
 * short, so the threshold costs nothing.
 */
const FLOOR = 90;

/**
 * How many pixels at the bottom of the window are covered right now.
 *
 * `offsetTop` is part of it: iOS sometimes scrolls the whole visual viewport up to reveal the
 * focused field instead of shortening it, and in that case the window's bottom is off-screen by
 * exactly that much. Both forms have to be counted or the composer is short by a keyboard on
 * whichever devices choose the other one.
 */
export function keyboardInset(viewport: Viewport | undefined, windowHeight: number): number {
	if (!viewport) return 0;

	/*
	 * A zoomed viewport is smaller for a reason that has nothing to do with a keyboard, and the
	 * arithmetic below would read the magnification as one. The phone build pins the scale, so this
	 * is a guard against a page that got zoomed some other way rather than an expected state.
	 */
	if (viewport.scale !== undefined && viewport.scale > 1.01) return 0;

	const covered = windowHeight - viewport.height - viewport.offsetTop;
	return covered < FLOOR ? 0 : Math.round(covered);
}

/**
 * The two ends of the wiring below, narrowed so a test can supply them.
 *
 * `window` satisfies this as it stands. That matters: `innerHeight` has to be read at each update
 * rather than captured once, because rotating the phone changes it — and passing the real window
 * gets that for free, where a snapshot in an object literal would quietly go stale.
 */
export interface KeyboardHost {
	viewport?: (Viewport & {
		addEventListener(type: string, handler: () => void): void;
		removeEventListener(type: string, handler: () => void): void;
	}) | null;
	readonly innerHeight: number;
}

export interface KeyboardTarget {
	style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
	toggleAttribute(name: string, force: boolean): void;
	removeAttribute(name: string): void;
}

/**
 * Keep `--ly-keyboard` on the target in step with the viewport, until the returned function is called.
 *
 * Separated from the hook so the wiring itself can be tested — the arithmetic above is the easy
 * half, and the ways this goes wrong are all in the wiring: subscribing to `resize` but not
 * `scroll` and missing the devices that slide rather than shrink, or leaving the variable set after
 * unmount so a window that stops being a phone keeps a keyboard's worth of padding forever.
 */
export function watchKeyboard(host: KeyboardHost, target: KeyboardTarget): () => void {
	const viewport = host.viewport;
	if (!viewport) return () => {};

	const update = () => {
		const inset = keyboardInset(viewport, host.innerHeight);
		target.style.setProperty("--ly-keyboard", `${inset}px`);
		// Whether a keyboard is up at all, for rules that do more than reserve space.
		target.toggleAttribute("data-keyboard", inset > 0);
	};

	// Once immediately: a phone can be rotated or reloaded with the keyboard already up, and
	// waiting for the next event would leave the composer under it until something else moved.
	update();
	viewport.addEventListener("resize", update);
	// The viewport slides as well as shrinks, and only `scroll` reports the slide.
	viewport.addEventListener("scroll", update);

	return () => {
		viewport.removeEventListener("resize", update);
		viewport.removeEventListener("scroll", update);
		target.style.removeProperty("--ly-keyboard");
		target.removeAttribute("data-keyboard");
	};
}
