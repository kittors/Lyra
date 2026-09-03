/**
 * What happened on a pull request, as one list.
 *
 * Reviews and comments arrive as two arrays because they are two API objects. They are not two
 * things to read: a review that answers the comment above it belongs under that comment, and split
 * apart the reader has to interleave two timestamped lists by hand.
 *
 * Plain `.ts` and no JSX, so the ordering can be tested without a renderer — which is also the
 * honest shape for it: this is a data question, and the component next door is the drawing.
 */

import type { PullRequestDetail } from "../../../electron/ipc-types.ts";

/**
 * What a row is, which decides how it is drawn.
 *
 * A commit and a comment are both "something that happened at a time", and drawn identically that
 * is all they say. What was pushed and what was said about it are the two halves of reviewing, and
 * a timeline that does not distinguish them is a list you have to read every line of to navigate.
 */
export type ActivityKind = "opened" | "commit" | "review" | "comment";

export interface ActivityEntry {
	key: string;
	kind: ActivityKind;
	author: string;
	at: string;
	/** A review's verdict — 已批准, 请求修改. Only reviews have one. */
	verdict?: string;
	/** A commit's short sha. */
	sha?: string;
	/** Prose for a comment or review; the headline for a commit; empty for an event. */
	body: string;
}

/** GitHub's review states, in the words a reviewer would use. */
export function verdictLabel(state: string): string {
	if (state === "APPROVED") return "已批准";
	if (state === "CHANGES_REQUESTED") return "请求修改";
	if (state === "REQUESTED") return "待审查";
	if (state === "DISMISSED") return "已忽略";
	return "已评论";
}

export function activityOf(
	detail: Pick<PullRequestDetail, "reviews" | "threads"> &
		Partial<Pick<PullRequestDetail, "commits" | "author" | "createdAt">>,
): ActivityEntry[] {
	const entries: ActivityEntry[] = [
		/*
		 * The opening, which is an event rather than anything anybody wrote.
		 *
		 * Always first, and worth a row: without it the timeline begins mid-conversation, and the
		 * gap between "opened" and the first comment is often the interesting part.
		 */
		...(detail.author && detail.createdAt
			? [{ key: "opened", kind: "opened" as const, author: detail.author, at: detail.createdAt, body: "" }]
			: []),

		// Commits carry no body of their own — the headline is the row.
		...(detail.commits ?? [])
			.filter((commit) => commit.at)
			.map((commit, index) => ({
				key: `k-${index}`,
				kind: "commit" as const,
				author: commit.author,
				at: commit.at,
				sha: commit.sha,
				body: commit.headline,
			})),

		/*
		 * Keys are prefixed by source.
		 *
		 * Both arrays are indexed from zero, so an index alone collides on the first of each — and
		 * React would then hand one row's open state to the other.
		 */
		...detail.reviews.map((review, index) => ({
			key: `r-${index}`,
			kind: "review" as const,
			author: review.author,
			at: review.submittedAt,
			verdict: verdictLabel(review.state),
			body: review.body,
		})),
		...detail.threads.map((comment, index) => ({
			key: `c-${index}`,
			kind: "comment" as const,
			author: comment.author,
			at: comment.createdAt,
			body: comment.body,
		})),
	];

	// Oldest first: a conversation is read downwards, and the newest entry ends up nearest the box
	// you would reply in.
	return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * The first line worth previewing.
 *
 * Headings and list markers are the most likely opening of a machine-written comment and the least
 * informative thing to show as its one line — a row reading "Summary" says nothing that the
 * section it is in did not already say.
 */
export function firstLine(body: string): string {
	for (const line of body.split("\n")) {
		const text = line.replace(/^[#>\-*\s]+/, "").trim();
		if (text) return text;
	}
	return body.trim();
}
