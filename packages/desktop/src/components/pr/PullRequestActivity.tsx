/**
 * What happened on this pull request, in the order it happened.
 *
 * Reviews and comments were two lists under two headings, which is how GitHub's API returns them
 * and not how anybody reads a pull request. Commits were nowhere at all — so the timeline showed
 * what was said about the change and never what the change was.
 *
 * Four kinds of row, and they are drawn differently on purpose. A commit and a comment are both
 * "something that happened at a time"; drawn identically, that is all they say, and navigating the
 * list means reading every line of it. What was pushed and what was said about it are the two
 * halves of reviewing.
 *
 * Only the two that carry prose can be opened. A commit headline and an opening event are already
 * whole at one line — giving them a chevron would promise something behind it.
 */

import { ExternalLink, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../Markdown.tsx";
import { relativeTime } from "../git/relative-time.ts";
import { type ActivityEntry, firstLine } from "./activity.ts";
import { Avatar } from "./Avatar.tsx";
import { bridge } from "../../services/index.ts";

export function PullRequestActivity({ accountId, entries }: { accountId: string; entries: ActivityEntry[] }) {
	/*
	 * Nothing is open to begin with, except a lone piece of prose.
	 *
	 * One comment on a pull request is the comment — collapsing it makes the reader open the only
	 * thing there is. Past that, everything starts closed and the timeline stays a timeline.
	 */
	const prose = entries.filter((entry) => entry.kind === "review" || entry.kind === "comment");
	const [open, setOpen] = useState<Record<string, boolean>>(() =>
		prose.length === 1 ? { [prose[0].key]: true } : {},
	);

	return (
		<div className="flex flex-col gap-1.5">
			{entries.map((entry) =>
				entry.kind === "commit" || entry.kind === "opened" ? (
					<EventRow key={entry.key} entry={entry} />
				) : (
					<ProseRow
						key={entry.key}
						accountId={accountId}
						entry={entry}
						open={open[entry.key] === true}
						onToggle={() => setOpen((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }))}
					/>
				),
			)}
		</div>
	);
}

/**
 * A commit, or the opening — one line, nothing behind it.
 *
 * Lighter than a comment: no border, no hover fill, no chevron. These are the beat of the timeline
 * rather than entries in it, and giving each one a card would make a branch of twelve commits look
 * like twelve conversations.
 */
function EventRow({ entry }: { entry: ActivityEntry }) {
	const Icon = entry.kind === "commit" ? GitCommitHorizontal : GitPullRequest;

	return (
		<div className="flex items-center gap-2.5 px-3 py-1">
			<Icon
				size={13.5}
				strokeWidth={1.9}
				className={`shrink-0 ${entry.kind === "opened" ? "text-ok" : "text-ink-faint"}`}
			/>

			<span className="min-w-0 flex-1 truncate text-label text-ink-muted">
				{entry.kind === "opened" ? `${entry.author} 打开了此 Pull Request` : entry.body}
			</span>

			{entry.kind === "commit" && entry.author && (
				<span className="shrink-0 text-detail text-ink-faint">{entry.author}</span>
			)}
			{entry.sha && <span className="shrink-0 font-mono text-detail text-ink-faint">{entry.sha}</span>}
			<span className="shrink-0 text-detail text-ink-faint tabular-nums">{relativeTime(entry.at)}</span>
		</div>
	);
}

/** A comment or a review: a face, a first line, and the whole thing behind it. */
function ProseRow({
	accountId,
	entry,
	open,
	onToggle,
}: {
	accountId: string;
	entry: ActivityEntry;
	open: boolean;
	onToggle: () => void;
}) {
	const empty = !entry.body.trim();

	return (
		<article className="overflow-hidden rounded-[10px] border border-line-soft">
			<button
				type="button"
				disabled={empty}
				aria-expanded={open}
				onClick={onToggle}
				className="group/entry flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover/50 disabled:cursor-default disabled:hover:bg-transparent"
			>
				<Avatar accountId={accountId} login={entry.author} />
				<span className="shrink-0 text-label text-ink">{entry.author}</span>
				{entry.verdict && <span className="shrink-0 text-detail text-ink-faint">{entry.verdict}</span>}

				{/* The first line, so a closed row still says what it is about. */}
				{!open && !empty && (
					<span className="min-w-0 flex-1 truncate text-detail text-ink-faint">{firstLine(entry.body)}</span>
				)}
				{empty && <span className="min-w-0 flex-1 text-detail text-ink-faint">（没有留下文字）</span>}
				{open && <div className="flex-1" />}

				<span className="shrink-0 text-detail text-ink-faint tabular-nums">{relativeTime(entry.at)}</span>
			</button>

			<div className="ly-reveal" data-open={open && !empty} aria-hidden={!open}>
				<div>
					<div className="border-t border-line-soft px-3 py-2.5">
						<Markdown text={entry.body} className="text-label" />
					</div>
				</div>
			</div>
		</article>
	);
}

/** A link out, for the header of the section. */
export function ActivityLink({ url }: { url: string }) {
	return (
		<button
			type="button"
			data-ly-tip="在浏览器中查看全部"
			aria-label="在浏览器中查看全部活动"
			onClick={() => void bridge.system.openExternal(url)}
			className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
		>
			<ExternalLink size={12.5} strokeWidth={1.8} />
		</button>
	);
}
