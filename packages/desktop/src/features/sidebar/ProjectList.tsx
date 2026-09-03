/**
 * The 「项目」 half of the sidebar: pinned projects, the rest, and the conversations filed under
 * neither.
 *
 * Lifted out of `Sidebar` when the pane grew a second half. Nothing about the arrangement changed —
 * this is the list that was always there — but it now has to be able to say which of its rows pin,
 * because a project inside a folded 「置顶」 section is still in the DOM and still has a box, and
 * measuring it would put a heading nobody can see at the top of the pane.
 */

import { ChevronRight } from "lucide-react";
import { useLayout } from "../../app/layout.tsx";
import { Collapsible } from "./Collapsible.tsx";
import type { Grouped } from "./grouping.ts";
import { ProjectGroup, SESSION_PAGE } from "./ProjectGroup.tsx";
import { rowActions, SessionRow, type RowActions } from "./SessionRow.tsx";
import { ShowMore } from "./ShowMore.tsx";

/**
 * Fold keys for the two sections, which are not projects and have no path.
 *
 * `§` because every project key is an absolute path and none of them can start with one, so the
 * two kinds share a store without a chance of collision.
 */
export const PINNED = "§pinned";
export const RECENT = "§recent";

export function ProjectList({
	groups,
	activePath,
	activeSessionId,
	collapsed,
	onToggleCollapsed,
	groupProps,
	looseShown,
	onLooseMore,
	onLooseCollapse,
	actions,
	empty,
}: {
	groups: Grouped;
	/** The project the workspace is currently on, which is drawn as open. */
	activePath: string | undefined;
	activeSessionId: string | null;
	collapsed: string[];
	onToggleCollapsed: (key: string) => void;
	/** Everything a `ProjectGroup` needs that is per-project state rather than per-project data. */
	groupProps: (path: string) => Omit<React.ComponentProps<typeof ProjectGroup>, "group" | "active" | "pins">;
	looseShown: number;
	onLooseMore: () => void;
	onLooseCollapse: () => void;
	actions: RowActions;
	/** What an empty list says, which differs between the sidebar and the archive. */
	empty: React.ReactNode;
}) {
	const { compact } = useLayout();
	const pinnedShut = collapsed.includes(PINNED);
	const hasPinned = (groups.pinnedSessions?.length ?? 0) > 0 || groups.pinned.length > 0;
	const pinnedCount = (groups.pinnedSessions?.length ?? 0) + groups.pinned.length;

	if (!hasPinned && groups.projects.length === 0 && groups.loose.length === 0) {
		return <>{empty}</>;
	}

	return (
		<>
			{hasPinned && (
				<>
					<SectionLabel count={pinnedCount} collapsed={pinnedShut} onToggle={() => onToggleCollapsed(PINNED)}>
						置顶
					</SectionLabel>
					<Collapsible open={!pinnedShut}>
						<div className={`flex flex-col ${compact ? "gap-[5px]" : "gap-[4px]"}`}>
							{groups.pinnedSessions?.map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									active={activeSessionId === session.id}
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
			 * No heading over the projects.
			 *
			 * They used to sit under 「最近」, which then had nothing left to say when the
			 * project-less conversations needed a home: a folder row called 「无项目」 was
			 * invented for them, and a folder named after not having one is a contradiction you
			 * cannot click on. 「最近」 belongs to those conversations — they are the ones that
			 * are not filed anywhere and are found by when you last touched them. A project is
			 * found by its name, and its own row is already the heading.
			 */}
			{groups.projects.map((group) => (
				<ProjectGroup key={group.path} group={group} active={activePath === group.path} {...groupProps(group.path)} />
			))}

			{groups.loose.length > 0 && (
				<>
					<SectionLabel
						count={groups.loose.length}
						collapsed={collapsed.includes(RECENT)}
						onToggle={() => onToggleCollapsed(RECENT)}
					>
						最近
					</SectionLabel>
					{/* Flat rows, the same ones a project shows — the section is what differs, not the
					    conversation. Same gap as inside a project, so the two read as one list. */}
					<Collapsible open={!collapsed.includes(RECENT)}>
						<div className={`flex flex-col ${compact ? "gap-[5px]" : "gap-[4px]"}`}>
							{groups.loose.slice(0, looseShown).map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									active={activeSessionId === session.id}
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
		</>
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
	count,
	collapsed,
	onToggle,
}: {
	children: React.ReactNode;
	count: number;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-expanded={!collapsed}
			onClick={onToggle}
			className="group/section flex w-full items-center gap-1 rounded-md px-2 pt-4 pb-1.5 text-left text-detail font-medium text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink-muted"
		>
			{children}
			<ChevronRight
				size={12}
				strokeWidth={2.2}
				className={`shrink-0 opacity-0 transition-[opacity,transform] duration-[var(--ly-t-quick)] group-hover/section:opacity-100 ${
					collapsed ? "" : "rotate-90"
				}`}
			/>
			{collapsed && count > 0 && <span className="ml-auto tabular-nums">{count}</span>}
		</button>
	);
}
