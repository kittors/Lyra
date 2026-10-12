/**
 * What stays on screen for a moment after a popover has gone.
 *
 * Only an Escape or a press outside reaches `Popover` before it unmounts, so only those two ever got
 * the exit. Every other way out ended the surface in a single frame: pressing the trigger again (the
 * toggle sets the anchor to null), choosing a row (the row calls `onClose`), leaving a hover preview
 * (`setHover(null)`). Each of those is the caller deciding, and forty-odd callers decide with
 * `open && <Popover>`, which removes it on the spot.
 *
 * Rather than teach every caller to wait, the popover leaves a copy of itself behind as it goes, and
 * the copy plays the exit. It is a picture, not a menu: inert, hidden from assistive technology,
 * transparent to the pointer, stripped of the ids and roles that lookups in the document go by, and
 * removed when its animation ends — or by a timer if that never comes.
 */

import { motionReduced } from "../motion/reduced.ts";

/** What a copy cannot reproduce: a canvas comes out blank, a frame or a player loads all over again. */
const UNCOPYABLE = "canvas, iframe, video, audio, object, embed";

/**
 * The longest any host's exit runs (the phone's is 150ms), with room for frames that come late.
 *
 * Only reached when `animationend` never arrives — a window hidden before the exit was painted — and
 * then its job is that nothing is left behind, not that the timing looks right.
 */
const FALLBACK_MS = 600;

/** Names a lookup could find the copy by, or that would tie it to something real. */
function strip(element: Element): void {
	for (const name of element.getAttributeNames()) {
		/*
		 * `name` included because a cloned checked radio, once inserted, unchecks the real one in its
		 * group: a picture of a form must not be able to change the form.
		 */
		if (name === "id" || name === "name" || name === "for" || name === "role" || name === "autofocus" || name.startsWith("aria-")) {
			element.removeAttribute(name);
		}
	}
}

/**
 * Copy `card` now, while it is still laid out, and show the copy once React has actually removed it.
 *
 * Called from the popover's unmount cleanup, which runs before React detaches the element, so the
 * scroll offsets, the opacity of an entrance still in flight and every inline style read here are the
 * ones on screen. Whether to show it waits a microtask: a cleanup is not always a removal — StrictMode
 * runs it on a component that stays, and so does an `Activity` being hidden — and only a card that has
 * really left the document needs a stand-in. A microtask still runs before the next paint, so there is
 * no frame with neither of them.
 */
export function leaveAfterimage(card: HTMLElement | null): void {
	// No copy at all where the exit would not be seen: reduced motion, or a DOM with no animations.
	if (!card?.isConnected || motionReduced() || typeof card.getAnimations !== "function") return;
	if (card.querySelector(UNCOPYABLE)) return;
	const computed = getComputedStyle(card);
	// Never placed, already faded out, or not rendered: there is nothing to see go.
	if (!(Number.parseFloat(computed.opacity) > 0.02) || card.getClientRects().length === 0) return;

	/*
	 * Where it is right now, so the exit starts there.
	 *
	 * The keyframe only has a `to`; its start is whatever the copy's own style says. A menu closed
	 * while its entrance was still scaling up, or mid-way through an exit of its own, would otherwise
	 * jump back to fully opaque and fade from there — the flash this is meant to remove.
	 */
	const opacity = computed.opacity;
	const transform = computed.transform;
	const descendants = card.querySelectorAll("*");
	// A copy starts scrolled to the top; a long list closed half-way down would jump as it faded.
	const offsets: [number, number, number][] = [];
	descendants.forEach((element, index) => {
		if (element.scrollTop || element.scrollLeft) offsets.push([index, element.scrollTop, element.scrollLeft]);
	});
	const parent = card.parentNode;
	const next = card.nextSibling;

	const ghost = card.cloneNode(true) as HTMLElement;
	strip(ghost);
	for (const element of ghost.querySelectorAll("*")) strip(element);
	ghost.removeAttribute("data-ly-popover");
	ghost.setAttribute("data-ly-popover-ghost", "");
	ghost.setAttribute("aria-hidden", "true");
	ghost.inert = true;
	ghost.style.pointerEvents = "none";
	ghost.style.opacity = opacity;
	ghost.style.transform = transform === "none" ? "" : transform;
	ghost.classList.remove("ly-pop-in");
	ghost.classList.add("ly-pop-out");

	queueMicrotask(() => {
		if (card.isConnected || !parent?.isConnected) return;
		parent.insertBefore(ghost, next?.parentNode === parent ? next : null);
		const copies = ghost.querySelectorAll("*");
		for (const [index, top, left] of offsets) {
			const copy = copies[index];
			if (!copy) continue;
			copy.scrollTop = top;
			copy.scrollLeft = left;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = () => {
			clearTimeout(timer);
			ghost.remove();
		};
		// Its own exit only: a spinner inside the copy ends animations of its own, and they bubble.
		const onEnd = (event: Event) => {
			if (event.target === ghost) done();
		};
		ghost.addEventListener("animationend", onEnd);
		ghost.addEventListener("animationcancel", onEnd);
		timer = setTimeout(done, FALLBACK_MS);
		if (ghost.getAnimations().length === 0) done();
	});
}
