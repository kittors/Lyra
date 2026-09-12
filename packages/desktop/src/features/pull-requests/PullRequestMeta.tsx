/**
 * The facts about a pull request, as a table rather than a paragraph.
 *
 * Every row here answers a question a reviewer asks before reading a single line of the diff:
 * where is it going, who else is looking, has CI passed, can it even merge. Written as prose they
 * would be scanned past; as labelled rows they can be checked one at a time and skipped once
 * known.
 */

import { GitBranch, MessageSquare, Users, CircleCheck, CircleAlert, Circle, GitPullRequest } from "lucide-react";
import type { PullRequestDetail } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import { verdictLabel } from "./activity.ts";

export function PullRequestMeta({ detail }: { detail: PullRequestDetail }) {
	const { t } = useI18n();
	return (
		<dl className="space-y-2.5">
			<Row icon={GitBranch} label={t("prMeta.branch")}>
				<span className="font-mono text-detail text-ink">{detail.headRefName}</span>
				<span className="px-1.5 text-ink-faint">›</span>
				<span className="font-mono text-detail text-ink-muted">{detail.baseRefName}</span>
				<span className="pl-2 font-mono text-detail">
					<span className="text-ok">+{detail.additions}</span> <span className="text-danger">−{detail.deletions}</span>
				</span>
				<span className="pl-2 text-detail text-ink-faint">{t("prMeta.files", { n: detail.changedFiles })}</span>
			</Row>

			<Row icon={Users} label={t("prMeta.reviewers")}>
				{detail.reviewers.length === 0 ? (
					<span className="text-detail text-ink-faint">{t("prMeta.noReviewers")}</span>
				) : (
					<span className="flex flex-wrap items-center gap-1.5">
						{detail.reviewers.map((reviewer, index) => (
							<span
								key={`${reviewer.login}-${index}`}
								className="rounded-md bg-card px-1.5 py-0.5 text-detail text-ink-muted"
							>
								{reviewer.login}
								<span className={`pl-1 ${verdictTone(reviewer.state)}`}>{verdictLabel(reviewer.state)}</span>
							</span>
						))}
					</span>
				)}
			</Row>

			<Row icon={MessageSquare} label={t("prMeta.comments")}>
				<span className="text-detail text-ink">{t("prMeta.commentCount", { n: detail.comments })}</span>
			</Row>

			<Row icon={checkIcon(detail.checks)} label={t("prMeta.checks")}>
				<Checks checks={detail.checks} />
			</Row>

			<Row icon={GitPullRequest} label={t("common.status")}>
				<span className="text-detail text-ink">{stateLabel(detail)}</span>
				{detail.labels.length > 0 && (
					<span className="flex flex-wrap items-center gap-1.5 pl-2">
						{detail.labels.map((label) => (
							<span key={label} className="rounded-md bg-card px-1.5 py-0.5 text-caption text-ink-muted">
								{label}
							</span>
						))}
					</span>
				)}
			</Row>
		</dl>
	);
}

function Row({
	icon: Icon,
	label,
	children,
}: {
	icon: typeof GitBranch;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-3">
			<dt className="flex w-[104px] shrink-0 items-center gap-2 pt-[1px] text-detail text-ink-faint">
				<Icon size={13} strokeWidth={1.8} className="shrink-0" />
				{label}
			</dt>
			<dd className="flex min-w-0 flex-1 flex-wrap items-center">{children}</dd>
		</div>
	);
}

/** No checks at all is a different answer from "none passed", and says so. */
function Checks({ checks }: { checks: PullRequestDetail["checks"] }) {
	const { t } = useI18n();
	if (!checks) return <span className="text-detail text-ink-faint">{t("prMeta.noChecks")}</span>;
	if (checks.failed > 0) {
		return (
			<span className="text-detail text-danger">
				{t("prMeta.checksFailed", { failed: checks.failed, total: checks.total })}
			</span>
		);
	}
	if (checks.pending > 0) {
		return (
			<span className="text-detail text-ink-muted">
				{t("prMeta.checksRunning", { running: checks.pending, total: checks.total })}
			</span>
		);
	}
	return <span className="text-detail text-ok">{t("prMeta.checksPassed", { n: checks.total })}</span>;
}

function checkIcon(checks: PullRequestDetail["checks"]): typeof GitBranch {
	if (!checks) return Circle;
	if (checks.failed > 0) return CircleAlert;
	if (checks.pending > 0) return Circle;
	return CircleCheck;
}

/**
 * What state it is really in.
 *
 * "Open" is technically true of a draft and of something with a failing merge, and neither is
 * ready for anyone's attention — so the label says the thing that would stop you.
 */
function stateLabel(detail: PullRequestDetail): string {
	if (detail.state === "MERGED") return translate("prMeta.merged");
	if (detail.state === "CLOSED") return translate("prMeta.closed");
	if (detail.isDraft) return translate("prMeta.draft");
	if (detail.mergeable === "CONFLICTING") return translate("prMeta.conflicted");
	return translate("prMeta.reviewable");
}

function verdictTone(state: string): string {
	if (state === "APPROVED") return "text-ok";
	if (state === "CHANGES_REQUESTED") return "text-danger";
	return "text-ink-faint";
}
