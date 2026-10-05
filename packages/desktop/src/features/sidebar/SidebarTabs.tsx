/**
 * The sidebar's two halves, and the switch between them.
 *
 * Conversations used to only exist inside their project, which made the most recent one the hardest
 * thing in the pane to reach: it was under whichever project it belonged to, five rows down, past
 * however many other projects came first. A project is found by its name and a conversation is
 * found by when you last touched it, and one list cannot be ordered both ways — so there are two.
 *
 * The strip pins to the top of the list rather than living above it. It is the list's own control,
 * not the pane's, and a fixed row would have spent a third of a narrow column on it before the
 * first conversation ever appeared. `StickyLayer` is what actually holds it there.
 *
 * Same fill relationship as the settings pages' `Segmented` — `bg-card` under `bg-elevated` — so
 * the two read as the same control at two sizes. What differs is the slide: this one is switched
 * often enough that the moving fill is worth the element, and it says which way you went.
 */

import { Folder, MessageSquare } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { fitTabs } from "./tab-fit.ts";

export type SidebarTab = "projects" | "chats";

/**
 * A mark each, because the two labels are not opposites.
 *
 * 「项目」 and 「聊天」 name what is in the list rather than how it is arranged, and read as two
 * kinds of thing rather than two views of the same conversations. A folder and a message say the
 * arrangement — filed, or spoken — in a form you do not have to read. Which is also why, when the
 * words do not fit, the marks alone are enough.
 */
const SIDEBAR_TABS: { value: SidebarTab; labelKey: MessageKey; Icon: typeof Folder }[] = [
	{ value: "projects", labelKey: "sidebar.projects", Icon: Folder },
	{ value: "chats", labelKey: "sidebar.chats", Icon: MessageSquare },
];

/**
 * The least that a tab's padding is squeezed to before the words go. Any tighter and the mark and
 * the word are pressed up against the knob's edges, which reads as crammed in rather than as a tab.
 * 4px against the capsule's own 6/8px (`pl-1.5 pr-2`) — the same proportion as 8 against 12.
 */
const PAD_FLOOR = 4;

/**
 * A word's own width, whether or not it is on screen right now.
 *
 * The box is exact while the word shows. Hidden — only the marks fit — or cut short for a frame,
 * the box is what is left of it and `scrollWidth` is all of it: rounded to a pixel, so one more to
 * be sure it is never short. That is how the words come back once the sidebar is widened again.
 */
function wordWidth(label: HTMLElement | null): number {
	if (!label) return 0;
	if (label.scrollWidth > label.clientWidth) return label.scrollWidth + 1;
	return label.getBoundingClientRect().width;
}

/**
 * A square control beside the strip — the archive, the list settings.
 *
 * Shared so the two cannot drift apart, which they already had once: two buttons of two heights
 * either side of a control that is a third height reads as three unrelated things rather than one
 * row. Sized at 24px — the strip's own tabs are 24px too, so the buttons line
 * up with them rather than with the strip's outer edge.
 */
