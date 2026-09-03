import {
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Edit3,
	Eye,
	ExternalLink,
	Globe,
	Loader2,
	Play,
	RefreshCw,
	Tag,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReleaseInfo, WorkflowRunStatus } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store.ts";
import { Markdown } from "../Markdown.tsx";
import { MenuBody, MenuItem } from "../Menu.tsx";
import { Overlay } from "../modals/Overlay.tsx";
import { Popover } from "../Popover.tsx";
import { Scroller } from "../Scroller.tsx";
import { bridge } from "../../services/index.ts";

interface ReleaseModalProps {
	cwd: string;
	onClose: () => void;
}

export function ReleaseModal({ cwd, onClose }: ReleaseModalProps) {
	const [info, setInfo] = useState<ReleaseInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedType, setSelectedType] = useState<"patch" | "minor" | "major" | "custom">("patch");
	const [customVersion, setCustomVersion] = useState("");
	const [notes, setNotes] = useState("");
	const [generatingNotes, setGeneratingNotes] = useState(false);
	const [notesLang, setNotesLang] = useState<"zh" | "en">("zh");
	const [langMenuOpen, setLangMenuOpen] = useState(false);
	const langButtonRef = useRef<HTMLButtonElement | null>(null);
	const [previewMode, setPreviewMode] = useState(false);
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
			if (res) {
				setInfo(res);
				setCustomVersion(res.suggestedVersion.patch);
				// Automatically generate notes if commits are found
				if (res.commitsSinceTag.length > 0) {
					const commits = res.commitsSinceTag;
					const isZh = notesLang === "zh";
					const featCommits = commits.filter((c) => /^feat(\(.*\))?:/i.test(c.subject));
					const perfCommits = commits.filter((c) => /^(perf|style|refactor)(\(.*\))?:/i.test(c.subject));
					const fixCommits = commits.filter((c) => /^fix(\(.*\))?:/i.test(c.subject));
					const otherCommits = commits.filter(
						(c) => !featCommits.includes(c) && !perfCommits.includes(c) && !fixCommits.includes(c),
					);

					const cleanSubject = (subject: string) => {
						return subject.replace(/^(feat|fix|perf|style|refactor|docs|chore|test)(\(.*?\))?:\s*/i, "");
					};

					const sections: string[] = [];
					if (featCommits.length > 0) {
						sections.push(
							`### ${isZh ? "✨ 新功能" : "✨ Features"}\n${featCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
						);
					}
					if (perfCommits.length > 0) {
						sections.push(
							`### ${isZh ? "⚡ 优化与体验" : "⚡ Performance & Improvements"}\n${perfCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
						);
					}
					if (fixCommits.length > 0) {
						sections.push(
							`### ${isZh ? "🐛 问题修复" : "🐛 Bug Fixes"}\n${fixCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
						);
					}
					if (otherCommits.length > 0) {
						sections.push(
							`### ${isZh ? "📦 其他更新" : "📦 Other Changes"}\n${otherCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
						);
					}
					setNotes(sections.join("\n\n"));
				} else {
					setNotes(notesLang === "zh" ? "无新增变更记录" : "No new changes recorded");
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [cwd, notesLang]);

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
			setGeneratingNotes(true);
			try {
				const isZh = lang === "zh";
				// Fetch fresh release info from repository
				const freshInfo = await bridge.git.releaseInfo(cwd).catch(() => null);
				const targetInfo = freshInfo ?? info;
				if (freshInfo) setInfo(freshInfo);

				const commits = targetInfo?.commitsSinceTag ?? [];
				if (commits.length === 0) {
					const fallback = isZh ? "无新增变更记录" : "No new changes recorded";
					setNotes(fallback);
					if (showToast) {
						notify(isZh ? "未检测到新提交记录（当前处于最新 Tag 上）" : "No new commits detected", "warn");
					}
					return;
				}

				// Build categorized notes outline
				const featCommits = commits.filter((c) => /^feat(\(.*\))?:/i.test(c.subject));
				const perfCommits = commits.filter((c) => /^(perf|style|refactor)(\(.*\))?:/i.test(c.subject));
				const fixCommits = commits.filter((c) => /^fix(\(.*\))?:/i.test(c.subject));
				const otherCommits = commits.filter(
					(c) => !featCommits.includes(c) && !perfCommits.includes(c) && !fixCommits.includes(c),
				);

				const cleanSubject = (subject: string) => {
					return subject.replace(/^(feat|fix|perf|style|refactor|docs|chore|test)(\(.*?\))?:\s*/i, "");
				};

				const sections: string[] = [];
				if (featCommits.length > 0) {
					sections.push(
						`### ${isZh ? "✨ 新功能" : "✨ Features"}\n${featCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
					);
				}
				if (perfCommits.length > 0) {
					sections.push(
						`### ${isZh ? "⚡ 优化与体验" : "⚡ Performance & Improvements"}\n${perfCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
					);
				}
				if (fixCommits.length > 0) {
					sections.push(
						`### ${isZh ? "🐛 问题修复" : "🐛 Bug Fixes"}\n${fixCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
					);
				}
				if (otherCommits.length > 0) {
					sections.push(
						`### ${isZh ? "📝 其它改动" : "📝 Other Changes"}\n${otherCommits.map((c) => `- ${cleanSubject(c.subject)}`).join("\n")}`,
					);
				}

				let generated = "";
				if (sections.length > 0) {
					generated = sections.join("\n\n");
				} else {
					generated = commits.map((c) => `- ${c.subject} (${c.shortSha})`).join("\n");
				}

				setNotes(generated);
				if (showToast) {
					notify(
						isZh ? `已根据 ${commits.length} 条提交生成更新日志` : `Generated release notes from ${commits.length} commits`,
						"info",
					);
				}
			} catch (err) {
				if (showToast) {
					notify(err instanceof Error ? err.message : "提取日志失败", "error");
				}
			} finally {
				setGeneratingNotes(false);
			}
		},
		[cwd, info, notesLang, notify],
	);

	// Initialize default notes when info is loaded
	useEffect(() => {
		if (info && !notes) {
			void handleGenerateNotes("zh");
		}
	}, [info, notes, handleGenerateNotes]);

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
				setError(res.error ?? "触发 GitHub Actions 试运行失败");
				return;
			}
			if (res.runId) {
				setDryRunId(res.runId);
				setDryRunNotice("已成功触发 GitHub Actions 跨平台打包试运行！正在实时监听进度…");
			} else {
				setDryRunNotice("已触发 GitHub Actions release-dryrun.yml，等待调度排队中…");
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
			setError(bumpRes.error ?? "更新 package.json 失败");
			return;
		}

		// 2. Publish git tag & push
		const pubRes = await bridge.git.publishReleaseTag(cwd, currentTargetVersion);
		setPublishing(false);
		if (!pubRes.ok) {
			setError(pubRes.error ?? "发布 Git Tag 失败");
			return;
		}

		setPublishSuccess(pubRes.tag ?? `v${currentTargetVersion}`);
	};

	return (
		<Overlay onClose={onClose} width={560}>
			<div className="flex flex-col max-h-[85vh] bg-float text-ink">
				{/* Clean Header */}
				<div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line-soft">
					<div className="flex items-center gap-2.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink/5 text-ink">
							<Tag size={15} strokeWidth={2} />
						</div>
						<div>
							<h2 className="text-label font-semibold text-ink leading-none">发版中心</h2>
							<p className="text-caption text-ink-faint mt-0.5">打包发布新版本并同步 GitHub Release</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
					>
						<X size={15} />
					</button>
				</div>

				{/* Body Content */}
				<Scroller className="flex-1 max-h-[62vh]" contentClassName="p-5 space-y-4">
					{loading && (
						<div className="flex items-center justify-center py-12">
							<Loader2 size={20} className="animate-spin text-ink-faint" />
						</div>
					)}

					{publishSuccess && (
						<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-2">
							<div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
								<CheckCircle2 size={18} />
								<span>版本 {publishSuccess} 已成功打 Tag 并推送到远程！</span>
							</div>
							<p className="text-detail text-ink-muted">
								GitHub Actions Release 正在自动多平台打包并发布产物。
							</p>
							<button
								type="button"
								onClick={onClose}
								className="mt-2 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 cursor-pointer"
							>
								完成
							</button>
						</div>
					)}

					{!loading && !publishSuccess && info && (
						<>
							{/* Current info & Target Version Picker */}
							<div className="rounded-xl bg-card p-3.5 space-y-3">
								<div className="flex items-center justify-between text-detail text-ink-muted">
									<span>
										当前: <span className="font-mono text-ink font-medium">{info.currentVersion}</span>
									</span>
									<span>
										最新 Tag: <span className="font-mono text-ink font-medium">{info.latestTag ?? "无"}</span>
									</span>
									<span>
										待发提交: <span className="font-mono text-ink font-semibold">{info.commitsSinceTag.length}</span>
									</span>
								</div>

								<div>
									<div className="text-caption font-medium text-ink-muted mb-2">选择目标版本号</div>
									<div className="grid grid-cols-4 gap-2">
										{(["patch", "minor", "major"] as const).map((type) => (
											<button
												key={type}
												type="button"
												onClick={() => setSelectedType(type)}
												className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-detail transition-all cursor-pointer ${
													selectedType === type
														? "border-primary bg-primary/10 text-primary font-medium shadow-xs"
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
													? "border-primary bg-primary/10 text-primary font-medium shadow-xs"
													: "border-line-soft bg-card-hover/40 hover:bg-card-hover text-ink"
											}`}
										>
											<span className="uppercase text-[9.5px] font-semibold tracking-wider opacity-60">
												自定义
											</span>
											<span className="font-mono mt-0.5 text-detail font-medium">{customVersion || "x.y.z"}</span>
										</button>
									</div>

									{selectedType === "custom" && (
										<input
											type="text"
											value={customVersion}
											onChange={(e) => setCustomVersion(e.target.value)}
											placeholder="0.8.6"
											className="mt-2.5 w-full rounded-lg border border-line-soft bg-card-hover/30 px-3 py-1.5 text-detail font-mono text-ink focus:border-primary focus:outline-none"
										/>
									)}
								</div>
							</div>

							{/* Release Notes */}
							<div className="space-y-1.5">
								<div className="flex items-center justify-between px-0.5">
									<span className="text-caption font-medium text-ink-muted">
										版本更新日志 (Release Notes)
									</span>
									<div className="flex items-center gap-1.5">
										{/* Language Dropdown */}
										<div className="relative">
											<button
												ref={langButtonRef}
												type="button"
												onClick={() => setLangMenuOpen((v) => !v)}
												className="flex h-6 items-center gap-1 rounded-md border border-line bg-card px-2 text-micro font-medium text-ink transition-colors hover:bg-card-hover cursor-pointer"
											>
												<Globe size={11} className="text-ink-muted" />
												<span>{notesLang === "zh" ? "中文" : "English"}</span>
												<ChevronDown size={10} className="text-ink-faint" />
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
															中文
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

										{/* Preview Toggle */}
										<button
											type="button"
											onClick={() => setPreviewMode(!previewMode)}
											className={`flex h-6 items-center gap-1 rounded-md px-2 text-micro border transition-colors cursor-pointer ${
												previewMode
													? "border-primary bg-primary/10 text-primary font-medium"
													: "border-line bg-card hover:bg-card-hover text-ink-muted"
											}`}
										>
											{previewMode ? <Edit3 size={11} /> : <Eye size={11} />}
											<span>{previewMode ? "编辑" : "预览"}</span>
										</button>

										{/* Re-extract Action */}
										<button
											type="button"
											onClick={() => void handleGenerateNotes(notesLang, true)}
											disabled={generatingNotes}
											className="flex h-6 items-center gap-1 rounded-md border border-line bg-card px-2 text-micro font-medium text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
										>
											<RefreshCw size={11} strokeWidth={1.9} className={generatingNotes ? "animate-spin text-ink" : "text-ink-muted"} />
											<span>{generatingNotes ? "提取中…" : "重新提取"}</span>
										</button>
									</div>
								</div>

								{previewMode ? (
									<div className="min-h-[140px] max-h-[220px] overflow-y-auto rounded-xl border border-line-soft bg-card p-3.5 text-detail text-ink leading-relaxed">
										<Markdown text={notes || "*(无内容)*"} />
									</div>
								) : (
									<textarea
										value={notes}
										onChange={(e) => setNotes(e.target.value)}
										rows={6}
										className="w-full rounded-xl border border-line-soft bg-card p-3 text-detail font-mono text-ink focus:border-primary focus:outline-none resize-none leading-relaxed"
										placeholder="在此编辑发版说明..."
									/>
								)}
							</div>

							{/* Pre-flight Checks / GitHub Actions Dry Run */}
							<div className="rounded-xl bg-card p-3.5 space-y-2.5">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<span className="text-detail font-medium text-ink">
											跨平台打包试运行 (Dry Run)
										</span>
									</div>
									<button
										type="button"
										onClick={handleTriggerDryRun}
										disabled={triggeringDryRun || dryRunStatus?.status === "in_progress"}
										className="flex h-6 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-micro font-medium text-ink hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-50"
									>
										{triggeringDryRun ? (
											<Loader2 size={11} className="animate-spin text-ink-muted" />
										) : (
											<Play size={11} strokeWidth={2.2} className="text-accent" />
										)}
										<span>
											{triggeringDryRun
												? "触发中…"
												: dryRunStatus?.status === "in_progress"
													? "正在构建..."
													: "触发 Dry Run"}
										</span>
									</button>
								</div>

								{dryRunNotice && !dryRunStatus && (
									<div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-detail text-primary">
										<Loader2 size={13} className="animate-spin shrink-0" />
										<span>{dryRunNotice}</span>
									</div>
								)}

								{dryRunStatus && (
									<div className="rounded-lg bg-card-hover/50 p-2.5 text-detail space-y-2">
										<div className="flex items-center justify-between text-caption">
											<span className="text-ink-muted">
												状态:{" "}
												<span className="font-medium text-ink">
													{dryRunStatus.status === "completed"
														? dryRunStatus.conclusion === "success"
															? "全部平台构建成功 ✓"
															: "构建失败 ✗"
														: "正在构建各平台产物..."}
												</span>
											</span>
											{dryRunStatus.url && (
												<a
													href={dryRunStatus.url}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-1 text-ink-muted hover:text-ink transition-colors"
												>
													<span>查看 Actions 日志</span>
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
															<Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
														)}
														<span className="truncate">{job.name}</span>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>

							{error && (
								<div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-caption text-rose-500">
									{error}
								</div>
							)}
						</>
					)}
				</Scroller>

				{/* Footer Actions */}
				{!publishSuccess && (
					<div className="flex items-center justify-between border-t border-line-soft px-5 py-3 bg-card-hover/20">
						<div className="text-detail text-ink-muted">
							发布目标: <span className="font-mono font-semibold text-ink">v{currentTargetVersion}</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded-lg px-3 py-1.5 text-detail text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
							>
								取消
							</button>
							<button
								type="button"
								onClick={handlePublish}
								disabled={publishing || !currentTargetVersion}
								className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
							>
								{publishing ? (
									<>
										<Loader2 size={13} className="animate-spin" />
										<span>发布中...</span>
									</>
								) : (
									<>
										<span>确认并发布 (打 Tag & Push)</span>
										<ChevronRight size={13} />
									</>
								)}
							</button>
						</div>
					</div>
				)}
			</div>
		</Overlay>
	);
}
