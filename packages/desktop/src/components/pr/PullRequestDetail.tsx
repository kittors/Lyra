/**
 * One pull request, in the two views a review actually needs.
 *
 * 摘要 is what it claims to do — the description, who has weighed in, what CI thinks. 代码 is what
 * it does. Keeping them as tabs rather than one long page is what makes the second one usable:
 * a diff is read top to bottom, and it should not start four screens down.
 */

import { ExternalLink, GitPullRequest, Maximize2, MessagesSquare, Minimize2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { PullRequestDetail as Detail } from "../../../electron/ipc-types.ts";
import { relativeTime } from "../git/relative-time.ts";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { Markdown } from "../Markdown.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { activityOf } from "./activity.ts";
import { Avatar } from "./Avatar.tsx";
import { ActivityLink, PullRequestActivity } from "./PullRequestActivity.tsx";
import { PullRequestChecks } from "./PullRequestChecks.tsx";
import { PullRequestCode } from "./PullRequestCode.tsx";
import { PullRequestMeta } from "./PullRequestMeta.tsx";
import { DetailSkeleton } from "./PullRequestSkeleton.tsx";
import { bridge } from "../../services/index.ts";

export type PrTab = "summary" | "code";

export function PullRequestDetail({
	detail,
	loading,
	error,
	onRefresh,
	onOpenChat,
	expanded,
	onToggleExpanded,
	tab,
	onTab,
}: {
	detail: Detail | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	/** Opens the app's conversation window with something already typed. */
	onOpenChat: (detail: Detail, intent: "ask" | "review") => void;
	/** Whether the list beside this is collapsed, which decides if the title has to be shown here. */
	expanded: boolean;
	onToggleExpanded: () => void;
	/**
	 * Left inset keeping this header clear of the window controls.
	 *
	 * Only non-zero once the list has slid away and this column is the one at the window's edge.
	 * Transitioned alongside it, or the tabs would jump to their new place while the column they
	 * sit in was still moving.
	 */
	/**
	 * Lifted, because the review bar below this belongs to two of these tabs and not the third.
	 * 摘要 and 代码 are things you form an opinion about; 聊天 has a field of its own, and stacking
	 * two composers is not a layout, it is a question about which one you meant.
	 */
	tab: PrTab;
	onTab: (tab: PrTab) => void;
}) {
	/*
	 * Which sections are open, as one object rather than three booleans.
	 *
	 * Failing checks open 检查 on arrival: that is the one state where the page has something to
	 * say before being asked, and burying it behind a fold to be consistent would be consistency
	 * at the reader's expense.
	 */
	const [open, setOpen] = useState({ body: true, checks: false, activity: false });
	const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
	const activity = detail ? activityOf(detail) : [];

	useEffect(() => {
		if (!detail?.checks) return;
		if (detail.checks.failed > 0) setOpen((prev) => ({ ...prev, checks: true }));
	}, [detail?.checks]);

	if (error) {
		return <Centered>{error}</Centered>;
	}
	if (!detail) {
		// Loading gets the shape of a pull request; having nothing selected is not a load.
		if (loading) return <DetailSkeleton />;
		return <Centered>选中左边的一个 Pull Request</Centered>;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * In the toolbar strip, level with the sidebar's collapse button — see PullRequestList,
			 * including why `no-drag` is on the controls rather than on this row.
			 */}
			<header
				className="relative z-50 flex h-11 shrink-0 items-center gap-1 px-3 transition-[padding-left] duration-[var(--ly-t-base)] ease-out"
			>
				{/*
				 * Expanded, the list is gone and with it the only thing saying which pull request this
				 * is. The heading inside the summary does not answer that — it scrolls away, and on
				 * the 代码 tab it was never there. So the title moves up here, and the tabs slide off
				 * the left edge to make room, landing near the centre.
				 */}
				{expanded && (
					<div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
						<GitPullRequest
							size={13.5}
							strokeWidth={1.9}
							className={`shrink-0 ${detail.isDraft ? "text-ink-faint" : "text-ok"}`}
						/>
						<ScrollText text={detail.title} className="min-w-0 text-label text-ink" />
					</div>
				)}

				<div className="no-drag flex items-center gap-1">
					{(["summary", "code"] as const).map((key) => (
						<button
							key={key}
							type="button"
							onClick={() => onTab(key)}
							className={`h-[26px] rounded-lg px-2.5 text-label transition-colors ${
								tab === key ? "bg-card-hover text-ink" : "text-ink-muted hover:text-ink"
							}`}
						>
							{key === "summary" ? "摘要" : "代码"}
						</button>
					))}
				</div>

				{/* Everything between the tabs and the actions is the window's to drag. */}
				<div className="flex-1" />

				<div className="no-drag flex items-center gap-1">
					<IconAction label="重新读取" onClick={onRefresh} spinning={loading}>
						<RefreshCw size={13.5} strokeWidth={1.8} />
					</IconAction>
					<IconAction label="在浏览器中打开" onClick={() => void bridge.system.openExternal(detail.url)}>
						<ExternalLink size={13.5} strokeWidth={1.8} />
					</IconAction>

					{/*
					 * Chat and review, in that order, then expand at the very end.
					 *
					 * Both open the same thing — the app's own conversation window — and differ only in
					 * what they put in the composer: 聊天 leaves a question to edit, 让 Agent 审查 leaves
					 * the review request. Expand is last because it is about this pane rather than about
					 * the pull request, and because that is where the eye looks for it.
					 */}
					<button
						type="button"
						onClick={() => onOpenChat(detail, "ask")}
						className="ml-1 flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
					>
						<MessagesSquare size={12.5} strokeWidth={1.8} />
						聊天
					</button>
					<button
						type="button"
						onClick={() => onOpenChat(detail, "review")}
						className="flex h-[26px] items-center gap-1.5 rounded-lg border border-line px-2.5 text-detail text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
					>
						让 Agent 审查
					</button>
					<IconAction label={expanded ? "显示列表" : "展开占满"} onClick={onToggleExpanded}>
						{expanded ? <Minimize2 size={13} strokeWidth={1.9} /> : <Maximize2 size={13} strokeWidth={1.9} />}
					</IconAction>
				</div>
			</header>

			{/*
			 * The summary is keyed on the pull request, so switching rebuilds it rather than
			 * mutating it in place.
			 *
			 * Two things fall out of that. The scroll position resets, which it must — landing
			 * halfway down a review you have not opened yet is disorienting. And the content fades
			 * in, so a cached pull request that appears within a single frame still reads as
			 * something arriving rather than as the pane flickering. Opacity only: a transform
			 * counts toward scrollHeight and would drag the scroll position along with it.
			 */}
			{tab === "code" ? (
				<PullRequestCode accountId={detail.accountId} repo={detail.repo} number={detail.number} />
			) : (
				<Scroller
					key={`${detail.repo}#${detail.number}`}
					className="flex-1"
					contentClassName="ly-fade-in px-5 pt-1 pb-6"
				>
					<h1 className="text-heading leading-snug font-semibold tracking-tight text-ink">{detail.title}</h1>
					{/* A face on the byline, for the same reason it is on each comment: recognition. */}
					<div className="flex items-center gap-2 pt-2 pb-4 text-detail text-ink-faint">
						<Avatar accountId={detail.accountId} login={detail.author} size={17} />
						<span className="text-ink-muted">{detail.author}</span>
						<span>·</span>
						<span>{relativeTime(detail.createdAt)}</span>
						<span>·</span>
						<span className="min-w-0 truncate">
							{detail.repo} #{detail.number}
						</span>
					</div>

					<PullRequestMeta detail={detail} />

					{/*
					 * Three sections, each folding away.
					 *
					 * A pull request is not one page of prose — it is a claim (描述), a verdict (检查)
					 * and a conversation (活动), and which of the three you came for changes every
					 * visit. Flat, the description pushed the checks below the fold on any change with
					 * a real write-up, and the checks are what decides whether the description is even
					 * worth reading yet.
					 *
					 * 描述 opens by default and the others do not: it is the only one that is always
					 * about *this* change rather than about its state.
					 */}
					<div className="mt-4">
						<Disclosure title="描述" open={open.body} onToggle={() => toggle("body")}>
							{detail.body.trim() ? (
								<Markdown text={detail.body} className="text-label" />
							) : (
								<p className="text-label text-ink-faint">作者没有写描述。</p>
							)}
						</Disclosure>

						{detail.checks && (
							<Disclosure
								title="检查"
								count={detail.checks.total}
								open={open.checks}
								onToggle={() => toggle("checks")}
							>
								<PullRequestChecks checks={detail.checks.items} />
							</Disclosure>
						)}

						{activity.length > 0 && (
							<Disclosure
								title="活动"
								count={activity.length}
								open={open.activity}
								onToggle={() => toggle("activity")}
								trailing={<ActivityLink url={detail.url} />}
							>
								<PullRequestActivity accountId={detail.accountId} entries={activity} />
							</Disclosure>
						)}
					</div>
				</Scroller>
			)}
		</div>
	);
}

function IconAction({
	label,
	onClick,
	spinning,
	children,
}: {
	label: string;
	onClick: () => void;
	spinning?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			aria-label={label}
			onClick={onClick}
			className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
		>
			<span className={spinning ? "ly-spin" : undefined}>{children}</span>
		</button>
	);
}

function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center px-6">
			<p className="text-center text-label leading-relaxed text-ink-faint">{children}</p>
		</div>
	);
}
