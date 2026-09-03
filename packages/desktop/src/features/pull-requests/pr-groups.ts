/**
 * Which pull requests appear, and under which heading.
 *
 * Three overlapping searches arrive as one list with a relation on each row; this is the part that
 * turns it back into the shape a reader wants. The rules look obvious until one is wrong — a
 * search that resurrects a row the filter excluded, a heading with nothing under it — which is why
 * they are here rather than inline in a component.
 */

import type { PullRequestSummary } from "../../../electron/ipc-types.ts";

/** Which pull requests the list is narrowed to. Mirrors the relations the search buckets produce. */
export type Filter = "all" | "reviewing" | "authored";

export interface Group {
	key: PullRequestSummary["relation"];
	label: string;
	items: PullRequestSummary[];
}

const GROUP_LABELS: Record<PullRequestSummary["relation"], string> = {
	reviewing: "等你审查",
	authored: "由我创建",
	reviewed: "之前已审查",
};

/** The order the groups appear in, which is the order they need attention. */
const GROUP_ORDER: PullRequestSummary["relation"][] = ["reviewing", "authored", "reviewed"];

/** Filter, search, then group — in that order, so a search never resurrects a filtered-out row. */
export function groupFor(items: PullRequestSummary[], filter: Filter, query: string): Group[] {
	const needle = query.trim().toLowerCase();
	const matching = items.filter((pr) => {
		if (filter !== "all" && pr.relation !== filter) return false;
		if (!needle) return true;
		// The branch is searchable too: half of these rows are named after one, and the branch is
		// what somebody has in hand when they come here from a terminal.
		return `${pr.title} ${pr.repo} ${pr.author} ${pr.headRefName ?? ""} #${pr.number}`.toLowerCase().includes(needle);
	});

	return GROUP_ORDER.map((key) => ({
		key,
		label: GROUP_LABELS[key],
		items: matching.filter((pr) => pr.relation === key),
	})).filter((group) => group.items.length > 0);
}
