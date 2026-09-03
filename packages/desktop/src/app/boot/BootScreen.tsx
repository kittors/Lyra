/**
 * What the window shows between opening and the settings arriving.
 *
 * Almost always a few hundred milliseconds, which is the whole design problem: anything that
 * announces itself immediately is a flash, and a flash is what makes a fast launch feel broken.
 * So nothing is drawn for the first half-second, and what does appear afterwards fades in over
 * most of a second rather than snapping on.
 *
 * The colours come from the preload, which paints the saved theme before the first frame — without
 * it this screen was always dark, and a light-theme app began every launch by flashing.
 */

import { useEffect, useState } from "react";
/*
 * Inlined, not linked.
 *
 * Two reasons, and the first is correctness. Packaged, the renderer is loaded with `loadFile`,
 * so the page's origin is `file://` — and `img-src 'self'` in the Content-Security-Policy does
 * not reliably cover a file-origin document. A data URL is covered explicitly by `data:` in that
 * same policy, which makes this the one form guaranteed to work both packaged and in dev.
 *
 * The second is that this is the first thing drawn. A separate request means the layout can
 * appear before the artwork does, and a boot screen that flashes its own empty frame is worse
 * than one that waits. Arriving with the bundle means it is never late.
 */
import mark from "../../assets/boot-mark.png?inline";

/**
 * Short, now that the screen is guaranteed a couple of seconds.
 *
 * It used to be 500ms and existed to keep a fast launch from flashing — nothing was drawn until the
 * boot had probably already finished. The effect was that the screen was almost never seen at all,
 * which is the opposite complaint. With `MIN_BOOT_MS` holding the screen up, the quiet period only
 * needs to cover the first paint.
 */
const QUIET_MS = 120;

/**
 * The floor on how long a launch shows this.
 *
 * Not a delay for its own sake: the window opens, the theme paints, and the mark is on screen long
 * enough to be read as the app starting rather than as a stutter. Boot itself is usually done well
 * inside it, so this is what decides the length of a normal launch.
 */
export const MIN_BOOT_MS = 2000;

export function BootScreen() {
	const [shown, setShown] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setShown(true), QUIET_MS);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div className="flex h-full items-center justify-center bg-shell" aria-busy aria-label="Lyra 正在启动">
			<div
				className="flex flex-col items-center gap-8 transition-opacity duration-[520ms] ease-out"
				style={{ opacity: shown ? 1 : 0 }}
			>
				{/*
				 * Sized in CSS rather than left to the file, and `alt=""` because the name is drawn
				 * into the artwork — a screen reader announcing it twice is worse than not at all.
				 * The label is on the region instead, where it can say what is happening.
				 */}
				<img src={mark} alt="" width={192} height={192} className="ly-boot-mark" draggable={false} />
				<div className="ly-boot-rail" />
			</div>
		</div>
	);
}
