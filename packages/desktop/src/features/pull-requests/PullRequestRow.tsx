/**
 * One pull request, as a row.
 *
 * Two lines, and the split between them is what makes a list of sixty scannable: the top line is
 * *what changed and when*, the bottom is *whose it is and how big*. Reading down the first line
 * answers "is any of this mine to do"; the second is there for the two or three rows where the
 * answer was yes.
 *
 * The icon is centred across both lines rather than aligned to the first. It stands for the row,
 * not for the title — pinned to the top it read as a bullet in front of the title and left the
 * second line hanging off nothing.
 *
 * Memoised on its data, which is the other half of a list that refreshes itself. The hook hands
 * back the same object for a row that did not change, so a refresh that changes one row re-renders
 * one row — and with it, one marquee measurement and one avatar lookup instead of sixty.
 */

import { Check, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, TriangleAlert } from "lucide-react";
import { memo } from "react";
import type { PullRequestSummary } from "../../../electron/ipc-types.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { TimeAgo } from "../../ui/primitives/TimeAgo.tsx";
import { Avatar } from "./Avatar.tsx";

export const PullRequestRow = memo(function PullRequestRow({
	pr,
	active,
	unseen,
	touched,
	onSelect,
}: {
	pr: PullRequestSummary;
	active: boolean;
	/** Has moved since it was last opened here — the local kind of unread, not GitHub's. */
	unseen: boolean;
	/** Changed in the refresh that just landed, which is worth one pass of highlight. */
	touched: boolean;
	/** Stable by contract: a new function per render would defeat the memo above. */
	onSelect: (pr: PullRequestSummary) => void;
}) {
	const look = lookOf(pr);

	return (
		<button
			type="button"
			onClick={() => onSelect(pr)}
			data-active={active}
			data-touched={touched}
			className="ly-pr-row ly-scroll flex w-full items-center gap-2.5 rounded-[10px] px-2 py-[6px] text-left"
		>
			{/*
			 * The icon and CI's verdict as one mark: `items-center` on the row is what centres this
			 * across both lines, and the box is what the dot is positioned against.
			 */}
			<span
				data-ly-tip={look.label}
				className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center"
			>
				<look.Icon size={14} strokeWidth={1.9} className={look.tone} />
				{pr.checkState && <span className="ly-pr-dot" data-state={pr.checkState} />}
			</span>

			<span className="flex min-w-0 flex-1 flex-col gap-[3px]">
				<span className="flex items-center gap-2">
					<ScrollText text={pr.title} className="min-w-0 flex-1 text-label text-ink" />
					{unseen && (
						<span
							aria-hidden
							data-ly-tip="上次打开之后有新动静"
							className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent"
						/>
					)}
					<TimeAgo iso={pr.updatedAt} className="shrink-0 text-caption text-ink-faint" />
				</span>

				{/*
				 * Four things, and the order they give up space in is the order they matter.
				 *
				 * The repository keeps its width because it is how two similar rows are told apart;
				 * the branch gives up its own because it is a detail you read after you have. The
				 * comment count used to be here too and is not any more — in a 300px column it was
				 * spending the branch's last thirty pixels to say a number the detail pane also says.
				 */}
				<span className="flex items-center gap-1.5 text-detail text-ink-faint">
					<Avatar accountId={pr.accountId} login={pr.author} url={pr.avatarUrl} size={13} />
					<span className="max-w-[46%] shrink-0 truncate">{pr.repo}</span>
					{pr.headRefName ? (
						<span className="min-w-0 flex-1 truncate font-mono text-caption opacity-80">{pr.headRefName}</span>
					) : (
						<span className="flex-1" />
					)}

					<Verdict decision={pr.reviewDecision} />
					<DiffStat additions={pr.additions} deletions={pr.deletions} />
				</span>
			</span>
		</button>
	);
});

/**
 * How much it touches, in the two numbers everyone reads first.
 *
 * Only drawn when the answer is known. A row restored from a cache written before the search
 * carried these has nulls, and `+0 -0` on a hundred-line change is worse than saying nothing.
 */
function DiffStat({ additions, deletions }: { additions: number | null; deletions: number | null }) {
	if (additions === null && deletions === null) return null;
	return (
		<span className="shrink-0 font-mono text-caption tabular-nums" data-ly-tip="改动行数">
			<span className="text-ok">+{additions ?? 0}</span>
			<span className="pl-1 text-danger">-{deletions ?? 0}</span>
		</span>
	);
}

/**
 * Where the review got to, when it got anywhere.
 *
 * `REVIEW_REQUIRED` is the resting state of every open pull request and says nothing; the two that
 * are worth a mark are the two that are a decision somebody made.
 */
function Verdict({ decision }: { decision: string | null }) {
	if (decision === "APPROVED") {
		return <Check size={11.5} strokeWidth={2.6} className="shrink-0 text-ok" data-ly-tip="已批准" />;
	}
	if (decision === "CHANGES_REQUESTED") {
		return <TriangleAlert size={11} strokeWidth={2.2} className="shrink-0 text-danger" data-ly-tip="有人请求修改" />;
	}
	return null;
}

/**
 * A draft is grey, an open one green — the same two states GitHub draws, because this is a list
 * people cross-reference with the web page. Merged and closed are here for the rows a cache is
 * still holding after the search that produced them stopped returning them.
 */
function lookOf(pr: PullRequestSummary): { Icon: typeof GitPullRequest; tone: string; label: string } {
	if (pr.state === "MERGED") return { Icon: GitMerge, tone: "text-violet", label: "已合并" };
	if (pr.state === "CLOSED") return { Icon: GitPullRequestClosed, tone: "text-danger", label: "已关闭" };
	if (pr.isDraft) return { Icon: GitPullRequestDraft, tone: "text-ink-faint", label: "草稿" };
	return { Icon: GitPullRequest, tone: "text-ok", label: "开放中" };
}
