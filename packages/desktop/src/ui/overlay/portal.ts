/**
 * Where everything that floats gets mounted.
 *
 * Five components portal to `document.body` — the dialog, the popover, the hover card, the toasts
 * and the image viewer. They are not the same component and should not be: a dialog traps focus, a
 * popover follows an anchor, a toast stacks. What they share is one decision, and it was written
 * five times.
 *
 * The decision is `document.body` rather than a container inside the app, and the reason is
 * specific: `backdrop-filter` samples the nearest backdrop root, and *any* `mask` creates one.
 * Every fading-edged `Scroller` in this application has a mask, so a menu rendered inside one
 * frosted the scroller's own transparent background instead of the page — the glass looked broken
 * and no amount of opacity fixed it. Portalling to the body is what makes the blur happen against
 * what is actually behind.
 *
 * A shared helper rather than a shared component, so each of the five keeps its own behaviour and
 * none of them re-derives this.
 */

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Render `children` at the top of the document.
 *
 * `null` when there is no document — a component that renders during a server or test pass without
 * a DOM gets nothing rather than a crash, which is the right shape for something purely visual.
 */
export function portal(children: ReactNode): ReactNode {
	if (typeof document === "undefined") return null;
	return createPortal(children, document.body);
}
