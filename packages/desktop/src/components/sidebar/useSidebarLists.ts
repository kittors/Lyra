/**
 * What the sidebar is showing, and what its rows do.
 *
 * One list, two pools. The archive is the same two views over a different set of conversations —
 * grouped by project or banded by date, pinned, searched and paged in exactly the same way — so
 * swapping what goes in is the whole of it, and everything downstream is written once.
 *
 * Separated from the pane for the usual reason this codebase separates things: these are rules you
 * want to be able to state. Which conversations are listed, which pool they come from, and which
 * of the four actions a row offers are three questions with three answers, and none of them is
 * about layout.
 */

import type { SessionMeta } from "@lyra/core";
import { useMemo } from "react";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { groupSessions, listableSessions, type Grouped } from "./grouping.ts";
import type { SortKey } from "./ListMenu.tsx";
import { bandByRecency, type RecencyBand } from "./recency.ts";
import type { RowActions } from "./SessionRow.tsx";

export function useSidebarLists({
	archiveOpen,
	query,
	sort,
	chatShown,
	onOpened,
}: {
	archiveOpen: boolean;
	query: string;
	/** Which timestamp orders every list here — both halves, and the archive. */
	sort: SortKey;
	/** How many rows the flat list is currently showing, which is what gets banded. */
	chatShown: number;
	/** Called after a conversation is opened, so a drawer can get out of its own way. */
	onOpened: () => void;
}): {
	archived: SessionMeta[];
	groups: Grouped;
	/** Everything matching the search, before paging — the source of the count behind 展开显示. */
	matching: SessionMeta[];
	bands: RecencyBand[];
	actions: RowActions;
	confirm: React.ReactNode;
} {
	const sessions = useApp((s) => s.sessions);
	const settings = useApp((s) => s.settings);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const scratchRoots = useApp((s) => s.scratchRoots);
	const openSession = useApp((s) => s.openSession);
	const setSessionArchived = useApp((s) => s.setSessionArchived);
	const deleteSession = useApp((s) => s.deleteSession);

	const listable = useMemo(() => listableSessions(sessions, activeSessionId), [sessions, activeSessionId]);
	const archived = useMemo(() => sessions.filter((s) => s.archived), [sessions]);
	/*
	 * Sorted once, here, rather than by each list that shows it.
	 *
	 * Grouping keeps the order it is given, so this is what a project's rows are ordered by; the
	 * bands sort again by the same key because they also have to cut on it. Both come from one
	 * setting, so the two halves can never disagree about what "most recent" means.
	 */
	const pool = useMemo(
		() => [...(archiveOpen ? archived : listable)].sort((a, b) => b[sort] - a[sort]),
		[archiveOpen, archived, listable, sort],
	);

	const groups = useMemo(
		() => groupSessions(pool, settings?.projects ?? [], query, scratchRoots, settings?.pinnedSessionIds ?? []),
		[pool, settings, query, scratchRoots],
	);

	const matching = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? pool.filter((s) => s.title.toLowerCase().includes(needle)) : pool;
	}, [pool, query]);

	/*
	 * The clock is read here rather than held in state.
	 *
	 * Banding by date needs to know what "today" is, and a timer that re-banded the list at midnight
	 * would be a subscription running all day to catch one moment nobody is looking at. The session
	 * list changes often enough that this is recomputed constantly anyway; the case it gets wrong is
	 * a window left open overnight and untouched, where the first thing that happens in the morning
	 * also fixes it.
	 */
	const bands = useMemo(
		() => bandByRecency(matching.slice(0, chatShown), Date.now(), sort),
		[matching, chatShown, sort],
	);

	/*
	 * Opening an archived conversation takes it out of the archive first.
	 *
	 * Archiving is how you put something away and opening it is how you take it back out; leaving it
	 * filed while you talk in it would mean the conversation on screen is not in the sidebar.
	 */
	const confirm = useConfirmer();
	const open = (meta: SessionMeta) => {
		void openSession(meta);
		onOpened();
	};
	const actions: RowActions = archiveOpen
		? {
				onOpen: (meta) => void setSessionArchived(meta, false).then(() => open(meta)),
				onRestore: (meta) => void setSessionArchived(meta, false),
				onDelete: (meta) =>
					confirm.ask({
						title: "删除这个会话？",
						detail: `「${sessionTitle(meta.title)}」的 ${meta.messageCount} 条消息会被永久删除，拿不回来。`,
						confirmLabel: "删除",
						onConfirm: () => void deleteSession(meta),
					}),
			}
		: { onOpen: open, onArchive: (meta) => void setSessionArchived(meta, true) };

	return { archived, groups, matching, bands, actions, confirm: confirm.element };
}
