/**
 * Floating popover for committing and pushing from the Git panel toolbar.
 *
 * Replaces the permanent bottom composer: provides branch header, commit message input,
 * AI commit message generation (with language selection), inclusion of unstaged changes toggle,
 * commit, and commit & push actions.
 */

import { Check, ChevronDown, GitBranch, Languages, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { MenuBody, MenuItem, Popover, usePopover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { COMMIT_LANGUAGES, commitLanguageLabel, resolveCommitLanguage } from "./commit-language.ts";

export interface CommitPushPopoverProps {
	cwd: string;
	branch: string;
	stagedCount: number;
	unstagedCount: number;
	addedCount: number;
	removedCount: number;
	busy: boolean;
	running: boolean;
	anchor: Anchor;
	onClose: () => void;
	onCommit: (message: string) => Promise<boolean>;
	onCommitAndPush: (message: string, includeUnstaged: boolean) => Promise<boolean>;
	onPush: () => Promise<void>;
}

export function CommitPushPopover({
	cwd,
	branch,
	stagedCount,
	unstagedCount,
	addedCount,
	removedCount,
	busy,
	running,
	anchor,
	onClose,
	onCommit,
	onCommitAndPush,
	onPush,
}: CommitPushPopoverProps) {
	const { t } = useI18n();
	const [message, setMessage] = useState("");
	const [generating, setGenerating] = useState(false);
	const [includeUnstaged, setIncludeUnstaged] = useState(stagedCount === 0 && unstagedCount > 0);
	const [workingAction, setWorkingAction] = useState<"commit" | "commitAndPush" | "push" | null>(null);

	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);

	const languageMenu = usePopover();
	const language = resolveCommitLanguage(settings?.commitLanguage);

	useEffect(() => {
		if (stagedCount === 0 && unstagedCount > 0) {
			setIncludeUnstaged(true);
		}
	}, [stagedCount, unstagedCount]);

	async function generate() {
		if (generating || busy) return;
		setGenerating(true);
		try {
			const result = await bridge.git.generateCommitMessage(cwd);
			if (!result.ok || !result.message) {
				notify(result.error ?? t("commit.generateFailed"), "error");
				return;
			}
			setMessage(result.message);
		} finally {
			setGenerating(false);
		}
	}

	function setLanguage(id: string) {
		if (!settings) return;
		void saveSettings({ ...settings, commitLanguage: id });
		languageMenu.close();
	}

	async function handleCommit() {
		const trimmed = message.trim();
		if (!trimmed && stagedCount === 0 && (!includeUnstaged || unstagedCount === 0)) return;
		setWorkingAction("commit");
		try {
			if (includeUnstaged && unstagedCount > 0) {
				const status = await bridge.git.status(cwd);
				const unstagedPaths = status.unstaged.map((f) => f.path);
				if (unstagedPaths.length > 0) {
					await bridge.git.stage(cwd, unstagedPaths);
				}
			}
			let finalMessage = trimmed;
			if (!finalMessage) {
				setGenerating(true);
				const genResult = await bridge.git.generateCommitMessage(cwd);
				setGenerating(false);
				if (!genResult.ok || !genResult.message) {
					notify(genResult.error ?? t("commit.generateFailed"), "error");
					return;
				}
				finalMessage = genResult.message;
			}
			const ok = await onCommit(finalMessage);
			if (ok) {
				setMessage("");
				onClose();
			}
		} finally {
			setWorkingAction(null);
		}
	}

	async function handleCommitAndPush() {
		setWorkingAction("commitAndPush");
		try {
			const ok = await onCommitAndPush(message.trim(), includeUnstaged);
			if (ok) {
				setMessage("");
				onClose();
			}
		} finally {
			setWorkingAction(null);
		}
	}

	async function handlePush() {
		setWorkingAction("push");
		try {
			await onPush();
			onClose();
		} finally {
			setWorkingAction(null);
		}
	}

	const hasChanges = stagedCount > 0 || (includeUnstaged && unstagedCount > 0);
	const disabled = busy || running || workingAction !== null || generating;

	return (
		<Popover anchor={anchor} onClose={onClose} placement="bottom" align="end" width={340} label={t("commit.commit")}>
			<div className="flex flex-col p-3.5 text-detail">
				{/* Top branch indicator */}
				<div className="flex items-center gap-1.5 pb-2 text-ink">
					<GitBranch size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />
					<span className="font-medium text-label">{branch}</span>
				</div>

				{/* Commit message input with AI generator */}
				<div className="relative my-1">
					<textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder={t("commit.placeholder")}
						disabled={disabled}
						rows={3}
						className="w-full resize-none rounded-lg border border-line-soft bg-card px-2.5 py-2 pr-8 text-detail text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
						onKeyDown={(e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								void handleCommit();
							}
						}}
					/>
					<div className="absolute top-2 right-2 flex items-center gap-1">
						<button
							type="button"
							data-ly-tip={generating ? t("commit.generating") : t("commit.generate")}
							data-ly-tip-side="left"
							aria-label={generating ? t("commit.generating") : t("commit.generate")}
							disabled={disabled}
							onClick={() => void generate()}
							className="flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40"
						>
							{generating ? <ActionSpinner size={13} /> : <Wand2 size={13} strokeWidth={1.8} />}
						</button>
					</div>
				</div>

				{/* Language & quick options */}
				<div className="flex items-center justify-between py-1 text-caption text-ink-muted">
					<button
						type="button"
						data-ly-tip={t("commit.languageIs", { language: commitLanguageLabel(language) })}
						aria-label={t("commit.languageIs", { language: commitLanguageLabel(language) })}
						onClick={languageMenu.toggle}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-caption text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
					>
						<Languages size={12} strokeWidth={1.8} />
						<span>{commitLanguageLabel(language)}</span>
						<ChevronDown size={10} strokeWidth={2} />
					</button>

					{unstagedCount > 0 && (
						<label className="flex cursor-pointer items-center gap-1.5 select-none">
							<input
								type="checkbox"
								checked={includeUnstaged}
								onChange={(e) => setIncludeUnstaged(e.target.checked)}
								className="rounded border-line-soft text-accent accent-accent"
							/>
							<span>包含未暂存的更改</span>
							<span className="font-mono text-caption tabular-nums">
								{addedCount > 0 && <span className="text-ok">+{addedCount} </span>}
								{removedCount > 0 && <span className="text-danger">−{removedCount}</span>}
							</span>
						</label>
					)}
				</div>

				{languageMenu.open && (
					<Popover anchor={languageMenu.anchor} onClose={languageMenu.close} placement="bottom" align="start" width="compact" label={t("commit.language")}>
						<MenuBody>
							{COMMIT_LANGUAGES.map((entry) => (
								<MenuItem
									key={entry.id}
									selected={entry.id === language}
									trailing={entry.id === language ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
									onClick={() => setLanguage(entry.id)}
								>
									{entry.native}
								</MenuItem>
							))}
						</MenuBody>
					</Popover>
				)}

				{/* Action rows */}
				<div className="mt-2 space-y-1 border-t border-line-soft pt-2">
					<button
						type="button"
						disabled={disabled || !hasChanges}
						onClick={() => void handleCommit()}
						className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-detail text-ink transition-colors hover:bg-card-hover disabled:opacity-40"
					>
						<span className="flex items-center gap-2">
							{workingAction === "commit" ? <ActionSpinner size={13} /> : <span className="inline-block size-2 rounded-full border border-ink-muted" />}
							<span>提交</span>
						</span>
						<kbd className="font-mono text-[10px] text-ink-faint">⌘↩</kbd>
					</button>

					<button
						type="button"
						disabled={disabled || !hasChanges}
						onClick={() => void handleCommitAndPush()}
						className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-detail text-ink transition-colors hover:bg-card-hover disabled:opacity-40"
					>
						<span className="flex items-center gap-2">
							{workingAction === "commitAndPush" ? <ActionSpinner size={13} /> : <Sparkles size={13} strokeWidth={1.8} className="text-accent" />}
							<span>提交并推送</span>
						</span>
					</button>

					<button
						type="button"
						disabled={disabled}
						onClick={() => void handlePush()}
						className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-detail text-ink transition-colors hover:bg-card-hover disabled:opacity-40"
					>
						<span className="flex items-center gap-2">
							{workingAction === "push" ? <ActionSpinner size={13} /> : <span className="inline-block size-2 rounded-full bg-ink-faint" />}
							<span>推送</span>
						</span>
					</button>
				</div>
			</div>
		</Popover>
	);
}
