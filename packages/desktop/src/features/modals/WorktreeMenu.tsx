/**
 * A conversation's own worktree: where it stands against the branch it was cut from, and the two things
 * to do about that — merge its commits back, bring the base's new commits in.
 *
 * In the composer, behind the chip that names the worktree's branch, where the branch chip is for a
 * conversation in the project itself. Switching branches is not on offer here: the worktree is its
 * branch, and checking another out in it would leave the conversation's work somewhere it cannot see.
 *
 * What an action came to stays in the menu, under the actions, rather than in a toast: a conflict comes
 * with the files and with what to do next, and that has to still be there when it is read. See ADR-0038.
 */

import type { SessionMeta } from "@lyra/core";
import { Archive, Check, CircleAlert, FolderOpen, GitMerge, MessageSquareText, RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { MergeOutcome, SyncOutcome, WorktreeState } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { systemWord } from "../../lib/system-words.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { MENU_MAX_HEIGHT, MenuBody, MenuItem, MenuLabel, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import type { WorktreeView } from "./useWorktreeState.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;
/** Conflicted files named before the rest are counted: enough to recognise, short enough to read. */
const NAMED_FILES = 4;

type Note = { tone: "ok" | "warn"; text: string; archive?: boolean };

export function WorktreeMenu({
	anchor,
	onClose,
	meta,
	view,
	running,
}: {
	anchor: Anchor;
	onClose: () => void;
	meta: SessionMeta;
	view: WorktreeView;
	running: boolean;
}) {
	const { t } = useI18n();
	const send = useApp((s) => s.send);
	const setSessionArchived = useApp((s) => s.setSessionArchived);
	const [busy, setBusy] = useState<"merge" | "sync" | "abort" | null>(null);
	const [note, setNote] = useState<Note | null>(null);
	const { state } = view;
	const branch = meta.worktree?.branch ?? "";
	const base = state?.base ?? meta.worktree?.base ?? "main";

	// Read again on open: the chip's last answer can be a turn old.
	useEffect(() => {
		void view.refresh();
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once per opening, not per answer
	}, []);

	const files = (list: string[]) =>
		list.length > NAMED_FILES ? `${list.slice(0, NAMED_FILES).join(", ")} ${t("worktreeMenu.moreFiles", { n: list.length - NAMED_FILES })}` : list.join(", ");

	function refusal(outcome: Extract<MergeOutcome | SyncOutcome, { kind: "refused" }>): string {
		const key: Record<typeof outcome.reason, MessageKey> = {
			gone: "worktreeMenu.refusedGone",
			"no-base": "worktreeMenu.refusedNoBase",
			running: "worktreeMenu.refusedRunning",
			syncing: "worktreeMenu.whyConflicts",
			busy: "worktreeMenu.refusedBusy",
			elsewhere: "worktreeMenu.refusedElsewhere",
			failed: "worktreeMenu.refusedFailed",
		};
		return t(key[outcome.reason], { base, path: outcome.detail ?? "", detail: outcome.detail ?? "git" });
	}

	async function act<T>(kind: "merge" | "sync" | "abort", run: () => Promise<T>, describe: (outcome: T) => Note | null) {
		setBusy(kind);
		setNote(null);
		try {
			setNote(describe(await run()));
		} catch (cause) {
			setNote({ tone: "warn", text: t("worktreeMenu.refusedFailed", { detail: cause instanceof Error ? cause.message : String(cause) }) });
		} finally {
			setBusy(null);
			await view.refresh();
		}
	}

	const merge = () =>
		act("merge", () => bridge.worktree.merge(meta.id), (outcome): Note => {
			switch (outcome.kind) {
				case "merged":
					return { tone: "ok", text: t("worktreeMenu.merged", { n: outcome.commits, base: outcome.base }), archive: true };
				case "nothing":
					return { tone: "ok", text: t("worktreeMenu.whyNothing") };
				case "uncommitted":
					return { tone: "warn", text: t("worktreeMenu.whyUncommitted", { n: outcome.files }) };
				case "conflict":
					return { tone: "warn", text: t("worktreeMenu.mergeConflict", { files: files(outcome.files), base: outcome.base }) };
				default:
					return { tone: "warn", text: refusal(outcome) };
			}
		});

	const sync = () =>
		act("sync", () => bridge.worktree.sync(meta.id), (outcome): Note | null => {
			switch (outcome.kind) {
				case "synced":
					return { tone: "ok", text: t("worktreeMenu.synced", { n: outcome.commits, base: outcome.base }) };
				case "up-to-date":
					return { tone: "ok", text: t("worktreeMenu.whyUpToDate") };
				case "uncommitted":
					return { tone: "warn", text: t("worktreeMenu.whyUncommitted", { n: outcome.files }) };
				// Said by the conflict block above the actions, with what to do about it.
				case "conflict":
					return null;
				default:
					return { tone: "warn", text: refusal(outcome) };
			}
		});

	const abortSync = () => act("abort", () => bridge.worktree.abortSync(meta.id), (done) => (done ? null : { tone: "warn", text: t("worktreeMenu.refusedFailed", { detail: "git merge --abort" }) }));

	/*
	 * The conflicts handed to the conversation that made the work, as a message from the person — visible,
	 * and theirs to stop. It knows what both sides meant better than anyone else in the room.
	 */
	function resolve(conflicted: string[]) {
		onClose();
		void send([{ type: "text", text: t("worktreeMenu.resolvePrompt", { base, files: conflicted.join(", ") }) }], { sessionId: meta.id });
	}

	const blocked = (why: MessageKey | null, n?: number) => (why ? t(why, { n: n ?? 0 }) : undefined);
	const present = state?.present ?? true;
	const mergeWhy = running
		? blocked("worktreeMenu.whyRunning")
		: state?.merging
			? blocked("worktreeMenu.whyConflicts")
			: state && state.uncommitted > 0
				? blocked("worktreeMenu.whyUncommitted", state.uncommitted)
				: state && state.ahead === 0
					? blocked("worktreeMenu.whyNothing")
					: undefined;
	const syncWhy = running
		? blocked("worktreeMenu.whyRunning")
		: !present
			? blocked("worktreeMenu.whyTakenBack")
			: state && state.uncommitted > 0
				? blocked("worktreeMenu.whyUncommitted", state.uncommitted)
				: state && state.behind === 0
					? blocked("worktreeMenu.whyUpToDate")
					: undefined;

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			maxHeight={MENU_MAX_HEIGHT}
			label={t("worktreeMenu.title")}
			footer={
				note && (
					<div data-ly-worktree-note={note.tone} className="flex flex-col gap-1 px-3 py-2">
						<p className={`flex items-start gap-1.5 text-caption leading-snug ${note.tone === "ok" ? "text-ink-muted" : "text-ink"}`}>
							{note.tone === "ok" ? (
								<Check {...ICON} className="mt-px shrink-0 text-ok" aria-hidden />
							) : (
								<CircleAlert {...ICON} className="mt-px shrink-0 text-amber-500" aria-hidden />
							)}
							<span className="min-w-0 break-words">{note.text}</span>
						</p>
						{note.archive && !meta.archived && (
							<MenuBody className="-mx-1.5">
								<MenuItem
									icon={<Archive {...ICON} />}
									onClick={() => {
										onClose();
										void setSessionArchived(meta, true);
									}}
								>
									{t("worktreeMenu.archive")}
								</MenuItem>
							</MenuBody>
						)}
					</div>
				)
			}
		>
			<MenuBody>
				<Status branch={branch} base={base} state={state} />
				<MenuSeparator />
				{state?.merging && (
					<>
						<MenuLabel>
							<span className="flex items-center gap-1.5 text-ink">
								<CircleAlert {...ICON} className="shrink-0 text-amber-500" aria-hidden />
								{t("worktreeMenu.conflicts", { base })}
							</span>
						</MenuLabel>
						{state.conflicted.length > 0 && (
							<p data-ly-worktree-conflicts="" className="truncate px-3 pb-1 font-mono text-caption text-ink-muted" data-ly-tip={state.conflicted.join(", ")}>
								{files(state.conflicted)}
							</p>
						)}
						<MenuItem icon={<MessageSquareText {...ICON} />} disabled={running || busy !== null} onClick={() => resolve(state.conflicted)}>
							{t("worktreeMenu.resolve")}
						</MenuItem>
						<MenuItem icon={<Undo2 {...ICON} />} disabled={running || busy !== null} onClick={() => void abortSync()}>
							{t("worktreeMenu.abortSync")}
						</MenuItem>
						<MenuSeparator />
					</>
				)}
				<MenuItem
					icon={<GitMerge {...ICON} className={busy === "merge" ? "ly-pulse" : undefined} />}
					disabled={Boolean(mergeWhy) || busy !== null}
					detail={mergeWhy}
					onClick={() => void merge()}
				>
					{t("worktreeMenu.merge", { base })}
				</MenuItem>
				{!state?.merging && (
					<MenuItem
						icon={<RefreshCw {...ICON} className={busy === "sync" ? "ly-pulse" : undefined} />}
						disabled={Boolean(syncWhy) || busy !== null}
						detail={syncWhy}
						onClick={() => void sync()}
					>
						{t("worktreeMenu.sync", { base })}
					</MenuItem>
				)}
				<MenuItem icon={<FolderOpen {...ICON} />} disabled={!present} onClick={() => void bridge.workspace.reveal(meta.cwd)}>
					{t(systemWord("reveal", bridge.platform))}
				</MenuItem>
			</MenuBody>
		</Popover>
	);
}

