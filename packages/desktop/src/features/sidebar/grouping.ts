/**
 * Turning a flat list of sessions into the sidebar's three lists.
 *
 * Pure, and separate from the pane that renders it, because the rules are the sort you want to be
 * able to state and check: a project keeps its configured order, a project with no sessions is
 * only worth a row when it was pinned, and searching filters sessions without dissolving the
 * projects they belong to.
 */

import type { SessionMeta } from "@lyra/core";

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
	for (const project of projects) {
		byPath.set(project.path, { path: project.path, name: project.name, sessions: [] });
	}

	const loose: SessionMeta[] = [];
	for (const session of unpinnedSessions) {
		if (isScratch(session.cwd, scratchRoots)) {
			loose.push(session);
			continue;
		}
		let group = byPath.get(session.cwd);
		if (!group) {
			group = { path: session.cwd, name: session.projectName, sessions: [] };
			byPath.set(session.cwd, group);
		}
		group.sessions.push(session);
	}

	const pinnedPaths = new Set(projects.filter((p) => p.pinned).map((p) => p.path));
	const order = new Map(projects.map((p, i) => [p.path, i]));
	const all = [...byPath.values()]
		// A project with no sessions is only worth a row when the user pinned it.
		.filter((g) => g.sessions.length > 0 || pinnedPaths.has(g.path))
		.sort((a, b) => (order.get(a.path) ?? 999) - (order.get(b.path) ?? 999));

	return {
		pinnedSessions: pinnedSessions.sort((a, b) => b.updatedAt - a.updatedAt),
		pinned: all.filter((g) => pinnedPaths.has(g.path)),
		projects: all.filter((g) => !pinnedPaths.has(g.path)),
		loose: loose.sort((a, b) => b.updatedAt - a.updatedAt),
	};
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
	return scratchRoots
		.filter(Boolean)
		.some((root) => cwd.startsWith(root.endsWith("/") ? root : `${root}/`));
}

/**
 * Which sessions belong in the list at all.
 *
 * Archived ones live in settings — that is the whole point of archiving them. Empty ones are not
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
	if (enabled.length === 0) return "未配置模型供应商";
	const models = enabled.reduce((sum, p) => sum + p.models.length, 0);
	return `${enabled.map((p) => p.name).join(" · ")} · ${models} 个模型`;
}
