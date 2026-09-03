/**
 * CI/CD & Release packaging pipeline view for the Git panel.
 *
 * Clean, borderless, soothing design inspired by Pull Requests & modern macOS/desktop layout.
 * Runs list displays as soft list rows with rich hover effects and tooltips.
 * Inspecting a workflow opens an inline floating detail view or expands as a clean inspect container.
 */

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
	Loader2,
	RefreshCw,
	Sparkles,
	Tag,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowRunStatus, WorkflowRunSummary } from "../../../electron/ipc-types.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SkeletonBar, SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { readCachedDetail, readCachedRuns, writeCachedDetail, writeCachedRuns } from "./pipeline-cache.ts";
import { relativeTime } from "../../lib/relative-time.ts";
import { bridge } from "../../services/index.ts";

interface PipelinesViewProps {
	cwd: string;
	onOpenRelease?: () => void;
}

/** Specific pipeline skeleton matching run list row structure */
function PipelineSkeletonList({ count = 6 }: { count?: number }) {
	const titles = [80, 110, 65, 95, 75, 100];
	const messages = [90, 70, 85, 60, 78, 88];
	return (
		<div className="space-y-1" role="status" aria-label="正在读取流水线">
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
		return <Loader2 size={size} strokeWidth={2.2} className="ly-spin text-amber-500 shrink-0" />;
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

export function PipelinesView({ cwd, onOpenRelease }: PipelinesViewProps) {
	const [runs, setRuns] = useState<WorkflowRunSummary[]>(() => readCachedRuns(cwd));
	const [loading, setLoading] = useState(() => runs.length === 0);
	const [refreshing, setRefreshing] = useState(false);
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
			runs.some((r) => r.status === "in_progress" || r.status === "queued") ||
			runDetail?.status === "in_progress" ||
			runDetail?.status === "queued";

		if (!hasActive) return;

		const timer = setInterval(() => {
			setTick((t) => (t + 1) % 100000);
		}, 1000);

		return () => {
			clearInterval(timer);
		};
	}, [runs, runDetail]);

	const fetchRuns = useCallback(
		async (silent = false) => {
			if (!silent && runs.length === 0) setLoading(true);
			else setRefreshing(true);
			try {
				const list = await bridge.git.listWorkflowRuns(cwd, 30);
				setRuns(list);
				writeCachedRuns(cwd, list);
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[cwd, runs.length],
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
		fetchRuns();
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
			runs.some((r) => r.status === "in_progress" || r.status === "queued") ||
			runDetail?.status === "in_progress" ||
			runDetail?.status === "queued";

		if (hasActive) {
			activePollRef.current = setInterval(() => {
				fetchRuns(true);
				if (inspectRun) fetchDetail(inspectRun.id, true);
			}, 3500);
		} else {
			if (activePollRef.current) clearInterval(activePollRef.current);
		}

		return () => {
			if (activePollRef.current) clearInterval(activePollRef.current);
		};
	}, [runs, runDetail, inspectRun, fetchRuns, fetchDetail]);

	const toggleJob = (jobId: number) => {
		setExpandedJobs((prev) => ({ ...prev, [jobId]: !prev[jobId] }));
	};

	// Skeletons during initial cold load
	if (showSkeleton) {
		return (
			<div className="flex h-full flex-col p-2.5 overflow-hidden">
				<PipelineSkeletonList count={6} />
			</div>
		);
	}

	// Empty state
	if (!loading && runs.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center p-6 text-center">
				<div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-card-hover text-ink-muted">
					<Activity className="h-6 w-6 text-ink-faint" />
					<span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
						<Sparkles size={10} />
					</span>
				</div>
				<div className="text-ui font-medium text-ink">暂无流水线运行记录</div>
				<div className="mt-1 max-w-xs text-detail text-ink-muted leading-relaxed">
					尚未在此仓库检测到 GitHub Actions 构建或发版记录。你可以使用发版中心进行打包与发布。
				</div>
				{onOpenRelease && (
					<button
						type="button"
						onClick={onOpenRelease}
						className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-card-hover px-3 py-1.5 text-detail font-medium text-ink transition-colors hover:bg-fill-muted cursor-pointer"
					>
						<Tag size={13.5} className="text-amber-500" />
						打开发版中心
					</button>
				)}
			</div>
		);
	}

	// Inspecting a specific pipeline run detail
	if (inspectRun) {
		return (
			<div className="flex h-full flex-col overflow-hidden bg-shell">
				{/* Top Header Bar */}
				<div className="flex items-center justify-between px-3.5 py-2.5">
					<div className="flex items-center gap-2 min-w-0">
						<button
							type="button"
							onClick={() => setInspectRun(null)}
							className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
							data-ly-tip="返回流水线列表"
						>
							<ArrowLeft size={15} />
						</button>
						<span className="text-ui font-medium text-ink truncate">
							{inspectRun.name || "工作流详情"}
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<IconButton
							icon={<RefreshCw size={13.5} className={detailLoading ? "animate-spin" : ""} />}
							onClick={() => fetchDetail(inspectRun.id, false)}
							label="刷新详情"
						/>
						{inspectRun.url && (
							<a
								href={inspectRun.url}
								target="_blank"
								rel="noreferrer"
								className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
								data-ly-tip="在浏览器中查看 GitHub 网页"
							>
								<ExternalLink size={13.5} />
							</a>
						)}
					</div>
				</div>

				<Scroller className="flex-1 px-3.5 pb-6">
					{/* Summary Card */}
					<div className="rounded-xl bg-card p-3.5 space-y-2.5">
						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">
								<div className="text-label font-medium text-ink truncate">
									{runDetail?.displayTitle || runDetail?.name || inspectRun.displayTitle || inspectRun.name}
								</div>
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
									事件: {runDetail?.event ?? inspectRun.event}
								</span>
							)}
						</div>
					</div>

					{/* Matrix & Jobs */}
					<div className="pt-3.5 space-y-1.5">
						<div className="px-1 text-caption font-medium text-ink-faint">
							构建任务与矩阵 ({runDetail?.jobs?.length ?? 0})
						</div>

						{detailLoading && !runDetail?.jobs?.length ? (
							<div className="py-4">
								<SkeletonList count={3} />
							</div>
						) : !runDetail?.jobs?.length ? (
							<div className="py-6 text-center text-detail text-ink-muted rounded-xl bg-card">
								暂无任务数据（等待调度或尚未初始化）
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
												className="w-full flex items-center justify-between p-3 hover:bg-card-hover transition-colors cursor-pointer text-left"
											>
												<div className="flex items-center gap-2.5 min-w-0">
													<StatusIcon status={job.status} conclusion={job.conclusion} size={15} />
													<span className="text-detail font-medium text-ink truncate">
														{job.name}
													</span>
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
																className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-card-hover text-caption text-ink-muted transition-colors"
															>
																<div className="flex items-center gap-2 min-w-0">
																	<StatusIcon
																		status={step.status}
																		conclusion={step.conclusion}
																		size={12.5}
																	/>
																	<span className="truncate">{step.name}</span>
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
			{/* Top Bar Actions */}
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<Activity size={15} className="text-ink-muted" />
					<span className="text-detail font-medium text-ink">CI / CD 流水线</span>
					{/*
					 * No 「运行中」 badge here.
					 *
					 * Every run in the list below already carries its own state — a spinner, a cross, a
					 * warning — so a badge at the top said the same thing a second time, in the loudest
					 * treatment on the panel. It was drawing the eye to a summary of what was directly
					 * underneath it, and away from the rows that actually differ from one another.
					 */}
				</div>
				<div className="flex items-center gap-1">
					<IconButton
						icon={<RefreshCw size={13.5} className={refreshing ? "animate-spin" : ""} />}
						onClick={() => fetchRuns(false)}
						label="刷新流水线"
					/>
					{onOpenRelease && (
						<button
							type="button"
							onClick={onOpenRelease}
							className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-ink-muted hover:text-ink hover:bg-card-hover transition-colors cursor-pointer"
							data-ly-tip="打开 Git 发版管理"
						>
							<Tag size={12.5} strokeWidth={1.8} className="text-ink-muted" />
							发版
						</button>
					)}
				</div>
			</div>

			{/* Clean Runs List */}
			<Scroller className="flex-1 px-2.5 pb-4 space-y-1">
				{runs.map((run) => {
					return (
						<button
							key={run.id}
							type="button"
							onClick={() => setInspectRun(run)}
							className="w-full text-left p-2.5 rounded-xl transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover group/run cursor-pointer"
							data-ly-tip={`点击查看构建任务详情 · ${run.displayTitle || run.name}`}
						>
							<div className="flex items-center justify-between gap-2 mb-1">
								<div className="flex items-center gap-2 min-w-0">
									<StatusIcon status={run.status} conclusion={run.conclusion} size={14.5} />
									<span className="text-detail font-medium text-ink truncate leading-tight">
										{run.name || "Workflow"}
									</span>
								</div>
								<span className="text-caption text-ink-faint shrink-0 whitespace-nowrap">
									{relativeTime(run.createdAt)}
								</span>
							</div>

							<div className="text-caption text-ink-muted pl-5 mb-1.5 truncate">
								{run.displayTitle || "No commit message"}
							</div>

							<div className="flex items-center gap-3 text-caption text-ink-faint pl-5">
								<span className="flex items-center gap-1 truncate max-w-[130px]">
									<GitBranch size={12} className="shrink-0 text-ink-faint" />
									<span className="truncate">{run.headBranch}</span>
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
