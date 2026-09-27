/**
 * A row of tabs with one knob that slides to the chosen one.
 *
 * The sidebar's `SidebarTabs` does this for exactly two halves, and the settings pages' `Segmented`
 * does it on the card/elevated pair that reads inverted on a light theme (see `tabs.css`). This is
 * the general one: any number of tabs, each as wide as its own label, a count beside the label when
 * there is one — on the same track and knob as the sidebar, so the three read as one control.
 *
 * Switching used to be two backgrounds swapping places in one frame: nothing travelled between the
 * old tab and the new one, so the eye had to find the change instead of following it. The knob
 * travels, and the travel is what says these are positions on one strip rather than separate buttons.
 *
 * The knob is measured rather than computed — labels are different widths, and a count going from
 * 9 to 10 widens one of them. Measured in a layout effect so the first painted frame already has it
 * in place, and again whenever the strip or a tab resizes (fonts arriving, counts changing). The
 * first placement does not animate: `data-ready` holds the transition off until the knob has been
 * somewhere, so it never flies in from the corner.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabStripItem<T extends string> {
	id: T;
	label: string;
	/** Shown after the label, quieter than it. Absent or `undefined` draws nothing. */
	count?: number;
	icon?: ReactNode;
}

export function TabStrip<T extends string>({
	items,
	value,
	onChange,
	label,
	className = "",
}: {
	items: readonly TabStripItem<T>[];
	value: T;
	onChange: (value: T) => void;
	/** The tab list's accessible name. */
	label: string;
	className?: string;
}) {
	const strip = useRef<HTMLDivElement>(null);
	const [knob, setKnob] = useState<{ left: number; width: number } | null>(null);
	const [ready, setReady] = useState(false);
	// What the knob's position depends on, as one string: a new array of the same tabs every render
	// must not tear the observer down and build it again.
	const shape = items.map((item) => `${item.id}\u0000${item.label}\u0000${item.count ?? ""}`).join("\u0001");

	useLayoutEffect(() => {
		const root = strip.current;
		if (!root) return;
		const place = () => {
			const chosen = Array.from(root.querySelectorAll<HTMLElement>("[data-tab]")).find((node) => node.dataset.tab === value);
			if (!chosen) return setKnob(null);
			const next = { left: chosen.offsetLeft, width: chosen.offsetWidth };
			setKnob((was) => (was && was.left === next.left && was.width === next.width ? was : next));
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(root);
		for (const node of root.querySelectorAll("[data-tab]")) observer.observe(node);
		return () => observer.disconnect();
	}, [value, shape]);

	// One frame after the knob first lands, let it move.
	useEffect(() => {
		if (!knob || ready) return;
		const frame = requestAnimationFrame(() => setReady(true));
		return () => cancelAnimationFrame(frame);
	}, [knob, ready]);

	/** Arrow keys walk the strip, the way a tab list is expected to; Home and End jump to its ends. */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const index = items.findIndex((item) => item.id === value);
		const target =
			event.key === "ArrowRight" ? (index + 1) % items.length
			: event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
			: event.key === "Home" ? 0
			: event.key === "End" ? items.length - 1
			: null;
		if (target === null || !items[target]) return;
		event.preventDefault();
		onChange(items[target].id);
		strip.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(items[target].id)}"]`)?.focus();
	};

	return (
		<div
			ref={strip}
			role="tablist"
			aria-label={label}
			// Not a tab stop of its own — focus lands on the chosen tab — but the arrow keys bubble here.
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className={`ly-tabs relative flex max-w-full items-center overflow-x-auto rounded-full p-[3px] [scrollbar-width:none] ${className}`}
		>
			{knob && (
				<span
					aria-hidden
					data-ready={ready || undefined}
					className="ly-tabs-knob pointer-events-none absolute inset-y-[3px] left-0 rounded-full data-[ready]:transition-[transform,width] data-[ready]:duration-[var(--ly-t-base)] data-[ready]:ease-[var(--ly-e-out)]"
					style={{ width: knob.width, transform: `translateX(${knob.left}px)` }}
				/>
			)}
			{items.map((item) => {
				const current = item.id === value;
				return (
					<button
						key={item.id}
						type="button"
						role="tab"
						data-tab={item.id}
						aria-selected={current}
						tabIndex={current ? 0 : -1}
						onClick={() => onChange(item.id)}
						className={`relative z-10 flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-label whitespace-nowrap transition-[color,transform] duration-[var(--ly-t-quick)] active:scale-[0.97] ${
							current ? "font-medium text-ink" : "text-ink-muted hover:text-ink"
						}`}
					>
						{item.icon}
						{item.label}
						{item.count !== undefined && (
							<span className={`text-detail tabular-nums transition-colors duration-[var(--ly-t-quick)] ${current ? "text-ink-muted" : "text-ink-faint"}`}>
								{item.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
