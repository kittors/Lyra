/**
 * One pull request, in the two views a review actually needs.
 *
 * 摘要 is what it claims to do — the description, who has weighed in, what CI thinks. 代码 is what
 * it does. Keeping them as tabs rather than one long page is what makes the second one usable:
 * a diff is read top to bottom, and it should not start four screens down.
 */

import { useI18n } from "../../i18n/index.ts";
import { Bot, ExternalLink, GitPullRequest, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useEffect, useState } from "react";
import type { PullRequestDetail as Detail } from "../../../electron/ipc-types.ts";
import { relativeTime } from "../../lib/relative-time.ts";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { Markdown } from "../conversation/index.ts";
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
	inset,
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
	 *
	 * 这段注释曾经是孤儿：prop 没了，header 上的 `transition-[padding-left]` 还留着，于是全屏收起
	 * 侧边栏之后那颗开关就压在 PR 标题上。算在 `PullRequestsView` 里——只有那里知道列表滑走了没有。
	 */
	inset?: number;
	/**
	 * Lifted, because the review bar below this belongs to two of these tabs and not the third.
	 * 摘要 and 代码 are things you form an opinion about; 聊天 has a field of its own, and stacking
	 * two composers is not a layout, it is a question about which one you meant.
	 */
	tab: PrTab;
	onTab: (tab: PrTab) => void;
}) {
	const { t } = useI18n();
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
		return <Centered>{t("prDetail.pickOne")}</Centered>;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * In the toolbar strip, level with the sidebar's collapse button — see PullRequestList,
			 * including why `no-drag` is on the controls rather than on this row.
			 */}
			<header
				data-ly-toprow="pr-detail"
				className="relative z-50 flex h-11 shrink-0 items-center gap-1 px-3 transition-[padding-left] duration-[var(--ly-t-base)] ease-out"
				style={{ paddingLeft: inset ? inset + 12 : undefined }}
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
							{t(key === "summary" ? "prDetail.summary" : "prDetail.code")}
						</button>
					))}
				</div>

				{/* Everything between the tabs and the actions is the window's to drag. */}
				<div className="flex-1" />

				<div className="no-drag flex items-center gap-1">
					<IconAction label={t("prDetail.reload")} onClick={onRefresh} spinning={loading}>
						<RefreshCw size={13.5} strokeWidth={1.8} />
					</IconAction>
					<IconAction label={t("common.openInBrowser")} onClick={() => void bridge.system.openExternal(detail.url)}>
						<ExternalLink size={13.5} strokeWidth={1.8} />
					</IconAction>

					{/*
					 * 让 Agent 审查: opens conversation with the review prompt pre-filled in composer.
					 */}
					<button
						type="button"
						data-ly-tip={t("prDetail.askAgent")}
						aria-label={t("prDetail.askAgent")}
						onClick={() => onOpenChat(detail, "review")}
						className="ml-1 grid h-[26px] w-[26px] place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
					>
						<Bot size={13} strokeWidth={1.8} aria-hidden />
					</button>
					<IconAction label={t(expanded ? "prDetail.showList" : "prDetail.fillWidth")} onClick={onToggleExpanded}>
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
					<div className="flex items-center gap-2 pt-2 pb-4 text-detail text-ink-faint">
						<Avatar accountId={detail.accountId} login={detail.author} size={17} />
						<span className="shrink-0 whitespace-nowrap text-ink-muted">{detail.author}</span>
						<span className="shrink-0 text-ink-faint">·</span>
						<span className="shrink-0 whitespace-nowrap">{relativeTime(detail.createdAt)}</span>
						<span className="shrink-0 text-ink-faint">·</span>
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
						<Disclosure title={t("prDetail.description")} open={open.body} onToggle={() => toggle("body")}>
							{detail.body.trim() ? (
								<Markdown text={detail.body} className="text-label" />
							) : (
								<p className="text-label text-ink-faint">{t("prDetail.noDescription")}</p>
							)}
						</Disclosure>

						{detail.checks && (
							<Disclosure
								title={t("prMeta.checks")}
								count={detail.checks.total}
								open={open.checks}
								onToggle={() => toggle("checks")}
							>
								<PullRequestChecks checks={detail.checks.items} />
							</Disclosure>
						)}

						{activity.length > 0 && (
							<Disclosure
								title={t("prDetail.activity")}
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
			{/* 忙的时候整个换成那个亮弧，而不是把这个按钮自己的图标转起来。 */}
			{spinning ? <ActionSpinner size={13.5} /> : children}
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
