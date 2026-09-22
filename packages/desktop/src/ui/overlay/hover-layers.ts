/**
 * One answer to "should something that appears on its own be appearing right now".
 *
 * Two surfaces in this app show up because the pointer rested somewhere rather than because anyone
 * asked for them: the tooltip and the sidebar's hover card. Both have to get out of the way when
 * something deliberate opens — a bubble fading in over a menu is noise, and a hover card is 248px
 * of it, drawn above the menu it covers.
 *
 * The tooltip used to answer this by itself, twice over: a module-level flag set by `Popover`, plus
 * a `document.querySelector` for `.fixed.z-[60][role="menu"]` re-run on every `pointerover`. The
 * flag only knew about popovers and the selector only matched the class list popovers happen to
 * carry. The hover card asked nobody at all, which is the bug this was written for — right-click a
 * conversation, move the pointer away and back, and 420ms later the card returns on top of the menu
 * that is still open, at 210 against the menu's 60.
 *
 * Two different requests, because the two callers want different things:
 *
 * `claimHoverSuppression` is a menu saying "not while I am up". A popover covers a small patch and
 * leaves the rest of the window hoverable, so without a standing claim the pointer would simply
 * wander onto a row beside it and summon the card anyway.
 *
 * `dismissHoverLayers` is a modal saying "clear the screen". Its scrim covers everything, so no new
 * bubble or card can be provoked while it is there and a standing claim would buy nothing — what it
 * would cost is real, though: dialogs carry tooltips of their own (`ReleaseModal` alone has nine),
 * and suppressing for the length of a modal turns every one of them off. So this only takes away
 * what is on screen at the moment it opens, which is the actual problem — a dialog opened from the
 * keyboard leaves a card hanging over it, since no press happened to clear it.
 */

let claims = 0;
const listeners = new Set<() => void>();

/** Whether a menu or other partially-covering surface is holding these back right now. */
export function hoverLayersSuppressed(): boolean {
	return claims > 0;
}

/**
 * Hold them back for as long as the caller is on screen, and clear what is showing now.
 *
 * Returns the release, which is safe to call twice: a component unmounting during React's strict
 * double-invoke would otherwise take the count below zero and leave every later claim short.
 *
 * A count rather than a boolean. Menus nest and dialogs raise menus, so a submenu closing must not
 * lift the claim its parent is still holding — with a boolean the inner one's cleanup clears the
 * outer one's, and the last release wins by accident.
 */
export function claimHoverSuppression(): () => void {
	claims++;
	if (claims === 1) dismissHoverLayers();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		claims--;
	};
}

/** Take away whatever is on screen, without laying a claim on what may come next. */
export function dismissHoverLayers(): void {
	/*
	 * A copy of the set, deliberately.
	 *
	 * A listener told to stand down reacts by taking its own surface away, and a row that unmounts
	 * in the course of that unsubscribes. A `Set` under iteration skips any member deleted before
	 * the iterator reaches it — so the listener behind it would never be told, and would be left
	 * holding a card over the menu. Cheap insurance on a set that holds two or three entries.
	 */
	// oxlint-disable-next-line unicorn/no-useless-spread -- iteration must not observe removals; see above
	for (const listener of [...listeners]) listener();
}

/**
 * Hear about it, rather than poll for it.
 *
 * A card already on screen when a dialog opens has to be taken away, and nothing about that card's
 * own props changes at that moment.
 */
export function onHoverLayersDismissed(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
