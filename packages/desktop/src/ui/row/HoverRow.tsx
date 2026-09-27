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
			/*
			 * No overlap is written as 0, not skipped.
			 *
			 * The `controls` fallback is an estimate for a title that fills the row with the buttons over
			 * its tail. Where the title stops short of the strip, the measurement comes out negative, and
			 * skipping it left the fallback in place for good: on hover the mask cleared a stretch off the
			 * title's end for nothing, and `ScrollText` counted that stretch as unreadable, so a name that
			 * fit started scrolling the moment it was hovered. Project rows did exactly this.
			 */
			const clear = `${Math.max(0, Math.round(titleRight - overlay.left))}px`;
			if (row.style.getPropertyValue("--ly-row-controls") === clear) return;
			row.style.setProperty("--ly-row-controls", clear);
			/*
			 * Tell any `ScrollText` in the row to measure again. Its hover verdict depends on this value,
			 * but its own observer only watches sizes, and it fires before this one: when a project folds,
			 * the count pushes in and the title narrows, and it re-judges with the old overlap before this
			 * writes the new one.
			 */
			row.dispatchEvent(new Event("ly-row-controls"));
		};
		sync();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		observer.observe(row);
		// The title too: folding a project pushes the count in and narrows the title, while the row
		// and the strip keep their size.
		const title = row.querySelector(".ly-fade-tail");
		if (title) observer.observe(title);
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
