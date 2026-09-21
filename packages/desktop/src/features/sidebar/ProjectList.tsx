/**
 * The 「项目」 half of the sidebar: pinned projects, the rest, and the conversations filed under
 * neither.
 *
 * Lifted out of `Sidebar` when the pane grew a second half. Nothing about the arrangement changed —
 * this is the list that was always there — but it now has to be able to say which of its rows pin,
 * because a project inside a folded 「置顶」 section is still in the DOM and still has a box, and
 * measuring it would put a heading nobody can see at the top of the pane.
 */

import { translate } from "../../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import { GroupActivity } from "./GroupActivity.tsx";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { ProjectDialog } from "../modals/index.ts";
import { Collapsible } from "./Collapsible.tsx";
import type { Grouped } from "./grouping.ts";
import { ProjectGroup, SESSION_PAGE } from "./ProjectGroup.tsx";
import { rowActions, SessionRow, type RowActions } from "./SessionRow.tsx";
import { ShowMore } from "./ShowMore.tsx";
import { useSidebarReorder } from "./useSidebarReorder.ts";
import { SidebarReorderContext } from "./reorder-context.ts";
import type { SortKey } from "./ListMenu.tsx";
import { CarriedPill } from "./DropIndicator.tsx";

/**
 * Fold keys for the two sections, which are not projects and have no path.
 *
 * `§` because every project key is an absolute path and none of them can start with one, so the
 * two kinds share a store without a chance of collision.
 */
const PINNED = "§pinned";
const PROJECTS = "§projects";
const RECENT = "§recent";

export function ProjectList({
	groups,
	activePath,
	collapsed,
	onToggleCollapsed,
	groupProps,
	looseShown,
	onLooseMore,
	onLooseCollapse,
	actions,
	onReordered,
	sort,
	empty,
}: {
	groups: Grouped;
	/** The project the workspace is currently on, which is drawn as open. */
	activePath: string | undefined;
	collapsed: string[];
	onToggleCollapsed: (key: string) => void;
	/** Everything a `ProjectGroup` needs that is per-project state rather than per-project data. */
	groupProps: (path: string) => Omit<React.ComponentProps<typeof ProjectGroup>, "group" | "active" | "pins">;
	looseShown: number;
	onLooseMore: () => void;
	onLooseCollapse: () => void;
	actions: RowActions;
	onReordered?: () => void;
	sort: SortKey;
	/** What an empty list says, which differs between the sidebar and the archive. */
	empty: React.ReactNode;
}) {
	const { compact } = useLayout();
	const reorder = useSidebarReorder(groups, sort, onReordered);
	const [creating, setCreating] = useState(false);
	const pinnedShut = collapsed.includes(PINNED);
	const hasPinned = (groups.pinnedSessions?.length ?? 0) > 0 || groups.pinned.length > 0;
	const pinnedCount = (groups.pinnedSessions?.length ?? 0) + groups.pinned.length;

	if (!hasPinned && groups.projects.length === 0 && groups.loose.length === 0) {
		return <>{empty}</>;
	}
	return (
		<SidebarReorderContext.Provider value={reorder.contextValue}>
			{reorder.dragging && <CarriedPill item={reorder.dragging} pointer={reorder.pointer} />}
			{creating && <ProjectDialog onClose={() => setCreating(false)} />}
			{hasPinned && (
				<>
					<SectionLabel section="pinned" sessions={[...groups.pinnedSessions, ...groups.pinned.flatMap((group) => group.sessions)]} count={pinnedCount} collapsed={pinnedShut} onToggle={() => onToggleCollapsed(PINNED)}>
						{translate("projectList.pinned")}
					</SectionLabel>
					<Collapsible open={!pinnedShut}>
						<div className={`flex flex-col ${compact ? "gap-[5px]" : "gap-[4px]"}`}>
							{groups.pinnedSessions?.map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									project={session.projectName}
									{...rowActions(actions, session)}
								/>
							))}
						</div>
						{groups.pinned.map((group) => (
							<ProjectGroup
								key={group.path}
								group={group}
								active={activePath === group.path}
								pins={!pinnedShut}
								{...groupProps(group.path)}
							/>
						))}
					</Collapsible>
				</>
			)}

			{/*
			 * 「项目」 is a boundary, not a caption for a single folder.
			 *
			 * Without it, the first ordinary project sits on the same visual run as 「置顶」 and
			 * reads as pinned. The project's own row still names the place; this heading only
			 * says which list you are in.
			 */}
			{groups.projects.length > 0 && (
				<>
					<SectionLabel
						section="projects"
						sessions={groups.projects.flatMap((group) => group.sessions)}
						count={groups.projects.length}
						collapsed={collapsed.includes(PROJECTS)}
						onToggle={() => onToggleCollapsed(PROJECTS)}
						/*
						 * 新建项目, at the top of the list it adds to.
						 *
						 * It already lives in the project switcher hanging off the composer's chip,
						 * which is where you go when you want a *different* project. This is the
						 * other intent — adding one — and the list of them is where you are when
						 * you have it.
						 */
						action={
							<button
								type="button"
								onClick={() => setCreating(true)}
								data-ly-tip={translate("project.new")}
								aria-label={translate("project.new")}
								className="rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
							>
								<Plus size={13} strokeWidth={2} aria-hidden />
							</button>
						}
					>
						{translate("projectList.projects")}
					</SectionLabel>
					<Collapsible open={!collapsed.includes(PROJECTS)}>
						{groups.projects.map((group) => (
							<ProjectGroup key={group.path} group={group} active={activePath === group.path} {...groupProps(group.path)} />
						))}
					</Collapsible>
				</>
			)}

			{groups.loose.length > 0 && (
				<>
					<SectionLabel
						section="recent"
						sessions={groups.loose}
						count={groups.loose.length}
						collapsed={collapsed.includes(RECENT)}
						onToggle={() => onToggleCollapsed(RECENT)}
					>
						{translate("projectList.recent")}
					</SectionLabel>
					{/* Flat rows, the same ones a project shows — the section is what differs, not the
					    conversation. Same gap as inside a project, so the two read as one list. */}
					<Collapsible open={!collapsed.includes(RECENT)}>
						<div className={`flex flex-col ${compact ? "gap-[5px]" : "gap-[4px]"}`}>
							{groups.loose.slice(0, looseShown).map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									{...rowActions(actions, session)}
								/>
							))}
							<ShowMore
								hidden={Math.max(0, groups.loose.length - looseShown)}
								canCollapse={looseShown > SESSION_PAGE}
								onShowMore={onLooseMore}
								onCollapse={onLooseCollapse}
							/>
						</div>
					</Collapsible>
				</>
			)}
		</SidebarReorderContext.Provider>
	);
}