/** The branch, and in one line what it is against its base. */
function Status({ branch, base, state }: { branch: string; base: string; state: WorktreeState | null }) {
	const { t } = useI18n();
	const facts = [t("worktreeMenu.cutFrom", { base })];
	if (state && !state.present) facts.push(t("worktreeMenu.takenBack"));
	if (state && state.ahead > 0) facts.push(t("worktreeMenu.ahead", { n: state.ahead }));
	if (state && state.behind > 0) facts.push(t("worktreeMenu.behind", { n: state.behind }));
	// Mid-sync the changed files are the conflicted ones, named in the block below.
	if (state && state.uncommitted > 0 && !state.merging) facts.push(t("worktreeMenu.uncommitted", { n: state.uncommitted }));
	return (
		<div data-ly-worktree-status="" className="px-3 pt-1.5 pb-1">
			<ScrollText text={branch} className="font-mono text-detail text-ink" />
			<p className="mt-0.5 text-caption leading-snug text-ink-faint">{facts.join(" · ")}</p>
		</div>
	);
}

/**
 * A conversation that asked for a worktree of its own and runs in the project instead: what that means,
 * and git's own words for why.
 */
export function WorktreeFailedNote({ anchor, onClose, reason }: { anchor: Anchor; onClose: () => void; reason: string }) {
	const { t } = useI18n();
	return (
		<Popover anchor={anchor} onClose={onClose} placement="top" align="start" width="wide" role="dialog" label={t("worktreeChip.failed")}>
			<div data-ly-worktree-failed-note="" className="flex flex-col gap-1.5 px-3 py-2.5">
				<p className="flex items-center gap-1.5 text-label text-ink">
					<CircleAlert {...ICON} className="shrink-0 text-amber-500" aria-hidden />
					{t("worktreeChip.failed")}
				</p>
				<p className="text-caption leading-snug text-ink-muted">{t("worktreeChip.failedDetail")}</p>
				<p className="line-clamp-4 font-mono text-caption leading-snug break-words text-ink-faint">{reason}</p>
			</div>
		</Popover>
	);
}
