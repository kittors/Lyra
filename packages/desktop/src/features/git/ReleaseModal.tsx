import { Input } from "../../ui/inputs/NativeField.tsx";
import { TextArea } from "../../ui/inputs/TextArea.tsx";
import {
	Check,
	CheckCircle2,
	Edit3,
	Eye,
	ExternalLink,
	Globe,
	Play,
	RefreshCw,
	Rocket,
	Tag,
	Info,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReleaseInfo, WorkflowRunStatus } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { Markdown } from "../conversation/index.ts";
import { releaseNotes } from "./release-notes.ts";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { MenuBody, MenuItem } from "../../ui/overlay/Menu.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ActionSpinner, StatusSpinner } from "../../ui/motion/loaders.tsx";
import { bridge } from "../../services/index.ts";

interface ReleaseModalProps {
	cwd: string;
	onClose: () => void;
}

export function ReleaseModal({ cwd, onClose }: ReleaseModalProps) {
	const { t } = useI18n();
	const [info, setInfo] = useState<ReleaseInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedType, setSelectedType] = useState<"patch" | "minor" | "major" | "custom">("patch");
	const [customVersion, setCustomVersion] = useState("");
	const [notes, setNotes] = useState("");
	const notesRevision = useRef(0);
	const [generatingNotes, setGeneratingNotes] = useState(false);
	const [notesLang, setNotesLang] = useState<"zh" | "en">("zh");
	const [langMenuOpen, setLangMenuOpen] = useState(false);
	const langButtonRef = useRef<HTMLButtonElement | null>(null);
	const [previewMode, setPreviewMode] = useState(true);
	const notify = useApp((s) => s.notify);

	// Dry Run state
	const [dryRunId, setDryRunId] = useState<number | null>(null);
	const [dryRunStatus, setDryRunStatus] = useState<WorkflowRunStatus | null>(null);
	const [triggeringDryRun, setTriggeringDryRun] = useState(false);
	const [dryRunNotice, setDryRunNotice] = useState<string | null>(null);

	// Publishing state
	const [publishing, setPublishing] = useState(false);
	const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Read current release readiness information from repository.
	const handleRefresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await bridge.git.releaseInfo(cwd);
			if (!res) throw new Error(t("release.infoUnreadable"));
			{
				setInfo(res);
				setCustomVersion(res.suggestedVersion.patch);
				setNotes(releaseNotes(res.commitsSinceTag, "zh"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [cwd, t]);

	// Fetch repository release status on mount
	useEffect(() => {
		void handleRefresh();
	}, [handleRefresh]);

	const currentTargetVersion =
		selectedType === "custom"
			? customVersion.trim()
			: (info?.suggestedVersion[selectedType] ?? customVersion);

	// Generate Release notes with categorized sections in Chinese or English
	const handleGenerateNotes = useCallback(
		async (lang: "zh" | "en" = notesLang, showToast = false) => {
			const revision = ++notesRevision.current;
			setGeneratingNotes(true);
			try {
				const freshInfo = await bridge.git.releaseInfo(cwd);
				if (!freshInfo) throw new Error(t("release.infoUnreadable"));
				setInfo(freshInfo);
				if (revision === notesRevision.current) setNotes(releaseNotes(freshInfo.commitsSinceTag, lang));
				if (showToast) notify(t("release.notesFrom", { n: freshInfo.commitsSinceTag.length }), "info");
			} catch (err) {
				if (showToast) {
					notify(err instanceof Error ? err.message : t("release.notesFailed"), "error");
				}
			} finally {
				setGeneratingNotes(false);
			}
		},
		[cwd, notesLang, notify, t],
	);

	// Poll dry run status if dryRunId is set
	useEffect(() => {
		if (!dryRunId) return;
		let alive = true;
		const interval = setInterval(async () => {
			const status = await bridge.git.workflowRunStatus(cwd, dryRunId);
			if (alive && status) {
				setDryRunStatus(status);
				if (status.status === "completed") {
					clearInterval(interval);
				}
			}
		}, 3000);

		return () => {
			alive = false;
			clearInterval(interval);
		};
	}, [cwd, dryRunId]);

	const handleTriggerDryRun = async () => {
		setError(null);
		setDryRunNotice(null);
		setTriggeringDryRun(true);
		try {
			const res = await bridge.git.triggerDryRun(cwd);
			if (!res.ok) {
				setError(res.error ?? t("release.dryRunFailed"));
				return;
			}
			if (res.runId) {
				setDryRunId(res.runId);
				setDryRunNotice(t("release.dryRunWatching"));
			} else {
				setDryRunNotice(t("release.dryRunQueued"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setTriggeringDryRun(false);
		}
	};

	const handlePublish = async () => {
		if (!currentTargetVersion) return;
		setError(null);
		setPublishing(true);

		// 1. Bump version files
		const bumpRes = await bridge.git.bumpVersion(cwd, currentTargetVersion);
		if (!bumpRes.ok) {
			setPublishing(false);
			setError(bumpRes.error ?? t("release.bumpFailed"));
			return;
		}

		// 2. Publish git tag & push
		const pubRes = await bridge.git.publishReleaseTag(cwd, currentTargetVersion);
		setPublishing(false);
		if (!pubRes.ok) {
			setError(pubRes.error ?? t("release.tagFailed"));
			return;
		}

		setPublishSuccess(pubRes.tag ?? `v${currentTargetVersion}`);
	};

	return (
		<Overlay onClose={onClose} width={560}>{(dismiss) => (
			<DialogFrame
				className="ly-release-modal"
				icon={(
					<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink">
						<Tag size={15} strokeWidth={2} />
					</span>
				)}
				title={t("release.title")}
				detail={t("release.subtitle")}
				bodyClassName="h-[min(480px,calc(85dvh-190px))] min-h-0"
				actions={publishSuccess ? (
					<>
						<div className="flex-1" />
						<DialogAction tone="primary" onClick={() => dismiss()}>{t("common.done")}</DialogAction>
					</>
				) : (
					<>
						<span className="flex min-w-0 flex-1 items-center gap-1 truncate text-detail text-ink-muted">
							<button type="button" aria-label={t("release.whatHappens")} data-ly-tip={t("release.whatHappensDetail")} className="shrink-0 text-ink-faint transition-colors hover:text-ink">
								<Info size={12} aria-hidden />
							</button>
							<span className="truncate">
								{t("release.target")} <span className="font-mono font-semibold text-ink">v{currentTargetVersion}</span>
							</span>
						</span>
						<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
						<DialogAction
							tone="primary"
							onClick={handlePublish}
							disabled={publishing || !currentTargetVersion}
						>
							{publishing ? <ActionSpinner size={13} onFill /> : <Rocket size={14} strokeWidth={1.9} aria-hidden />}
							{publishing ? t("release.publishing") : t("release.publish")}
						</DialogAction>
					</>
				)}
			>
				<div className="space-y-4">
					{loading && (
						<div className="flex items-center justify-center py-12">
							<ActionSpinner size={20} className="text-ink-faint" />
						</div>
					)}

					{/* 「知道了」那一颗搬到了底下那排按钮里，跟别的对话框一样——这里只报结果。 */}
					{publishSuccess && (
						<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-2">
							<div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
								<CheckCircle2 size={18} />
								<span>{t("release.tagged", { tag: publishSuccess })}</span>
							</div>
							<p className="text-detail text-ink-muted">
								{t("release.actionsTakingOver")}
							</p>
						</div>
					)}

					{!loading && !publishSuccess && info && (
						<>
							{/* Current info & Target Version Picker */}
							<div className="rounded-xl bg-card p-3.5 space-y-3">
								<div className="flex items-center justify-between gap-2 flex-wrap text-detail text-ink-muted">
									<span>
										{t("release.current")} <span className="font-mono text-ink font-medium">{info.currentVersion}</span>
									</span>
									<span>
										{t("release.latestTag")} <span className="font-mono text-ink font-medium">{info.latestTag ?? t("release.noTag")}</span>
									</span>
									<span>
										{t("release.pending")} <span className="font-mono text-ink font-semibold">{info.commitsSinceTag.length}</span>
									</span>
								</div>

								<div>
									<div className="text-caption font-medium text-ink-muted mb-2">{t("release.pickVersion")}</div>
									<div className="grid grid-cols-4 gap-2">
										{(["patch", "minor", "major"] as const).map((type) => (
											<button
												key={type}
												type="button"
												onClick={() => setSelectedType(type)}
												className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-detail transition-all cursor-pointer ${
													selectedType === type
														? "border-accent bg-accent/5 text-accent font-medium shadow-xs"
														: "border-line-soft bg-card-hover/40 hover:bg-card-hover text-ink"
												}`}
											>
												<span className="uppercase text-[9.5px] font-semibold tracking-wider opacity-60">
													{type}
												</span>
												<span className="font-mono mt-0.5 text-detail font-medium">{info.suggestedVersion[type]}</span>
											</button>
										))}
										<button
											type="button"
											onClick={() => setSelectedType("custom")}
											className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-detail transition-all cursor-pointer ${
												selectedType === "custom"
													? "border-accent bg-accent/5 text-accent font-medium shadow-xs"
													: "border-line-soft bg-card-hover/40 hover:bg-card-hover text-ink"
											}`}
										>
											<span className="uppercase text-[9.5px] font-semibold tracking-wider opacity-60">
												{t("common.custom")}
											</span>
											<span className="font-mono mt-0.5 text-detail font-medium">{customVersion || "x.y.z"}</span>
										</button>
									</div>

									{/* 和别处的文字框同一颗胶囊，紧凑那一档；行高改由它自己撑，外层不再钉死 28px。 */}
									<div className="mt-2 min-h-7">{selectedType === "custom" ? <Input aria-label={t("release.customVersion")} value={customVersion} onChange={(event) => setCustomVersion(event.target.value)} placeholder="x.y.z" data-ly-field="" className="ly-field ly-field-compact w-full font-mono" /> : <p className="flex h-7 items-center text-caption text-ink-faint">{selectedType === "patch" ? t("release.patchHint") : selectedType === "minor" ? t("release.minorHint") : t("release.majorHint")}</p>}</div>
								</div>
							</div>

							{/* Release Notes */}
							<div className="group/notes space-y-1.5">
								<div className="flex items-center justify-between px-0.5">
									<span className="text-caption font-medium text-ink-muted">
										{t("release.changelog")}
									</span>
									<div data-open={langMenuOpen} className="ly-notes-actions flex items-center gap-1 opacity-0 transition-opacity group-hover/notes:opacity-100 group-focus-within/notes:opacity-100">
										{/* Language Dropdown */}
										<div className="relative">
											<button
												ref={langButtonRef}
												disabled={generatingNotes}
												type="button"
												onClick={() => setLangMenuOpen((v) => !v)}
												aria-label={t("release.notesLanguage")} data-ly-tip={t("release.languageIs", { language: notesLang === "zh" ? t("common.chinese") : "English" })}
												className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
											>
												<Globe size={14} className="text-ink-muted" />
											</button>
											{langMenuOpen && (
												<Popover
													anchor={langButtonRef.current}
													onClose={() => setLangMenuOpen(false)}
													placement="bottom"
													align="end"
													width={120}
												>
													<MenuBody>
														<MenuItem
															selected={notesLang === "zh"}
															onClick={() => {
																setNotesLang("zh");
																setLangMenuOpen(false);
																void handleGenerateNotes("zh", true);
															}}
														>
															{t("common.chinese")}
														</MenuItem>
														<MenuItem
															selected={notesLang === "en"}
															onClick={() => {
																setNotesLang("en");
																setLangMenuOpen(false);
																void handleGenerateNotes("en", true);
															}}
														>
															English
														</MenuItem>
													</MenuBody>
												</Popover>
											)}
										</div>

										<button type="button" onClick={() => setPreviewMode(!previewMode)} aria-label={previewMode ? t("release.editNotes") : t("release.previewNotes")} data-ly-tip={previewMode ? t("common.edit") : t("common.preview")} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink">
											{previewMode ? <Edit3 size={14} /> : <Eye size={14} />}
										</button>
										<button type="button" onClick={() => void handleGenerateNotes(notesLang, true)} disabled={generatingNotes} aria-label={t("release.regenerateNotes")} data-ly-tip={t("resume.regenerate")} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50">
											{generatingNotes ? <ActionSpinner size={14} /> : <RefreshCw size={14} />}
										</button>
									</div>
								</div>

								{previewMode ? (
									<Scroller className="h-[180px] rounded-xl border border-line-soft bg-card" contentClassName="p-3.5 text-detail text-ink leading-relaxed">
										<Markdown text={notes || t("release.notesEmpty")} />
									</Scroller>
								) : (
									<TextArea
										value={notes}
										onChange={(next) => { notesRevision.current++; setNotes(next); }}
										aria-label={t("release.notesBody")}
										shell="h-[180px]"
										className="ly-textarea-mono"
										placeholder={t("release.notesPlaceholder")}
									/>
								)}
							</div>

							{/* Pre-flight Checks / GitHub Actions Dry Run */}
							<div className="rounded-xl bg-card p-3.5 space-y-2.5">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<span className="text-detail font-medium text-ink">
											{t("release.dryRun")}
										</span>
									</div>
									<button
										type="button"
										data-ly-tip={triggeringDryRun ? t("release.triggering") : dryRunStatus?.status === "in_progress" ? t("release.building") : t("release.triggerDryRun")}
										aria-label={triggeringDryRun ? t("release.triggering") : dryRunStatus?.status === "in_progress" ? t("release.building") : t("release.triggerDryRun")}
										onClick={handleTriggerDryRun}
										disabled={triggeringDryRun || dryRunStatus?.status === "in_progress"}
										className="grid h-6 w-6 place-items-center rounded-md border border-line bg-card text-ink hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-50"
									>
										{triggeringDryRun ? (
											<ActionSpinner size={11} className="text-ink-muted" />
										) : (
											<Play size={11} strokeWidth={2.2} className="text-accent" aria-hidden />
										)}
									</button>
								</div>

								{dryRunNotice && !dryRunStatus && (
									<div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-detail text-primary">
										<ActionSpinner size={13} />
										<span>{dryRunNotice}</span>
									</div>
								)}

								{dryRunStatus && (
									<div className="rounded-lg bg-card-hover/50 p-2.5 text-detail space-y-2">
										<div className="flex items-center justify-between text-caption">
											<span className="text-ink-muted">
												{t("common.status")}{" "}
												<span className="font-medium text-ink">
													{dryRunStatus.status === "completed"
														? dryRunStatus.conclusion === "success"
															? t("release.buildOk")
															: t("release.buildFailed")
														: t("release.buildingAll")}
												</span>
											</span>
											{dryRunStatus.url && (
												<a
													href={dryRunStatus.url}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-1 text-ink-muted hover:text-ink transition-colors"
												>
													<span>{t("release.actionsLog")}</span>
													<ExternalLink size={10.5} />
												</a>
											)}
										</div>

										{dryRunStatus.jobs.length > 0 && (
											/* 上面那行和这几格之间隔的是留白，不是一条线——这个应用里的边界都这么给。 */
											<div className="grid grid-cols-2 gap-1.5 pt-2">
												{dryRunStatus.jobs.map((job) => (
													<div
														key={job.name}
														className="flex items-center gap-1.5 text-micro text-ink-muted truncate"
													>
														{job.status === "completed" ? (
															job.conclusion === "success" ? (
																<Check size={12} className="text-emerald-500 shrink-0" />
															) : (
																<XCircle size={12} className="text-rose-500 shrink-0" />
															)
														) : (
															<StatusSpinner size={12} className="text-amber-500" />
														)}
														<span className="truncate">{job.name}</span>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>


						</>
					)}
					{error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-caption text-danger">{error}</p>}
				</div>
			</DialogFrame>
		)}</Overlay>
	);
}
