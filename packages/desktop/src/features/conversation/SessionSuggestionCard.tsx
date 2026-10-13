/**
 * What a `spawn_session` call leaves in the conversation: a suggested conversation, and a Start.
 *
 * The model noticed something worth doing on its own — dead code, a stale page, a missing test — and
 * rather than widen the change it is making, it suggests it. Nothing runs until the person presses
 * Start; then the new conversation opens in this one's project, in the background, and this screen
 * stays where it is. The card reads "Started · Open" from then on, across restarts, because what it
 * reads is not its own memory but the session list: the conversation whose `spawnedFrom` names this
 * call (`SessionMeta.spawnedFrom`). See ADR-0039.
 *
 * Drawn outside the turn's process block, like the image cards (`Conversation.tsx`): a suggestion
 * folded away with the working would never be seen.
 */

import { ArrowUpRight, SquarePen, X } from "lucide-react";
import { useState } from "react";
import type { SessionSuggestionDetails, ToolCallContent } from "@lyra/core";
import { focusScreenOf, useScopedFromToolRuns, useScopedSessionId, useScopedWorkspace } from "../../app/session-scope.tsx";
import { WorktreeToggle } from "../../ui/inputs/WorktreeToggle.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";

/**
 * Cards put away with ×, by call id. Only this window's business — the suggestion stays in the
 * transcript, and the phone or another window may still want it.
 */
const DISMISSED_KEY = "lyra.sessionSuggestions.dismissed";
/** Far more than any one conversation suggests; past it the oldest are forgotten, not the list grown forever. */
const DISMISSED_KEEP = 200;

function dismissedIds(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function rememberDismissed(id: string): void {
	try {
		localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedIds().filter((one) => one !== id), id].slice(-DISMISSED_KEEP)));
	} catch {
		// Storage unavailable or full: the card still goes for as long as this screen is up.
	}
}

export function SessionSuggestionCards({ calls }: { calls: ToolCallContent[] }) {
	return (
		<div className="flex flex-col gap-2.5" data-ly-session-suggestions>
			{calls.map((call) => (
				<SessionSuggestionCard key={call.id} call={call} />
			))}
		</div>
	);
}

function SessionSuggestionCard({ call }: { call: ToolCallContent }) {
	const { t } = useI18n();
	// This screen's conversation: in a split the card may sit beside the focused one, and starts from its own.
	const sessionId = useScopedSessionId();
	const run = useScopedFromToolRuns((runs) => runs[call.id]);
	// An id rather than the meta, so the card redraws when the suggestion is taken, not on every sidebar change.
	const startedId = useApp((s) =>
		sessionId ? (s.sessions.find((one) => one.spawnedFrom?.sessionId === sessionId && one.spawnedFrom.toolCallId === call.id)?.id ?? null) : null,
	);
	/*
	 * What the conversation it started is doing, told on the card that started it: the place someone
	 * looking for it already is, rather than a toast over whatever they are reading.
	 */
	const activity = useApp((s) => (startedId ? (s.activity[startedId] ?? null) : null));
	// In a worktree of its own or in the project, asked as the composer asks it, from the same setting.
	const { workspace } = useScopedWorkspace();
	const worktreeByDefault = useApp((s) => Boolean(s.settings?.worktrees?.autoCreateOnNewSession));
	const [worktreePick, setWorktreePick] = useState<boolean | null>(null);
	const inWorktree = worktreePick ?? worktreeByDefault;
	const [dismissed, setDismissed] = useState(() => dismissedIds().includes(call.id));
	const [starting, setStarting] = useState(false);
	const details = run?.status === "done" ? (run.result?.details as SessionSuggestionDetails | undefined) : undefined;
	// Refused arguments leave no card: the tool's own row says what was wrong.
	if (!sessionId || details?.kind !== "session_suggestion" || dismissed) return null;
	const offersWorktree = !startedId && Boolean(workspace?.isGitRepo);
	const status =
		activity === "running" || activity === "waiting"
			? t("sessionOps.running")
			: activity === "done"
				? t("sessionOps.done")
				: activity === "failed"
					? t("sessionOps.failed")
					: t("sessionOps.started");

	const start = async () => {
		if (starting) return;
		setStarting(true);
		try {
			// Named by the card's title, not by the first sixty characters of a prompt written for the model.
			await useApp.getState().startSession(details.prompt, { sessionId, toolCallId: call.id }, { title: details.title, ...(offersWorktree ? { worktree: inWorktree } : {}) });
		} finally {
			setStarting(false);
		}
	};
	const open = () => {
		if (!startedId) return;
		// Opened on this card's screen; a press there focused it already, the keyboard did not.
		if (sessionId !== useApp.getState().activeSessionId) focusScreenOf(sessionId);
		void useApp.getState().openSessionById(startedId);
	};
	const dismiss = () => {
		rememberDismissed(call.id);
		setDismissed(true);
	};

	return (
		<section
			data-ly-session-suggestion={startedId ? "started" : "suggested"}
			data-ly-suggestion-call={call.id}
			aria-label={details.title}
			className="w-full max-w-[460px] rounded-xl border border-line bg-card/30 px-3 pt-2 pb-2.5 text-label"
		>
			<div className="flex items-center gap-1.5 text-caption text-ink-faint">
				<SquarePen size={12} strokeWidth={1.9} aria-hidden className="shrink-0" />
				<span className="min-w-0 flex-1 truncate">{t("sessionOps.suggested")}</span>
				<IconButton size="xs" label={t("sessionOps.dismiss")} icon={<X size={12} strokeWidth={1.9} />} onClick={dismiss} data-ly-suggestion-dismiss />
			</div>
			<p className="mt-1 font-medium text-ink" data-ly-suggestion-title>
				{details.title}
			</p>
			<p className="mt-0.5 text-detail text-ink-muted" data-ly-suggestion-summary>
				{details.summary}
			</p>
			{/* Start, and beside it the composer's own question — in a worktree of its own? — while it can still be asked. */}
			<div className="mt-2.5 flex items-center gap-1.5" data-ly-suggestion-start>
				<Button
					size="sm"
					variant={startedId ? "subtle" : "primary"}
					loading={starting && !startedId}
					label={startedId ? undefined : t("sessionOps.startTip")}
					icon={startedId ? <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden /> : undefined}
					onClick={() => (startedId ? open() : void start())}
					data-ly-suggestion-action={startedId ? "open" : "start"}
				>
					<RollingText>{startedId ? `${status} · ${t("common.open")}` : t("sessionOps.start")}</RollingText>
				</Button>
				{offersWorktree && <WorktreeToggle size="sm" on={inWorktree} onChange={setWorktreePick} />}
			</div>
		</section>
	);
}
