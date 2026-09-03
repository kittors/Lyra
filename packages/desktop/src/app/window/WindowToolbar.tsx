/**
 * The window's top edge: what drags it, and the buttons that float over everything.
 *
 * All three parts are here because their order in the DOM is the whole point. Electron builds the
 * draggable region by walking the document in order, so a `drag` element after a `no-drag` one
 * fills the hole back in — which is why these are rendered last in the shell, and why the band and
 * the buttons are separate elements rather than one.
 */

import { Check, MoreVertical } from "lucide-react";
import { useDock } from "../../features/dock/index.ts";
import { has } from "../../features/dock/index.ts";
import { usePanelDefinitions } from "../../features/dock/index.ts";
import type { PanelKind } from "../../features/dock/index.ts";
import { useLayout } from "../layout.tsx";
import { MenuBody, MenuItem, MenuLabel, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { TOOLBAR_BUTTON, ToolbarButton, WindowControls } from "./WindowControls.tsx";

/*
 * The update chip used to have a slot of its own here, just past the sidebar toggle.
 *
 * It has moved to the end of the sidebar's bottom row, where it is a dot that opens on hover.
 * Nothing about the toolbar was wrong for it except the size of the claim: the corner of the
 * window is where the window's own controls are, and a version number is not one of them.
 */

/**
 * The strip of window that can be dragged to move it.
 *
 * As wide as the navigation and no wider, which is a change: it used to span the window. The dock
 * now reaches the top edge, and every pane's title bar is up there — a full-width band would claim
 * all of them, so pressing a pane's title would move the window instead of the pane.
 *
 * With the navigation closed it shrinks to the corner the traffic lights need, which is the only
 * part of that row that is still the window's rather than a pane's.
 */
export function DragBand({ navOpen, sidebarWidth }: { navOpen: boolean; sidebarWidth: number }) {
	const { titlebar } = useLayout();
	return (
		<div
			className="drag-region absolute top-0 left-0 z-40 h-[44px]"
			/*
			 * Closed, this is only the corner the system's own controls need — which is the traffic
			 * lights on macOS and nothing at all elsewhere, where they are at the other end. The
			 * toggle beside them is `no-drag`, so a band the width of the button alone would leave
			 * no draggable pixels; a little more than the toggle's own start is what makes the
			 * corner grabbable without claiming the pane title next to it.
			 */
			style={{ width: navOpen ? sidebarWidth : titlebar.start + TOOLBAR_BUTTON }}
		/>
	);
}

/**
 * The panels that get a button of their own, in the order they sit in.
 *
 * A shortlist, not the whole registry. These are the three you reach for while working — a shell,
 * a page, the diff — and reaching for them through two clicks of a menu is two clicks too many.
 * Everything else, including anything a plugin contributes, is in the menu beside them, which is
 * also where these three appear when they cannot be opened.
 */
const QUICK: PanelKind[] = ["terminal", "browser", "review"];

/**
 * Which panels are in the window: three buttons and a menu.
 *
 * Rendered *inside the conversation pane's own title bar* rather than in a toolbar of its own.
 * A toolbar cost a whole row of the window and put these buttons on a different line from the pane
 * titles they act on — two strips where the reference has one.
 *
 * This is also all that is left of what used to be three separate controls: a panel toggle, a
 * full-screen toggle, and the tab strip's add button. The dock removed the questions they answered
 * — there is no panel to open or collapse, and no full screen distinct from a pane being large.
 */
export function PanelMenu() {
	const menu = usePopover();
	const definitions = usePanelDefinitions();
	const tree = useDock((s) => s.tree);
	const open = useDock((s) => s.open);
	const close = useDock((s) => s.close);

	const toggle = (kind: PanelKind) => (has(tree, kind) ? close(kind) : open(kind));

	return (
		<>
			<div className="flex items-center gap-0.5">
				{QUICK.map((kind) => {
					const def = definitions.find((entry) => entry.kind === kind);
					// Absent rather than disabled when it cannot be opened: a row of greyed buttons
					// is a row of things you have to read before you can ignore them. The menu still
					// lists them, with the reason.
					if (!def || def.unavailable) return null;
					return (
						<ToolbarButton
							key={kind}
							label={`${def.label} ${def.shortcut}`}
							active={has(tree, kind)}
							onClick={() => toggle(kind)}
						>
							<def.icon size={13} strokeWidth={1.9} />
						</ToolbarButton>
					);
				})}

				{/* The overflow mark every toolbar uses for "the rest of it". */}
				<ToolbarButton label="面板" onClick={menu.toggle} active={menu.open}>
					<MoreVertical size={15} strokeWidth={2} />
				</ToolbarButton>
			</div>

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="default">
					<MenuBody>
						<MenuLabel>面板</MenuLabel>
						{/*
						 * Absent, not greyed.
						 *
						 * The list used to show everything and disable what could not be opened, on the
						 * reasoning that a stated reason beats an unexplained gap. In practice it is four
						 * grey rows out of eight — a menu where half the items are things you have to
						 * read before you can ignore them, every time you open it. What a panel needs in
						 * order to exist is not something to be told each time; it is obvious the moment
						 * you have a project open, because the panel is simply there.
						 */}
						{definitions
							.filter((def) => !def.unavailable)
							.map((def) => {
							const shown = has(tree, def.kind);
							return (
								<MenuItem
									key={def.kind}
									icon={<def.icon size={13.5} strokeWidth={1.8} />}
									hint={def.shortcut}
									// A tick, not a highlight: this is a set of things that are either
									// in the window or not, and every row is independently either.
									trailing={shown ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
									onClick={() => {
										if (shown) close(def.kind);
										else open(def.kind);
										menu.close();
									}}
								>
									{def.label}
								</MenuItem>
							);
						})}
					</MenuBody>
				</Popover>
			)}
		</>
	);
}

/**
 * The window's own controls: the traffic lights' neighbour, and nothing else.
 *
 * Unconditional now. This used to be rendered only when no panel was covering the window's corner,
 * because in that case the panel drew its own copy inside its tab strip — a handover that had to
 * be delayed by exactly the length of the panel's slide, or the buttons appeared riding its edge
 * and swept 450px across the window. The dock puts every pane below the toolbar, so the corner is
 * the sidebar's or the toolbar's and never changes hands.
 */
export function WindowButtons({
	navOpen,
	compact,
	onToggleNav,
}: {
	navOpen: boolean;
	compact: boolean;
	onToggleNav: () => void;
}) {
	const { titlebar } = useLayout();
	return (
		<div
			className="no-drag absolute top-0 z-[60] flex h-[44px] items-center gap-0.5"
			/*
			 * Past whatever the system drew in this corner: the traffic lights on macOS, nothing on
			 * Windows and Linux — where this used to sit 78px in anyway, out of line with the marks
			 * directly below it and adrift from the edge. `useTitlebar` is the whole rule.
			 */
			style={{ left: titlebar.start }}
		>
			<WindowControls navOpen={navOpen} onToggleNav={onToggleNav} active={compact && navOpen} />
		</div>
	);
}
