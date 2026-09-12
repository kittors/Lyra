/**
 * CI/CD & Release packaging pipeline view for the Git panel.
 *
 * Clean, borderless, soothing design inspired by Pull Requests & modern macOS/desktop layout.
 * Runs list displays as soft list rows with rich hover effects and tooltips.
 * Inspecting a workflow opens an inline floating detail view or expands as a clean inspect container.
 */

import { translate } from "../../i18n/translate.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import {
	Activity,
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	ExternalLink,
	GitBranch,
	GitCommitHorizontal,
	RefreshCw,
	Tag,
	XCircle,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowRunStatus, WorkflowRunSummary } from "../../../electron/ipc-types.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Spinner } from "../../ui/motion/loaders.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SkeletonBar, SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { readCachedDetail, readCachedRuns, writeCachedDetail, writeCachedRuns } from "./pipeline-cache.ts";
import { relativeTime } from "../../lib/relative-time.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

interface PipelinesViewProps {
	cwd: string;
	toolbar?: HTMLDivElement | null;
	active?: boolean;
	onOpenRelease?: () => void;
}

/** Specific pipeline skeleton matching run list row structure */
function PipelineSkeletonList({ count = 6 }: { count?: number }) {
	const { t } = useI18n();
	const titles = [80, 110, 65, 95, 75, 100];
	const messages = [90, 70, 85, 60, 78, 88];
	return (
		<div className="space-y-1" role="status" aria-label={t("pipelines.reading")}>
			{Array.from({ length: count }, (_, i) => {
				const titleW = titles[i % titles.length] ?? 80;
				const msgW = messages[i % messages.length] ?? 75;
				return (
					<div key={i} className="p-2.5 rounded-xl space-y-2" aria-hidden>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="ly-skeleton block h-3.5 w-3.5 rounded-full shrink-0" />
								<SkeletonBar width={`${titleW}px`} height={10} />
							</div>
							<SkeletonBar width="42px" height={9} />
						</div>
						<div className="pl-5 space-y-1.5">
							<SkeletonBar width={`${msgW}%`} height={9} />
							<div className="flex items-center gap-3 pt-0.5">
								<SkeletonBar width="56px" height={8} />
								<SkeletonBar width="48px" height={8} />
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function isValidTimestamp(str?: string): boolean {
	if (!str) return false;
	const t = new Date(str).getTime();
	return !Number.isNaN(t) && t > 0;
}

/** Format duration in seconds or minutes with live precision */
function formatDuration(startedAt?: string, completedAt?: string): string {
	if (!isValidTimestamp(startedAt)) return "";
	const start = new Date(startedAt!).getTime();
	const end = isValidTimestamp(completedAt) ? new Date(completedAt!).getTime() : Date.now();
	const diff = Math.max(0, Math.floor((end - start) / 1000));
	if (diff < 60) return `${diff}s`;
	const mins = Math.floor(diff / 60);
	const secs = diff % 60;
	return `${mins}m ${secs}s`;
}

/** Render status badge & icon for workflow / job / step */
function StatusIcon({
	status,
	conclusion,
	size = 14,
}: {
	status: string;
	conclusion?: string | null;
	size?: number;
}) {
	if (status === "in_progress") {
		return <Spinner size={size} className="text-amber-500" />;
	}
	if (status === "queued" || status === "waiting") {
		return <Clock size={size} className="text-ink-faint shrink-0" />;
	}
	if (conclusion === "success") {
		return <CheckCircle2 size={size} className="text-emerald-500 shrink-0" />;
	}
	if (conclusion === "failure" || conclusion === "timed_out") {
		return <XCircle size={size} className="text-rose-500 shrink-0" />;
	}
	if (conclusion === "cancelled" || conclusion === "skipped") {
		return <AlertCircle size={size} className="text-ink-faint shrink-0" />;
	}
	return <Clock size={size} className="text-ink-faint shrink-0" />;
}

export function PipelinesView({ cwd, onOpenRelease, toolbar, active = true }: PipelinesViewProps) {
	const { t } = useI18n();
	const [result, setResult] = useState(() => readCachedRuns(cwd));
	const runs = result ?? [];
	const loading = result === null;
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const pendingRequest = useRef<number | null>(null);
	const [inspectRun, setInspectRun] = useState<WorkflowRunSummary | null>(null);
	const [runDetail, setRunDetail] = useState<WorkflowRunStatus | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [expandedJobs, setExpandedJobs] = useState<Record<number, boolean>>({});
	const [, setTick] = useState(0);

	const showSkeleton = useSlowLoad(loading && runs.length === 0);
	const activePollRef = useRef<NodeJS.Timeout | null>(null);

	// 1-second live ticker for running tasks/steps so durations count up in real time
	useEffect(() => {
		const hasActive =
			result?.some((r) => r.status === "in_progress" || r.status === "queued") ||
			runDetail?.status === "in_progress" ||
			runDetail?.status === "queued";

		if (!hasActive) return;

		const timer = setInterval(() => {
			setTick((t) => (t + 1) % 100000);
		}, 1000);

		return () => {
			clearInterval(timer);
		};
	}, [result, runDetail]);

	const fetchRuns = useCallback(
		async () => {
			if (pendingRequest.current !== null) return;
			const generation = ++request.current;
			pendingRequest.current = generation;
			setRefreshing(true);
			setError(null);
			try {
				const list = await bridge.git.listWorkflowRuns(cwd, 30);
				if (generation !== request.current) return;
				setResult(list);
				writeCachedRuns(cwd, list);
			} catch (cause) {
				if (generation === request.current) setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (generation === request.current) {
					pendingRequest.current = null;
					setRefreshing(false);
				}
			}
		},
		[cwd],
	);

	const fetchDetail = useCallback(
		async (runId: number, silent = false) => {
			if (!silent) {
				const cached = readCachedDetail(cwd, runId);
				if (cached) {
					setRunDetail(cached);
				} else {
					setDetailLoading(true);
				}
			}
			try {
				const detail = await bridge.git.workflowRunStatus(cwd, runId);
				setRunDetail(detail);
				if (detail) writeCachedDetail(cwd, runId, detail);
			} finally {
				setDetailLoading(false);
			}
		},
		[cwd],
	);

	// Initial load
	useEffect(() => {
		void fetchRuns();
		// Hidden Activity views keep state, but their previous request no longer owns the next visit.
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- These refs track request ownership, not captured DOM nodes.
		return () => { request.current++; pendingRequest.current = null; };
	}, [fetchRuns]);

	// Detail fetch on inspect change
	useEffect(() => {
		if (inspectRun) {
			fetchDetail(inspectRun.id);
		} else {
			setRunDetail(null);
		}
	}, [inspectRun, fetchDetail]);

	// Live polling when runs or inspecting run are in progress
	useEffect(() => {
		const hasActive =
			result?.some((r) => r.status === "in_progress" || r.status === "queued") ||
			runDetail?.status === "in_progress" ||
			runDetail?.status === "queued";

		if (hasActive) {
			activePollRef.current = setInterval(() => {
				void fetchRuns();
				if (inspectRun) fetchDetail(inspectRun.id, true);
			}, 3500);
		} else {
			if (activePollRef.current) clearInterval(activePollRef.current);
		}

		return () => {
			if (activePollRef.current) clearInterval(activePollRef.current);
		};
	}, [result, runDetail, inspectRun, fetchRuns, fetchDetail]);

	const toggleJob = (jobId: number) => {
		setExpandedJobs((prev) => ({ ...prev, [jobId]: !prev[jobId] }));
	};

	const controls = <div className="flex shrink-0 items-center gap-1">
		<IconButton size="sm" icon={(inspectRun ? detailLoading : refreshing) ? <Spinner size={13.5} /> : <RefreshCw size={13.5} />}
			label={inspectRun ? t("pipelines.refreshRun") : t("pipelines.refresh")} disabled={inspectRun ? detailLoading : refreshing}
			onClick={() => void (inspectRun ? fetchDetail(inspectRun.id) : fetchRuns())} />
		{inspectRun?.url ? <a href={inspectRun.url} target="_blank" rel="noreferrer" aria-label={t("common.openInBrowser")} data-ly-tip={t("common.openInBrowser")}
			className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink"><ExternalLink size={13.5} /></a> :
			onOpenRelease && <IconButton size="sm" icon={<Tag size={13.5} />} label={t("pipelines.openReleases")} onClick={onOpenRelease} />}
	</div>;
	const actions = !active ? null : toolbar ? createPortal(controls, toolbar) : toolbar === undefined ? controls : null;

	// An unknown result must never fall through to the run list during the skeleton grace period.
	if (loading && !error) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5" aria-busy="true">
				{actions}
				{showSkeleton && <PipelineSkeletonList count={6} />}
			</div>
		);
	}

	if (runs.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				{actions}
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-8 text-center">
					<Activity size={28} strokeWidth={1.5} className="text-ink-faint" />
					<p className="text-label text-ink-muted">{error ? t("pipelines.unreadable") : t("pipelines.empty")}</p>
					{error && <p role="alert" className="max-w-full break-words text-detail text-danger">{error}</p>}
				</div>
			</div>
		);
	}

	// Inspecting a specific pipeline run detail
	if (inspectRun) {
		return (
			<div className="flex h-full flex-col overflow-hidden bg-shell">
				{actions}
				{/* Top Header Bar */}
				<div className="flex items-center justify-between px-3.5 py-2.5">
					<div className="ly-scroll flex items-center gap-2 min-w-0">
						<button
							type="button"
							onClick={() => setInspectRun(null)}
							className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
							data-ly-tip={t("pipelines.back")}
						>
							<ArrowLeft size={15} />
						</button>
						<ScrollText
							text={inspectRun.name || t("pipelines.workflowDetail")}
							className="text-ui font-medium text-ink"
						/>
					</div>
				</div>

				<Scroller className="flex-1 px-3.5 pb-6">
					{/* Summary Card */}
					<div className="ly-scroll rounded-xl bg-card p-3.5 space-y-2.5">
						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">
								<ScrollText
									text={
										runDetail?.displayTitle || runDetail?.name || inspectRun.displayTitle || inspectRun.name || ""
									}
									className="text-label font-medium text-ink"
								/>
							</div>
							<span className="text-caption text-ink-faint whitespace-nowrap">
								{relativeTime(runDetail?.createdAt ?? inspectRun.createdAt)}
							</span>
						</div>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-detail text-ink-muted pt-1">
							<span className="flex items-center gap-1.5">
								<GitBranch size={13} className="text-ink-faint" />
								<span className="font-mono text-ink">{runDetail?.headBranch ?? inspectRun.headBranch}</span>
							</span>
							{(runDetail?.headSha ?? inspectRun.headSha) && (
								<span className="flex items-center gap-1.5">
									<GitCommitHorizontal size={13} className="text-ink-faint" />
									<span className="font-mono text-ink-muted">{(runDetail?.headSha ?? inspectRun.headSha).slice(0, 7)}</span>
								</span>
							)}
							{(runDetail?.event ?? inspectRun.event) && (
								<span className="text-caption text-ink-faint">
									{translate("pipelines.eventIs", { event: runDetail?.event ?? inspectRun.event })}
								</span>
							)}
						</div>
					</div>

					{/* Matrix & Jobs */}
					<div className="pt-3.5 space-y-1.5">
						<div className="px-1 text-caption font-medium text-ink-faint">
							{translate("pipelines.jobsAndMatrix", { n: runDetail?.jobs?.length ?? 0 })}
						</div>

						{detailLoading && !runDetail?.jobs?.length ? (
							<div className="py-4">
								<SkeletonList count={3} />
							</div>
						) : !runDetail?.jobs?.length ? (
							<div className="py-6 text-center text-detail text-ink-muted rounded-xl bg-card">
								{translate("pipelines.noJobs")}
							</div>
						) : (
							<div className="space-y-1.5">
								{runDetail.jobs.map((job) => {
									const isExpanded = expandedJobs[job.id] ?? false;
									const hasSteps = (job.steps?.length ?? 0) > 0;
									const duration = formatDuration(job.startedAt, job.completedAt);

									return (
										<div
											key={job.id}
											className="rounded-xl bg-card overflow-hidden transition-colors"
										>
											<button
												type="button"
												onClick={() => toggleJob(job.id)}
												className="ly-scroll w-full flex items-center justify-between p-3 hover:bg-card-hover transition-colors cursor-pointer text-left"
											>
												<div className="flex items-center gap-2.5 min-w-0">
													<StatusIcon status={job.status} conclusion={job.conclusion} size={15} />
													<ScrollText text={job.name} className="text-detail font-medium text-ink" />
												</div>
												<div className="flex items-center gap-2 shrink-0">
													{duration && (
														<span className="text-caption text-ink-faint font-mono">
															{duration}
														</span>
													)}
													{hasSteps && (
														<span className="text-ink-faint">
															{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
														</span>
													)}
												</div>
											</button>

											{isExpanded && hasSteps && (
												<div className="px-3 pb-2.5 pt-0.5 space-y-1 bg-card">
													{job.steps?.map((step) => {
														const stepDuration = formatDuration(step.startedAt, step.completedAt);
														return (
															<div
																key={step.number}
																className="ly-scroll flex items-center justify-between py-1 px-2 rounded-lg hover:bg-card-hover text-caption text-ink-muted transition-colors"
															>
																<div className="flex items-center gap-2 min-w-0">
																	<StatusIcon
																		status={step.status}
																		conclusion={step.conclusion}
																		size={12.5}
																	/>
																	<ScrollText text={step.name} />
																</div>
																{stepDuration && (
																	<span className="text-micro text-ink-faint font-mono shrink-0 pl-2">
																		{stepDuration}
																	</span>
																)}
															</div>
														);
													})}
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				</Scroller>
			</div>
		);
	}

	// Default Run List View
	return (
		<div className="flex h-full flex-col overflow-hidden bg-shell">
			{actions}
			{error && <p role="alert" className="px-3 pb-2 text-detail text-danger">{error}</p>}

			{/* Clean Runs List */}
			<Scroller className="flex-1 px-2.5 pb-4 space-y-1">
				{runs.map((run) => {
					return (
						<button
							key={run.id}
							type="button"
							onClick={() => setInspectRun(run)}
							className="ly-scroll w-full text-left p-2.5 rounded-xl transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover group/run cursor-pointer"
							data-ly-tip={t("pipelines.jobsHint", { title: run.displayTitle || run.name })}
						>
							<div className="flex items-center justify-between gap-2 mb-1">
								<div className="flex items-center gap-2 min-w-0">
									<StatusIcon status={run.status} conclusion={run.conclusion} size={14.5} />
									<ScrollText
										text={run.name || "Workflow"}
										className="text-detail font-medium text-ink leading-tight"
									/>
								</div>
								<span className="text-caption text-ink-faint shrink-0 whitespace-nowrap">
									{relativeTime(run.createdAt)}
								</span>
							</div>

							<div className="pl-5 mb-1.5">
								<ScrollText
									text={run.displayTitle || t("pipelines.noCommitMessage")}
									className="text-caption text-ink-muted"
								/>
							</div>

							<div className="flex items-center gap-3 text-caption text-ink-faint pl-5">
								<span className="flex items-center gap-1 overflow-hidden max-w-[130px]">
									<GitBranch size={12} className="shrink-0 text-ink-faint" />
									<ScrollText text={run.headBranch} />
								</span>
								{run.headSha && (
									<span className="flex items-center gap-1 shrink-0 font-mono text-micro">
										<GitCommitHorizontal size={12} className="shrink-0" />
										<span>{run.headSha.slice(0, 7)}</span>
									</span>
								)}
								<ChevronRight size={13} className="ml-auto text-ink-faint opacity-0 group-hover/run:opacity-100 transition-opacity" />
							</div>
						</button>
					);
				})}
			</Scroller>
		</div>
	);
}
