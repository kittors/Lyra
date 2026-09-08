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

import { translate } from "../../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import { useMemo } from "react";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
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
	const poolSortField = sort === "createdAt" ? "createdAt" : "updatedAt";
	const pool = useMemo(
		() => [...(archiveOpen ? archived : listable)].sort((a, b) => b[poolSortField] - a[poolSortField]),
		[archiveOpen, archived, listable, poolSortField],
	);

	const groups = useMemo(
		() => groupSessions(pool, settings?.projects ?? [], query, scratchRoots, settings?.pinnedSessionIds ?? [], settings?.sessionOrder, sort),
		[pool, settings, query, scratchRoots, sort],
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
		() => bandByRecency(matching.slice(0, chatShown), Date.now(), poolSortField),
		[matching, chatShown, poolSortField],
	);

	/*
	 * Opening an archived conversation opens it. That is the whole of what it does.
	 *
	 * It used to take it out of the archive on the way in, on the reasoning that opening something is
	 * how you take it back out — and leaving it filed while you talk in it would mean the conversation
	 * on screen is not in the sidebar. The second half was a real problem and the first half was the
	 * wrong answer to it: a row that files and unfiles depending on where you click is a state change
	 * nobody asked for, made invisibly, next to a button that exists to make exactly that change.
	 * Whether a conversation is archived is now said in one place only — the archive button on the
	 * row — and clicking a row means what it means everywhere else in the pane.
	 *
	 * What makes that safe is `listableSessions`, which lets the conversation you have open through
	 * whether or not it is filed. It is in the sidebar the whole time; the row simply offers to take
	 * it out instead of offering to put it away. See `grouping.ts`.
	 */
	const confirm = useConfirmer();
	const open = (meta: SessionMeta) => {
		void openSession(meta);
		onOpened();
	};
	const restore = (meta: SessionMeta) => void setSessionArchived(meta, false);
	const actions: RowActions = archiveOpen
		? {
				onOpen: open,
				onRestore: restore,
				onDelete: (meta) =>
					confirm.ask({
						title: translate("sidebarList.deleteConfirm"),
						detail: translate("sidebarList.deleteDetail", { title: sessionTitle(meta.title), n: meta.messageCount }),
						confirmLabel: translate("common.delete"),
						onConfirm: () => void deleteSession(meta),
					}),
			}
		: {
				onOpen: open,
				onArchive: (meta) => void setSessionArchived(meta, true),
				/*
				 * Both directions in the live list, because one row there can be filed: the conversation
				 * you have open. It keeps its place until you leave it, and offering it 归档 — the thing
				 * it already is — would be a button that does nothing. The row picks by what it is; see
				 * `SessionRow`.
				 */
				onRestore: restore,
			};

	return { archived, groups, matching, bands, actions, confirm: confirm.element };
}
