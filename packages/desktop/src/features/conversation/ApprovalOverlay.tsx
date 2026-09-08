import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { QuestionChoices } from "./QuestionChoices.tsx";
import { PermissionChoices } from "./PermissionChoices.tsx";
import { approvalReason } from "./approval-content.ts";

/** What is being asked for, by kind. Keys — this table is built at import time. */
const KIND_LABEL: Record<string, MessageKey> = {
	bash: "approval.bash",
	write: "approval.write",
	edit: "approval.edit",
	mcp: "approval.mcp",
	network: "approval.network",
};

/** Keep the transcript readable while a decision blocks only the composer. */
export function ApprovalOverlay() {
	const sessionId = useApp(s => s.activeSessionId);
	const approvals = useApp(s => s.approvals);
	const respond = useApp(s => s.respondToApproval);
	const { compact } = useLayout();
	const request = approvals[0];
	if (!request) return null;
	const interactive = request.kind === "interactive";
	const Icon = interactive ? MessageCircle : TriangleAlert;
	const reason = approvalReason(request.reason, request.detail);
	return <div className={`pointer-events-none absolute inset-x-0 bottom-full z-20 flex max-h-[calc(100dvh-100%-2rem)] justify-center bg-gradient-to-t from-shell via-shell/95 to-transparent pb-2 ${compact ? "px-4 pt-8" : "px-8 pt-16"}`}>
		<div data-approval-card className="ly-glass ly-slide-up pointer-events-auto flex w-full max-w-[var(--ly-content)] flex-col overflow-hidden rounded-xl border border-line">
			<div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
				<Icon size={15} strokeWidth={1.8} className="shrink-0 text-accent" />
				<span className="min-w-0 flex-1 break-words text-label font-medium text-ink">{request.title}</span>
				{!interactive && <span className="shrink-0 text-caption text-ink-faint">{KIND_LABEL[request.kind] ? translate(KIND_LABEL[request.kind]) : request.kind}</span>}
				{approvals.length > 1 && <span className="shrink-0 text-caption text-ink-faint">+{approvals.length - 1}</span>}
			</div>
			<Scroller className={`ly-approval-scroll mx-2 ${interactive ? "max-h-[min(480px,60vh)]" : "max-h-[min(280px,30vh)]"}`} contentClassName="px-2 py-2">
				{reason && <p className="mb-2.5 whitespace-pre-wrap break-words text-label leading-relaxed text-ink">{reason}</p>}
				<pre className={`whitespace-pre-wrap break-words ${interactive ? "font-sans text-label leading-relaxed text-ink" : "font-mono text-code text-ink-muted"}`}>{request.detail}</pre>
				{interactive && <QuestionChoices key={request.id} options={request.options ?? []} allowCustomInput={request.allowCustomInput === true} answer={decision => respond(request.id, decision, sessionId ?? undefined)} />}
			</Scroller>
			{!interactive && <PermissionChoices key={request.id} subject={request.subject} answer={decision => respond(request.id, decision, sessionId ?? undefined)} />}
		</div>
	</div>;
}
