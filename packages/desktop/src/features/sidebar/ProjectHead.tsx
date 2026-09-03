/**
 * A project's name row — the heading for the conversations under it.
 *
 * Its own file because it is drawn in two places. In the list it holds the space and is what the
 * pinning measures against; over the list it is the copy that stays put while you scroll through
 * the project, which is the whole reason you can still tell which one you are in forty rows down.
 * `StickyLayer` renders the second, from the same component, so the two cannot drift.
 *
 * The open project is not filled, unlike the open session. Both used to take the same fill, so an
 * open project sitting directly above its own open session put two identical blocks four pixels
 * apart — one continuous grey slab with no hierarchy left in it. A project is a heading for the
 * sessions under it, not one of the things you pick between; it says it is open by the weight of
 * its name and the colour of its icon, and keeps the fill for hover, where it means "you are about
 * to press this".
 */

import { ChevronRight, Folder, MoreHorizontal, SquarePen } from "lucide-react";
import { useLayout } from "../../app/layout.tsx";
import { ProjectMenu } from "../modals/ProjectMenu.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import type { Group } from "./grouping.ts";
import { startProjectSession } from "./newSession.ts";

export function ProjectHead({
	group,
	active,
	collapsed,
	onToggleCollapsed,
}: {
	group: Group;
	active: boolean;
	collapsed: boolean;
	onToggleCollapsed: () => void;
}) {
	const { compact } = useLayout();
	const menu = usePopover();

	return (
		/* Same hover-owner arrangement as the session rows: the fill belongs to the row so
		   reaching for the menu button does not drop it. */
		<div
			className="ly-scroll group/project relative rounded-lg transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover active:bg-elevated"
			onContextMenu={(event) => {
				event.preventDefault();
				// At the cursor: right-click acts on the row as a whole, so there is no one
				// control for the menu to hang off.
				menu.openAtPoint(event);
			}}
		>
			{/*
			 * The heading folds the project; switching to it moved into the menu.
			 *
			 * A project name is a heading for the rows under it, and the thing you want from a
			 * heading in a list this long is to be able to put it away. Switching workspace is
			 * the rarer intent and it already happens on its own whenever you open a session
			 * inside — so it lost the click and kept a menu item, rather than the two sharing
			 * one target and the fold never existing.
			 */}
			<button
				type="button"
				aria-expanded={!collapsed}
				onClick={onToggleCollapsed}
				className={`flex w-full items-center gap-2.5 rounded-lg pr-2 pl-2 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${
					compact ? "h-[40px]" : "h-[31px]"
				} ${active ? "font-medium text-ink" : "text-ink group-hover/project:text-ink"}`}
			>
				{/*
				 * The folder turns into a chevron under the pointer.
				 *
				 * At rest the icon says what the row is; reaching for it, it says what pressing
				 * will do. Two marks in one place, neither of them a permanent extra control —
				 * and the rotation carries the open/shut state without a third element.
				 */}
				<span className={`relative h-[15px] w-[15px] shrink-0 ${active ? "text-accent" : "text-ink-muted"}`}>
					<Folder
						size={15}
						strokeWidth={1.8}
						className="absolute inset-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/project:opacity-0"
					/>
					<ChevronRight
						size={15}
						strokeWidth={2}
						className={`absolute inset-0 opacity-0 transition-[opacity,transform] duration-[var(--ly-t-quick)] group-hover/project:opacity-100 ${
							collapsed ? "" : "rotate-90"
						}`}
					/>
				</span>
				<ScrollText text={group.name} className="ly-fade-tail min-w-0 flex-1" />
				{/*
				 * How many are folded away, so a shut project is not indistinguishable from an
				 * empty one. Only while shut: open, the rows themselves are the count.
				 *
				 * It vacates under the pointer, the same way the folder does. The menu button
				 * lives at this exact spot, and the two drawn together was not two things
				 * crowding each other — it was a numeral and an icon on the same pixels, legible
				 * as neither. Hovering is reaching for the button, so the count is what yields.
				 */}
				{collapsed && group.sessions.length > 0 && (
					<span className="shrink-0 text-caption text-ink-faint tabular-nums transition-opacity duration-[var(--ly-t-quick)] group-hover/project:opacity-0">
						{group.sessions.length}
					</span>
				)}
			</button>

			<span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-lg pr-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/project:opacity-100 group-has-[:focus-visible]/project:opacity-100">
				<button
					type="button"
					data-ly-tip="在这个项目里新建会话"
					aria-label={`在「${group.name}」里新建会话`}
					onClick={() => void startProjectSession(group.path, collapsed ? onToggleCollapsed : undefined)}
					className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
				>
					<SquarePen size={13} strokeWidth={1.8} />
				</button>
				<button
					type="button"
					data-ly-tip="项目操作"
					aria-label={`「${group.name}」的项目操作`}
					aria-haspopup="menu"
					onClick={menu.toggle}
					className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
				>
					<MoreHorizontal size={13} strokeWidth={1.8} />
				</button>
			</span>

			{menu.open && <ProjectMenu anchor={menu.anchor} path={group.path} name={group.name} onClose={menu.close} />}
		</div>
	);
}
