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
import { useLayout } from "../../app/layout.tsx";

export type SidebarTab = "projects" | "chats";

/**
 * A mark each, because the two labels are not opposites.
 *
 * 「项目」 and 「聊天」 name what is in the list rather than how it is arranged, and read as two
 * kinds of thing rather than two views of the same conversations. A folder and a message say the
 * arrangement — filed, or spoken — in a form you do not have to read.
 */
export const SIDEBAR_TABS: { value: SidebarTab; label: string; Icon: typeof Folder }[] = [
	{ value: "projects", label: "项目", Icon: Folder },
	{ value: "chats", label: "聊天", Icon: MessageSquare },
];

/**
 * A square control beside the strip — the archive, the list settings.
 *
 * Shared so the two cannot drift apart, which they already had once: two buttons of two heights
 * either side of a control that is a third height reads as three unrelated things rather than one
 * row. The height is the strip's, exactly, so the row has one baseline.
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
			className={`relative flex shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--ly-t-quick)] ${
				compact ? "h-[38px] w-[38px]" : "h-[32px] w-[32px]"
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
	const index = Math.max(0, SIDEBAR_TABS.findIndex((option) => option.value === tab));

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
		 * half at the narrowest drag. The floor in `layout-widths` means this should not be reached
		 * at the default type size; it is what happens when someone raises it.
		 */
		<div className="flex min-w-0 items-center gap-1.5">
			{/*
			 * As wide as its two labels, and no wider.
			 *
			 * It used to take the full width of the pane, which meant widening the sidebar stretched
			 * it — a switch between two things growing to fill whatever space it is given, so the
			 * same control was a different size in every window. Its size is a property of what is
			 * written on it. The buttons go to the far end on their own; see `ml-auto` below.
			 */}
			<div role="tablist" aria-label="侧边栏分区" className="ly-tabs relative flex min-w-0 rounded-lg p-[3px]">
				{/*
				 * One fill that moves, rather than a fill per tab that appears and disappears.
				 *
				 * `translateX(100%)` is exactly one tab's width because the fill is one tab wide — half
				 * the strip less the padding it sits inside, which is what `calc(50% - 3px)` says. Two
				 * tabs only; a third would need the width divided rather than halved, and this control
				 * is the sidebar's two halves rather than a general segmented picker.
				 */}
				<span
					aria-hidden
					// `ly-freeze`: the knob's offset is a fraction of the sidebar's width, so dragging
					// that edge moves it every frame — see the freeze rule in `styles.css`.
					className="ly-tabs-knob ly-freeze absolute inset-y-[3px] left-[3px] rounded-md transition-transform duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
					style={{ width: "calc(50% - 3px)", transform: `translateX(${index * 100}%)` }}
				/>
				{SIDEBAR_TABS.map(({ value, label, Icon }) => {
					const current = value === tab;
					return (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={current}
							data-ly-tab={value}
							onClick={() => onChange(value)}
							/* Equal padding on both, and both labels are two characters, so the two come
							   out the same width — which is what lets the knob be exactly half. */
							className={`relative z-10 flex items-center justify-center gap-1.5 rounded-md transition-colors duration-[var(--ly-t-quick)] ${
								compact ? "h-[32px] px-3.5 text-body" : "h-[26px] px-3 text-label"
							} ${current ? "font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
						>
							{/* A step below the label's weight. The mark is there to be recognised at a
							    glance, not read, and at the same strength it competes with the word. */}
							<Icon size={13} strokeWidth={current ? 2 : 1.8} className="shrink-0" />
							{/* The word is what yields when the row runs out of room; the mark beside it
							    still says which tab this is. */}
							<span className="truncate">{label}</span>
						</button>
					);
				})}
			</div>
			{/* At the far end, and tighter between themselves than between them and the strip: they
			    are one group of controls acting on the list, and the strip is the list's own
			    switch. Even spacing read as four unrelated things in a row. */}
			{trailing && <div className="ml-auto flex shrink-0 items-center gap-0.5">{trailing}</div>}
		</div>
	);
}
