/**
 * A project and the conversations under it.
 *
 * The rows are spaced rather than stacked flush. Their hover and selected states are filled
 * rounded rectangles, and with no gap two adjacent ones merge into a single block — you can no
 * longer tell where one session ends and the next begins.
 *
 * The heading itself is in `ProjectHead`, because it is also drawn pinned over the list.
 */

import { useRef } from "react";
import { useLayout } from "../../app/layout.tsx";
import { Collapsible } from "./Collapsible.tsx";
import type { Group } from "../../lib/sidebar-grouping.ts";
import { ProjectHead } from "./ProjectHead.tsx";
import { rowActions, SessionRow, type RowActions } from "./SessionRow.tsx";
import { ShowMore } from "./ShowMore.tsx";
import { useSidebarReorderContext } from "./reorder-context.ts";
import { DropLineIndicator } from "./DropIndicator.tsx";
import { useUnfold } from "./useUnfold.ts";

/**
 * How many sessions a project shows before the rest are behind 展开显示, and how many more each
 * press reveals.
 *
 * The same number for both on purpose. One press used to open everything, which on a project with
 * forty conversations replaced a five-row group with a wall — and the only way back was a single
 * 收起 that threw away however far you had read. Revealing another five is a step you can take
 * repeatedly and stop at.
 */
const COLLAPSED_SESSION_COUNT = 5;
export const SESSION_PAGE = COLLAPSED_SESSION_COUNT;

export function ProjectGroup({
	group,
	pins = true,
	shown,
	collapsed,
	onToggleCollapsed,
	onShowMore,
	onCollapse,
	actions,
}: {
	group: Group;
	/**
	 * Whether this heading takes part in pinning.
	 *
	 * False for a project inside a folded 「置顶」 section: it is still mounted and still has a box,
	 * so it would still measure, and a heading nobody can see would pin at the top of the pane.
	 */
	pins?: boolean;
	/** How many rows this group is currently showing. */
	shown: number;
	/** Folded shut, hiding its sessions. Remembered across launches. */
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onShowMore: () => void;
	onCollapse: () => void;
	actions: RowActions;
}) {
	const { compact } = useLayout();
	const rows = useRef<HTMLDivElement>(null);
	const unfold = useUnfold(rows);
	const visible = group.sessions.slice(0, Math.max(COLLAPSED_SESSION_COUNT, shown));
	const hidden = group.sessions.length - visible.length;
	// Only worth offering once something has actually been opened up.
	const canCollapse = visible.length > COLLAPSED_SESSION_COUNT;
	const reorder = useSidebarReorderContext();
	const isDraggingThisProject = reorder?.dragging?.kind === "project" && reorder.dragging.id === group.path;
	const isTargetThisProject = reorder?.dropTarget?.kind === "project" && reorder.dropTarget.id === group.path;

	return (
		<div
			data-ly-band
			className={`relative mb-2 flex flex-col transition-opacity duration-[var(--ly-t-quick)] ${
				isDraggingThisProject ? "opacity-35" : ""
			}`}
		>
			{isTargetThisProject && <DropLineIndicator placement={reorder!.dropTarget!.placement} />}
			{/*
			 * Held at the rail while you are inside this project, and pushed out by the next one.
			 *
			 * Sticky *within this block* rather than within the list, which is the whole of the
			 * hand-off: when the block scrolls past, its heading goes with it, and the next block's
			 * heading arrives on its own. There is no code for that anywhere — it falls out of where
			 * the element sits.
			 *
			 * No fill: the rows passing underneath fade out before they get there, and so does this
			 * heading before the next one pushes it under the strip — `data-ly-band` is what that
			 * fade reads (`ly-under-pin`). `data-ly-head` is what the fade measures against so the
			 * list softens below it rather than through it.
			 */}
			<div data-ly-head={pins ? "" : undefined} className="sticky top-[var(--ly-rail)] z-20">
				<ProjectHead group={group} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
			</div>

			<Collapsible open={!collapsed}>
				{/* The gap lives here rather than on the outer column, or a folded project would keep
				    the space between rows it no longer has. */}
				<div className={`flex flex-col ${compact ? "gap-[5px] pt-[5px]" : "gap-[2px] pt-[4px]"}`}>
					{/* Wraps only the rows: the show-more button stays outside, so it rides the bottom edge while unfolding and folding (see `useUnfold`). */}
					<div ref={rows} className={`flex flex-col ${compact ? "gap-[5px]" : "gap-[2px]"}`}>
						{visible.map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								{...rowActions(actions, session)}
							/>
						))}
					</div>

					<ShowMore
						hidden={hidden}
						canCollapse={canCollapse}
						onShowMore={unfold.unfold(onShowMore)}
						onCollapse={unfold.fold(COLLAPSED_SESSION_COUNT, onCollapse)}
					/>
				</div>
			</Collapsible>
		</div>
	);
}
