/**
 * Whether motion should be held still.
 *
 * Lives here rather than with the theme because it is what *animations* ask, and `ui/motion` is
 * where the animations are. It reads the document and nothing else — no store, no settings module —
 * which is what lets a component in `ui/` use it without reaching into a feature.

 * Whether motion is currently switched off, for the animations CSS cannot express.
 *
 * The stylesheet handles its own under `:root[data-reduce-motion]`, but a rewrite that steps
 * through intermediate strings is state, not style — there is no duration to shorten, only frames
 * to not run. Read at the moment it matters rather than subscribed to: these are one-shot
 * animations, and one that has already started can finish.
 */
export function motionReduced(): boolean {
	const setting = document.documentElement.dataset.reduceMotion;
	if (setting === "on") return true;
	if (setting === "off") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
