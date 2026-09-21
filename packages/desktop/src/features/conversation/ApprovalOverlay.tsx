import { useState } from "react";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { Collapse } from "../../ui/layout/Collapse.tsx";
import { Caret } from "../../ui/primitives/Caret.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { useScopedApprovals, useScopedSessionId } from "../../app/session-scope.tsx";
import { QuestionChoices } from "./QuestionChoices.tsx";
import { PermissionChoices } from "./PermissionChoices.tsx";
import { approvalReason } from "./approval-content.ts";

/** What is being asked for, by kind. Keys — this table is built at import time. */
const KIND_LABEL: Record<string, MessageKey> = {
	bash: "approval.bash",
	write: "approval.write",
	edit: "approval.edit",
	read: "approval.read",
	mcp: "approval.mcp",
	network: "approval.network",
};

/** Keep the transcript readable while a decision blocks only the composer. */
export function ApprovalOverlay() {
	const sessionId = useScopedSessionId();
	const approvals = useScopedApprovals();
	const respond = useApp(s => s.respondToApproval);
	const { compact } = useLayout();
	const [collapsedId, setCollapsedId] = useState<string | null>(null);
	const request = approvals[0];
	if (!request) return null;
	const collapsed = collapsedId === request.id;
	const interactive = request.kind === "interactive";
	const Icon = interactive ? MessageCircle : TriangleAlert;
	const reason = approvalReason(request.reason, request.detail);
	const context = <>
		{reason && <p className="mb-2.5 whitespace-pre-wrap break-words text-label leading-relaxed text-ink">{reason}</p>}
		<pre className={`whitespace-pre-wrap break-words ${interactive ? "font-sans text-label leading-relaxed text-ink" : "font-mono text-code text-ink-muted"}`}>{request.detail}</pre>
	</>;
	return <div data-approval-region className={`flex shrink-0 justify-center pb-2 ${compact ? "ly-content-gutter-compact" : "ly-content-gutter"}`}>
		<div data-approval-card className="ly-glass flex w-full max-w-[var(--ly-content)] max-h-[min(560px,calc(100dvh-14rem))] flex-col overflow-hidden rounded-xl border border-line">
			<div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
				<Icon size={15} strokeWidth={1.8} className="shrink-0 text-accent" />
				<span className="min-w-0 flex-1 break-words text-label font-medium text-ink">{interactive ? translate("question.title") : request.title}</span>
				{!interactive && <span className="shrink-0 text-caption text-ink-faint">{KIND_LABEL[request.kind] ? translate(KIND_LABEL[request.kind]) : request.kind}</span>}
				{approvals.length > 1 && <span className="shrink-0 text-caption text-ink-faint">+{approvals.length - 1}</span>}
				<button type="button" aria-expanded={!collapsed} aria-label={translate(collapsed ? "question.expand" : "question.collapse")} onClick={() => setCollapsedId(collapsed ? null : request.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-card-hover"><Caret open={!collapsed} size={15} /></button>
			</div>
			<Collapse open={!collapsed} keepMounted className="min-h-0" bodyClassName="flex min-h-0 flex-col overflow-hidden">{interactive ? <>
				<p className="shrink-0 px-4 pb-1 text-caption text-ink-muted">{translate("question.fullAccessNote")}</p>
				<QuestionChoices key={request.id} options={request.options ?? []} allowCustomInput={request.allowCustomInput !== false} selectionMode={request.selectionMode} allowSkip={request.allowSkip !== false} defaultOptionIndex={request.defaultOptionIndex} answer={decision => respond(request.id, decision, sessionId ?? undefined)}>{context}</QuestionChoices>
			</> : <>
				<Scroller className="ly-approval-scroll mx-2 max-h-[min(280px,30dvh)]" contentClassName="px-2 py-2">{context}</Scroller>
				<PermissionChoices key={request.id} subject={request.subject} answer={decision => respond(request.id, decision, sessionId ?? undefined)} />
			</>}</Collapse>
		</div>
	</div>;
}
