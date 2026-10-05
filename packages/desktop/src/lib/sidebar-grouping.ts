/**
 * Turning a flat list of sessions into the sidebar's three lists.
 *
 * Pure, and separate from the pane that renders it, because the rules are the sort you want to be
 * able to state and check: a project keeps its configured order, a project that never had a session
 * takes a row when it is pinned or where asked to, and searching filters sessions without dissolving
 * the projects they belong to.
 */

import { translate } from "../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import { projectFolders } from "@lyra/core/project-folders";
import { orderedSessions, type SessionSortKey } from "./sidebar-order.ts";
import { isDescendantPath } from "./paths.ts";

export interface Group {
	path: string;
	name: string;
	sessions: SessionMeta[];
}

export interface ProjectRef {
	path: string;
	name: string;
	pinned: boolean;
	lastOpenedAt: number;
	/** Extra source folders, if this project was configured with more than one; see `projectFolders`. */
	folders?: string[];
}

export interface Grouped {
	/** Pinned individual sessions (shown at the top of the sidebar under 置顶). */
	pinnedSessions: SessionMeta[];
	/** Pinned projects, in configured order. */
	pinned: Group[];
	/** Everything else that is a project, in configured order, unknown ones last. */
	projects: Group[];
	/**
	 * Conversations that belong to no project, flat and newest first.
	 *
	 * Not a group. They used to be collected under a folder row called 「无项目」, which put a
	 * project-shaped thing in the list for the one case that is defined by not being a project —
	 * a folder you cannot open, named after the absence of the thing folders are named after.
	 * They are simply the conversations that are not filed anywhere, and they sit under 「最近」
	 * at the bottom, which is what they are and where they belong.
	 */
	loose: SessionMeta[];
}

export function groupSessions(
	sessions: SessionMeta[],
	projects: ProjectRef[],
	query: string,
	/**
	 * Directories that hold project-less conversations rather than projects.
	 *
	 * Sessions there are real and worth returning to — a review you asked about yesterday should be
	 * one click away — but they are not projects, and grouping them by directory the usual way
	 * produces a row called `owner-repo-6381` sitting among someone's actual work.
	 *
	 * More than one root because the directory has been renamed twice and stored sessions still
	 * record the path they were created under.
	 */
	scratchRoots: string[] = [],
	pinnedSessionIds: string[] = [],
	sessionOrder?: Record<string, string[]>,
	sortKey: SessionSortKey = "updatedAt",
	/**
	 * Projects that had conversations and have none left, because every one was archived.
	 *
	 * Passed in rather than derived here: this only ever sees the conversations it is asked to
	 * group, and the archived ones are by definition not among them — so from in here "never had
	 * any" and "has none left" look identical, while calling for opposite answers.
	 */
	emptied: ReadonlySet<string> = new Set(),
	/** Whether an emptied project should fold away with its conversations; see `hideEmptiedProjects`. */
	hideEmptied = false,
	/**
	 * Whether a registered project that never had a conversation takes a row.
	 *
	 * Off by default because the archive groups the same way, and there a project with nothing filed
	 * is not something to show. The ordinary list turns it on: a project just created has no
	 * conversation yet, and hiding it left nowhere to click to start the first one.
	 */
	showUnused = false,
): Grouped {
	const needle = query.trim().toLowerCase();
	const filtered = needle ? sessions.filter((s) => s.title.toLowerCase().includes(needle)) : sessions;
	const pinnedIdSet = new Set(pinnedSessionIds);

	const pinnedSessions: SessionMeta[] = [];
	const unpinnedSessions: SessionMeta[] = [];

	for (const s of filtered) {
		if (pinnedIdSet.has(s.id)) {
			pinnedSessions.push(s);
		} else {
			unpinnedSessions.push(s);
		}
	}

	const byPath = new Map<string, Group>();
	/*
	 * Where an extra source folder files its conversations.
	 *
	 * A project may be several folders, and a chat started in the second one is a chat in that
	 * project — it should not open a row of its own beside the project it is part of. Only the
	 * folders themselves are redirected, not what is under them: a conversation in `api/src` keeps
	 * building its own group exactly as one in `app/src` always has. Widening that is a separate
	 * decision about every project in the list, not something adding a folder should smuggle in.
	 */
	const owner = new Map<string, string>();
	for (const project of projects) {
		byPath.set(project.path, { path: project.path, name: project.name, sessions: [] });
		for (const folder of projectFolders(project)) if (folder !== project.path) owner.set(folder, project.path);
	}

	const loose: SessionMeta[] = [];
	for (const session of unpinnedSessions) {
		if (isScratch(session.cwd, scratchRoots)) {
			loose.push(session);
			continue;
		}
		const home = owner.get(session.cwd) ?? session.cwd;
		let group = byPath.get(home);
		if (!group) {
			group = { path: home, name: session.projectName, sessions: [] };
			byPath.set(home, group);
		}
		group.sessions.push(session);
	}
	for (const group of byPath.values()) {
		group.sessions = orderedSessions(group.sessions, sortKey, sessionOrder?.[group.path]);
	}

	const pinnedPaths = new Set(projects.filter((p) => p.pinned).map((p) => p.path));
	const order = new Map(projects.map((p, i) => [p.path, i]));
	const all = [...byPath.values()]
		.filter((group) => {
			if (group.sessions.length > 0) return true;
			/*
			 * 空着的项目分两种，它们的答案正好相反。
			 *
			 * 一种是「会话都归档了」——这个项目告一段落了。想让它跟着一起收起来的人去设置里打开
			 * `hideEmptiedProjects`；默认不打开，因为一个登记过的项目突然从侧边栏消失，比多留
			 * 一行更让人找不着北。
			 *
			 * 另一种是「一条会话都没有过」，多半是刚建好的项目：置顶的照旧占一行，其余由 `showUnused`
			 * 决定。搜索时不占行：它没有会话可以匹配，列出来只是一排和搜索词无关的空项目。
			 */
			if (emptied.has(group.path)) return !hideEmptied;
			return pinnedPaths.has(group.path) || (showUnused && !needle);
		})
		.sort((a, b) => (order.get(a.path) ?? 999) - (order.get(b.path) ?? 999));

	return {
		pinnedSessions: pinnedSessions.sort((a, b) => b.updatedAt - a.updatedAt),
		pinned: all.filter((g) => pinnedPaths.has(g.path)),
		projects: all.filter((g) => !pinnedPaths.has(g.path)),
		loose: loose.sort((a, b) => b.updatedAt - a.updatedAt),
	};
}