/**
 * A section heading, which is also the control that folds the section.
 *
 * The projects underneath already fold one at a time; a section that could not fold meant the only
 * way to put away a long 「最近」 was to fold nothing and scroll past it. Making the heading itself
 * the target keeps the row count the same — no chevron column appearing beside every label, no
 * second thing to aim at.
 *
 * The count only shows while shut. Open, the rows are the count; shut, it is the difference
 * between "folded" and "empty", which are otherwise the same picture.
 *
 * Not pinned, unlike a project name. There are at most two of these and they divide the list into
 * runs rather than label a place in it — a heading that says 「置顶」 held at the top of the pane
 * while you scroll through the projects under it tells you nothing you did not already know, and
 * it would be competing for the one rail the project names need.
 */
function SectionLabel({
	children,
	section,
	count,
	sessions,
	collapsed,
	onToggle,
	action,
}: {
	children: React.ReactNode;
	section: "pinned" | "projects" | "recent";
	count: number;
	sessions: SessionMeta[];
	collapsed: boolean;
	onToggle: () => void;
	/**
	 * One control that belongs to the section rather than to the fold.
	 *
	 * Overlaid rather than placed in the row, for the same reason the project rows overlay theirs:
	 * a second element in the flow would hold a gutter open on all three headings to serve the one
	 * that uses it. It sits on the count's pixels and they take turns — hovering is reaching for
	 * the button, so the count is what yields.
	 */
	action?: React.ReactNode;
}) {
	return (
		// Not a button around a button. The heading stays the fold's target; the action is a
		// sibling laid over its trailing edge.
		<div className="group/section relative flex w-full items-center pt-4">
			<button
				type="button"
				data-ly-section={section}
				aria-expanded={!collapsed}
				onClick={onToggle}
				className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 pb-1.5 text-left text-detail font-medium text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink-muted"
			>
				{children}
				<ChevronRight
					size={12}
					strokeWidth={2.2}
					className={`shrink-0 opacity-0 transition-[opacity,transform] duration-[var(--ly-t-quick)] group-hover/section:opacity-100 ${
						collapsed ? "" : "rotate-90"
					}`}
				/>
				<span
					data-ly-section-count
					className={`ml-auto flex min-w-5 items-center justify-end tabular-nums transition-opacity duration-[var(--ly-t-quick)] ${
						action ? "group-hover/section:opacity-0 group-has-[:focus-visible]/section:opacity-0" : ""
					}`}
				>
					<GroupActivity sessions={sessions} collapsed={collapsed} count={count} />
				</span>
			</button>
			{action && (
				<span
					data-ly-section-action
					className="absolute right-2 bottom-1.5 flex items-center opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/section:opacity-100 group-has-[:focus-visible]/section:opacity-100"
				>
					{action}
				</span>
			)}
		</div>
	);
}
