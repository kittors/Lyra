import { Input, Textarea } from "../../ui/inputs/NativeField.tsx";
import {
	Check,
	CheckCircle2,
	ChevronRight,
	Edit3,
	Eye,
	ExternalLink,
	Globe,
	Play,
	RefreshCw,
	Tag,
	Info,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReleaseInfo, WorkflowRunStatus } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { Markdown } from "../conversation/index.ts";
import { releaseNotes } from "./release-notes.ts";
import { MenuBody, MenuItem } from "../../ui/overlay/Menu.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Spinner } from "../../ui/motion/loaders.tsx";
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
		<Overlay onClose={onClose} width={560}>{(dismiss) => <>
			<div className="ly-release-modal flex min-h-0 flex-col bg-float text-ink">
				{/* Clean Header */}
				<div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line-soft">
					<div className="flex items-center gap-2.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink/5 text-ink">
							<Tag size={15} strokeWidth={2} />
						</div>
						<div>
							<h2 className="text-label font-semibold text-ink leading-none">{t("release.title")}</h2>
							<p className="text-caption text-ink-faint mt-0.5">{t("release.subtitle")}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => dismiss()}
						aria-label={t("release.close")} data-ly-tip={t("common.off")}
						className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
					>
						<X size={15} />
					</button>
				</div>

				{/* Body Content */}
				<Scroller className="h-[min(520px,calc(85dvh-132px))] min-h-0" contentClassName="p-5 space-y-4">
					{loading && (
						<div className="flex items-center justify-center py-12">
							<Spinner size={20} className="text-ink-faint" />
						</div>
					)}

					{publishSuccess && (
						<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-2">
							<div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
								<CheckCircle2 size={18} />
								<span>{t("release.tagged", { tag: publishSuccess })}</span>
							</div>
							<p className="text-detail text-ink-muted">
								{t("release.actionsTakingOver")}
							</p>
							<button
								type="button"
								onClick={() => dismiss()}
								className="mt-2 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 cursor-pointer"
							>
								{t("common.done")}
							</button>
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

									<div className="mt-2 h-7">{selectedType === "custom" ? <Input aria-label={t("release.customVersion")} value={customVersion} onChange={(event) => setCustomVersion(event.target.value)} placeholder="x.y.z" className="h-7 w-full rounded-lg border border-line bg-input px-3 font-mono text-detail" /> : <p className="flex h-7 items-center text-caption text-ink-faint">{selectedType === "patch" ? t("release.patchHint") : selectedType === "minor" ? t("release.minorHint") : t("release.majorHint")}</p>}</div>
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
											{generatingNotes ? <Spinner size={14} /> : <RefreshCw size={14} />}
										</button>
									</div>
								</div>

								{previewMode ? (
									<Scroller className="h-[180px] rounded-xl border border-line-soft bg-card" contentClassName="p-3.5 text-detail text-ink leading-relaxed">
										<Markdown text={notes || t("release.notesEmpty")} />
									</Scroller>
								) : (
									<Textarea
										value={notes}
										onChange={(e) => { notesRevision.current++; setNotes(e.target.value); }}
										aria-label={t("release.notesBody")}
										className="block h-[180px] w-full rounded-xl border border-line-soft bg-card p-3.5 text-detail font-mono text-ink focus:border-primary focus:outline-none resize-none leading-relaxed"
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
										onClick={handleTriggerDryRun}
										disabled={triggeringDryRun || dryRunStatus?.status === "in_progress"}
										className="flex h-6 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-micro font-medium text-ink hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-50"
									>
										{triggeringDryRun ? (
											<Spinner size={11} className="text-ink-muted" />
										) : (
											<Play size={11} strokeWidth={2.2} className="text-accent" />
										)}
										<span>
											{triggeringDryRun
												? t("release.triggering")
												: dryRunStatus?.status === "in_progress"
													? t("release.building")
													: t("release.triggerDryRun")}
										</span>
									</button>
								</div>

								{dryRunNotice && !dryRunStatus && (
									<div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-detail text-primary">
										<Spinner size={13} />
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
											<div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-line-soft">
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
															<Spinner size={12} className="text-amber-500" />
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
				</Scroller>

				{/* Footer Actions */}
				{!publishSuccess && (
					<div className="flex items-center justify-between border-t border-line-soft px-5 py-3 bg-card-hover/20">
						<div className="text-detail text-ink-muted">
							<button type="button" aria-label={t("release.whatHappens")} data-ly-tip={t("release.whatHappensDetail")}><Info size={12} className="mr-1 inline-block" /></button>{t("release.target")} <span className="font-mono font-semibold text-ink">v{currentTargetVersion}</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => dismiss()}
								className="rounded-lg px-3 py-1.5 text-detail text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								onClick={handlePublish}
								disabled={publishing || !currentTargetVersion}
								className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
							>
								{publishing ? (
									<>
										<Spinner size={13} />
										<span>{t("release.publishing")}</span>
									</>
								) : (
									<>
										<span>{t("release.publish")}</span>
										<ChevronRight size={13} />
									</>
								)}
							</button>
						</div>
					</div>
				)}
			</div>
		</>}</Overlay>
	);
}
