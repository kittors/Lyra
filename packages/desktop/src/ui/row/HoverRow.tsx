/**
 * One list-row shell: title fills the row, icons overlay, fade yields on hover.
 *
 * Session, project, and git rows all use this. A reserved `pr-14` slot was the
 * empty gutter. A 76px overlay column was the same hole with a different name.
 * `group/row` plus `[data-ly-hover-row]` are the only hover keys; per-row
 * `group/session` names were how pin and archive stopped lighting.
 */

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";

/**
 * Fallback written onto `--ly-row-controls` before the strip measures.
 *
 * Each hit is ~21px (`p-1` + 12.5 icon). 6px on the left mirrors `pr-1.5` on
 * the right, so the first icon's inset matches the last icon's. A 58px two-button
 * slot was 17px past the pin — the extra yield.
 */
export function hoverSlot(actions: 1 | 2 | 3): string {
	if (actions >= 3) return "68px";
	if (actions === 2) return "48px";
	return "28px";
}

export function HoverRow({
	controls,
	className = "",
	style,
	children,
	...rest
}: ComponentPropsWithoutRef<"div"> & {
	controls: string;
}) {
	return (
		<div
			{...rest}
			data-ly-hover-row
			className={`ly-scroll group/row relative ${className}`}
			style={{ ...style, "--ly-row-controls": controls } as CSSProperties}
		>
			{children}
		</div>
	);
}

/** Leading icon column — same 12px box on every git row, no extra indent for worktrees. */
export function HoverRowMark({ className = "", children }: { className?: string; children: ReactNode }) {
	return (
		<span data-ly-row-mark className={`flex h-3 w-3 shrink-0 items-center justify-center ${className}`}>
			{children}
		</span>
	);
}

/** Shrink-wrap overlay. Never a fixed-width column: that paints the empty box. */
export function HoverRowReveal({ className = "", children }: { className?: string; children: ReactNode }) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		const row = el?.closest("[data-ly-hover-row]") as HTMLElement | null;
		if (!el || !row) return;
		const sync = () => {
			const overlay = el.getBoundingClientRect();
			if (overlay.width < 1) return;
			const title = row.querySelector(".ly-fade-tail");
			const titleRight = title?.getBoundingClientRect().right ?? overlay.right;
			const clear = Math.round(titleRight - overlay.left);
			if (clear > 0) row.style.setProperty("--ly-row-controls", `${clear}px`);
		};
		sync();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		observer.observe(row);
		return () => observer.disconnect();
	}, []);
	return (
		<span
			ref={ref}
			data-ly-hover-reveal
			className={`pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md px-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 ${className}`}
		>
			{children}
		</span>
	);
}
