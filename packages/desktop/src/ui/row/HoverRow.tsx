/**
 * A list row whose title yields to a trailing slot, the way a session does.
 *
 * The title used to run the full width with the icon on top of it, so a long name and the
 * control overlapped into something neither could be read through. A gradient behind the icon
 * failed once the sidebar went translucent — there is no colour to fade to that covers text.
 * Reserving the slot costs a few characters and cannot go wrong; the fade only deepens on
 * hover, and padding does not grow, so a long name does not jitter.
 *
 * Every row in a list uses the same slot width. Different reservations (one button, three,
 * a 「当前」 badge) are what drew those empty boxes at different places.
 */

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

/** `IconButton` sm is 22px; 2px between them; 6px of row padding on the right. */
function iconStripWidth(count: number): number {
	if (count <= 0) return 0;
	return 22 * count + 2 * Math.max(0, count - 1) + 6;
}

/** Live session: pin, or pin + archive. */
export const SESSION_CONTROLS = { one: 34, two: 58 } as const;
/** Project heading: count and the two buttons that replace it. */
export const PROJECT_CONTROLS = 52;
/** Every git row, including 「当前」 and a checkout's branch — one column so the glyphs line up. */
export const GIT_CONTROLS = iconStripWidth(3);

export function HoverRow({
	controls,
	className = "",
	style,
	children,
	...rest
}: ComponentPropsWithoutRef<"div"> & {
	/** Reserved trailing slot, in px. The title stops here; overlays land here. */
	controls: number;
}) {
	return (
		<div
			{...rest}
			data-ly-hover-row
			className={`ly-scroll group/row relative ${className}`}
			style={{ ...style, "--ly-row-controls": `${controls}px` } as CSSProperties}
		>
			{children}
		</div>
	);
}

function bodyStyle(style?: CSSProperties): CSSProperties {
	return { ...style, paddingRight: "var(--ly-row-controls)" };
}

export function HoverRowBody({
	className = "",
	style,
	children,
	...rest
}: ComponentPropsWithoutRef<"div">) {
	return (
		<div {...rest} className={`flex w-full min-w-0 items-center ${className}`} style={bodyStyle(style)}>
			{children}
		</div>
	);
}

export function HoverRowButton({
	className = "",
	style,
	children,
	...rest
}: ComponentPropsWithoutRef<"button">) {
	return (
		<button
			{...rest}
			type="button"
			className={`flex w-full min-w-0 items-center ${className}`}
			style={bodyStyle(style)}
		>
			{children}
		</button>
	);
}

/** Leading icon column. Every row in a list uses this box so the glyphs share one x. */
export function HoverRowMark({ className = "", children }: { className?: string; children: ReactNode }) {
	return (
		<span data-ly-row-mark className={`flex h-3 w-3 shrink-0 items-center justify-center ${className}`}>
			{children}
		</span>
	);
}

const TRAIL =
	"pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end pr-1.5";

export function HoverRowTrail({ className = "", children }: { className?: string; children: ReactNode }) {
	return (
		<span className={`${TRAIL} ${className}`} style={{ width: "var(--ly-row-controls)" }}>
			{children}
		</span>
	);
}

export function HoverRowReveal({ className = "", children }: { className?: string; children: ReactNode }) {
	return (
		<span
			data-ly-hover-reveal
			className={`${TRAIL} opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 ${className}`}
			style={{ width: "var(--ly-row-controls)" }}
		>
			{children}
		</span>
	);
}