/**
 * Projects whose conversations are all in the archive.
 *
 * Takes both halves because the question — "did this project have conversations before they were
 * archived?" — cannot be answered from either alone: `listable` is what the list shows and
 * `archived` is what it does not.
 */
export function emptiedProjects(listable: SessionMeta[], archived: SessionMeta[]): Set<string> {
	const live = new Set(listable.map((s) => s.cwd));
	const out = new Set<string>();
	for (const session of archived) if (!live.has(session.cwd)) out.add(session.cwd);
	return out;
}

/**
 * Whether a conversation lives in a scratch directory rather than in a project.
 *
 * Exported because the flat 「聊天」 list needs the same answer for a different reason. There a row
 * is captioned with the project it belongs to — the titles are no longer under a folder that says
 * so — and a scratch session's `projectName` is a generated directory name like `owner-repo-6381`,
 * which as a caption is worse than none.
 */
export function isScratch(cwd: string, scratchRoots: string[]): boolean {
	// The roots are the main process's `path.join`, so backslashed on Windows, where appending "/"
	// matched nothing and every scratch session grew a project row of its own.
	return scratchRoots.filter(Boolean).some((root) => isDescendantPath(root, cwd));
}

/**
 * Which sessions belong in the list at all.
 *
 * Archived ones live in the archive — that is the whole point of archiving them. Empty ones are not
 * conversations yet: no title, nothing to return to, so a row for one cannot be usefully clicked.
 * The active session is exempt, because the conversation you are in the middle of starting has to
 * stay visible and selected while its first message is still in flight.
 */
export function listableSessions(sessions: SessionMeta[], activeSessionId: string | null): SessionMeta[] {
	return sessions.filter((s) => !s.archived && (s.messageCount > 0 || s.id === activeSessionId));
}

/** What the settings row says it will take you to. */
export function activeProviderLabel(providers: { name: string; enabled: boolean; models: unknown[] }[]): string {
	const enabled = providers.filter((p) => p.enabled);
	if (enabled.length === 0) return translate("sidebarGrouping.noProvider");
	const models = enabled.reduce((sum, p) => sum + p.models.length, 0);
	return translate("sidebarGrouping.providers", { providers: enabled.map((p) => p.name).join(" · "), n: models });
}