export function StripButton({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
}) {
	const { compact } = useLayout();
	return (
		<button
			type="button"
			data-ly-tip={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={`relative flex shrink-0 items-center justify-center transition-colors duration-[var(--ly-t-quick)] ${
				compact ? "h-[38px] w-[38px] rounded-lg" : "h-[24px] w-[24px] rounded-lg"
			} ${active ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"}`}
		>
			{children}
		</button>
	);
}

export function SidebarTabs({
	tab,
	onChange,
	trailing,
}: {
	tab: SidebarTab;
	onChange: (tab: SidebarTab) => void;
	/**
	 * A control that acts on whichever list is showing, sat beside the switch rather than inside it.
	 *
	 * The archive is the one that exists: it is neither of the two lists but a third state of both,
	 * so it cannot be a third tab — and it has to stay reachable from either, which is what being
	 * outside the strip gives it.
	 */
	trailing?: React.ReactNode;
}) {
	const { compact } = useLayout();
	const { t } = useI18n();
	// The pill is 28px: 2px of padding around 24px tabs. Drawer mode keeps the old 3px padding, and the strip there is still 38px.
	const pad = compact ? 3 : 2;
	const row = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const beside = useRef<HTMLDivElement>(null);
	/*
	 * What the fit decided, and for which layout. `squeeze` is null while the tabs have the padding
	 * the stylesheet gives them, and only otherwise overrides it: the drawer, and anything else that
	 * restyles these tabs, keep their own padding whenever there is room for it. A fit worked out
	 * for the other layout says nothing about this one, so it is set aside rather than applied.
	 */
	const [fit, setFit] = useState<{ squeeze: number | null; words: boolean; compact: boolean }>({
		squeeze: null,
		words: true,
		compact,
	});
	const squeeze = fit.compact === compact ? fit.squeeze : null;
	const words = fit.compact === compact ? fit.words : true;
	/** The stylesheet's own padding, read whenever it is not being overridden. */
	const full = useRef(0);
	const [knob, setKnob] = useState<{ left: number; width: number } | null>(null);
	// What the fit depends on besides the row's width, as one string: switching language changes it.
	const labels = SIDEBAR_TABS.map(({ labelKey }) => t(labelKey)).join("\u0000");

	/*
	 * Fit the tabs to the row, then put the knob on the chosen one — in that order, and never both
	 * in one pass, because the knob is measured off tabs the fit is about to resize.
	 *
	 * In a layout effect so the first painted frame already has both in place, and again whenever
	 * the row or a tab resizes: the sidebar's edge being dragged, fonts arriving. A fit that changes
	 * returns early and comes back through this effect once it has been drawn, which is also why the
	 * knob is first created at its final size rather than easing there from a guess.
	 *
	 * Everything is measured rather than assumed — the padding, the marks, the words — because a
	 * stylesheet is free to draw these tabs at another size, and a fit worked out for sizes they are
	 * not drawn at is the overflow this exists to prevent.
	 */
	useLayoutEffect(() => {
		const rowNode = row.current;
		const listNode = list.current;
		if (!rowNode || !listNode) return;
		const measure = () => {
			// Nothing to fit while the pane is not laid out.
			if (rowNode.clientWidth === 0) return;
			const tabs = [...listNode.querySelectorAll<HTMLElement>("[data-ly-tab]")];
			if (tabs.length === 0) return;
			const style = getComputedStyle(tabs[0]);
			// The capsule's padding is uneven (`pl-1.5 pr-2`); the fit squeezes both sides alike, so it
			// works from their mean — which is also what the two sides add up to between them.
			if (squeeze === null) {
				full.current = (Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)) / 2;
			}
			const trailingWidth = beside.current
				? beside.current.offsetWidth + Number.parseFloat(getComputedStyle(rowNode).columnGap)
				: 0;
			const next = fitTabs(
				rowNode.clientWidth - trailingWidth - pad * 2,
				tabs.map((node) => wordWidth(node.querySelector<HTMLElement>("[data-ly-tab-label]"))),
				(tabs[0].querySelector("svg")?.getBoundingClientRect().width ?? 0) + Number.parseFloat(style.columnGap),
				{ full: full.current, floor: PAD_FLOOR },
			);
			const nextSqueeze = next.words && next.pad < full.current ? next.pad : null;
			if (nextSqueeze !== squeeze || next.words !== words) {
				return setFit({ squeeze: nextSqueeze, words: next.words, compact });
			}
			const chosen = tabs.find((node) => node.dataset.lyTab === tab);
			if (!chosen) return;
			const at = { left: chosen.offsetLeft, width: chosen.offsetWidth };
			setKnob((was) => (was && was.left === at.left && was.width === at.width ? was : at));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(rowNode);
		for (const node of listNode.querySelectorAll("[data-ly-tab]")) observer.observe(node);
		return () => observer.disconnect();
	}, [tab, squeeze, words, compact, labels, pad]);

	return (
		/*
		 * No padding of its own, and that is load-bearing rather than a style choice.
		 *
		 * This is drawn twice: once in the list, once pinned over it — and pinned, it is the only
		 * thing hiding the rows passing underneath. Transparent padding is a slot for those rows to
		 * show through, a few pixels of list sliding across the top of the pane. So the box ends
		 * where the control ends, the space around it belongs to its neighbours in the list, and
		 * `layoutSticky`'s `gap` is what keeps it off the top edge when it is held.
		 */
		/*
		 * `min-w-0`, so the row can be narrower than its contents want to be.
		 *
		 * Without it a flex item never shrinks below its content, and the overflow goes *outside*
		 * the pane rather than being absorbed — which is how the archive button ended up sliced in
		 * half at the narrowest drag. In Chinese the floor in `layout-widths` keeps this from being
		 * reached at the default type size; longer words reach it sooner, and `fitTabs` decides
		 * what gives.
		 */
		<div ref={row} className="flex min-w-0 items-center gap-1.5">
			{/*
			 * As wide as its two labels, and no wider.
			 *
			 * It used to take the full width of the pane, which meant widening the sidebar stretched
			 * it — a switch between two things growing to fill whatever space it is given, so the
			 * same control was a different size in every window. Its size is a property of what is
			 * written on it. The buttons go to the far end on their own; see `ml-auto` below.
			 */}
			<div ref={list} role="tablist" aria-label={t("sidebar.sections")} className="ly-tabs relative flex min-w-0 rounded-full" style={{ padding: pad }}>
				{/*
				 * One fill that moves, rather than a fill per tab that appears and disappears.
				 *
				 * Measured off the chosen tab rather than computed as half the strip. Half held while
				 * both words were two characters; "Projects" is half again "Chats", and a knob half
				 * the strip wide left the longer word running out of it and into its neighbour.
				 */}
				{knob && (
					<span
						aria-hidden
						// `ly-freeze`: the tabs give way as the sidebar narrows, so dragging its edge can
						// move the knob every frame — see the freeze rule in `styles.css`.
						className="ly-tabs-knob ly-freeze absolute left-0 rounded-full transition-[transform,width] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
						style={{ top: pad, bottom: pad, width: knob.width, transform: `translateX(${knob.left}px)` }}
					/>
				)}
				{SIDEBAR_TABS.map(({ value, labelKey, Icon }) => {
					const current = value === tab;
					const label = t(labelKey);
					return (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={current}
							data-ly-tab={value}
							// With the word hidden, pointing at the mark is how you read its name.
							data-ly-tip={words ? undefined : label}
							onClick={() => onChange(value)}
							/* Each as wide as its own word. `min-w-0` for the frame between the row
							   narrowing and the fit catching up: the word is cut short for that frame
							   rather than running under the buttons beside the strip. */
							className={`relative z-10 flex min-w-0 items-center justify-center rounded-full font-medium transition-colors duration-[var(--ly-t-quick)] ${
								compact ? "h-[32px] gap-1.5 px-3.5 text-body" : "h-[24px] gap-1 pr-2 pl-1.5 text-caption"
							} ${current ? "text-ink" : "text-ink-muted hover:text-ink"}`}
							style={squeeze === null ? undefined : { paddingInline: squeeze }}
						>
							{/* A step below the label's weight. The mark is there to be recognised at a
							    glance, not read, and at the same strength it competes with the word. */}
							<Icon size={compact ? 13 : 12} strokeWidth={current ? 2 : 1.8} className="shrink-0" />
							{/* The word is what yields when the row runs out of room; the mark beside it
							    still says which tab this is. Hidden rather than removed, so the tab
							    keeps its name for a screen reader, and so the word can still be
							    measured to tell when it fits again. */}
							<span data-ly-tab-label className={words ? "truncate" : "sr-only"}>
								{label}
							</span>
						</button>
					);
				})}
			</div>
			{/* At the far end, and tighter between themselves than between them and the strip: they
			    are one group of controls acting on the list, and the strip is the list's own
			    switch. Even spacing read as four unrelated things in a row. */}
			{trailing && (
				<div ref={beside} className="ml-auto flex shrink-0 items-center gap-1">
					{trailing}
				</div>
			)}
		</div>
	);
}
