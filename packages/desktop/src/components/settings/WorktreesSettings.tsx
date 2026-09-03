import { FolderGit2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store.ts";
import { Card, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

export function WorktreesSettings() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);
	const projects = settings?.projects ?? [];
	const [worktrees, setWorktrees] = useState<{ path: string; label: string; branch?: string; isMain?: boolean; repoPath: string }[]>([]);
	const [refreshing, setRefreshing] = useState(false);
	const [deletingPath, setDeletingPath] = useState<string | null>(null);

	const rootDir = settings?.worktrees?.rootDir ?? "";
	const autoCreate = settings?.worktrees?.autoCreateOnNewSession ?? false;
	const fetchUpstream = settings?.worktrees?.fetchUpstreamBeforeCreate ?? false;
	const autoClean = settings?.worktrees?.autoCleanOld ?? true;
	const keepLimit = settings?.worktrees?.keepLimit ?? 15;

	const update = (patch: Partial<NonNullable<typeof settings>["worktrees"]>) => {
		if (!settings) return;
		void saveSettings({
			...settings,
			worktrees: {
				...settings.worktrees,
				...patch,
			},
		});
	};

	const refreshList = async () => {
		setRefreshing(true);
		try {
			const all: { path: string; label: string; branch?: string; isMain?: boolean; repoPath: string }[] = [];
			for (const p of projects) {
				const trees = await bridge.git.worktrees(p.path).catch(() => []);
				for (const t of trees) {
					if (t.worktree) {
						all.push({
							path: t.path,
							label: t.label,
							branch: t.branch ?? undefined,
							isMain: false,
							repoPath: p.path,
						});
					}
				}
			}
			setWorktrees(all);
		} finally {
			setRefreshing(false);
		}
	};

	const removeTree = async (repoPath: string, treePath: string) => {
		if (deletingPath) return;
		setDeletingPath(treePath);
		try {
			const res = await bridge.git.removeWorktree(repoPath, treePath);
			if (res.ok) {
				notify("已移除工作树");
				await refreshList();
			} else {
				notify(res.error ?? "移除工作树失败", "error");
			}
		} catch (err) {
			notify(err instanceof Error ? err.message : "移除工作树失败", "error");
		} finally {
			setDeletingPath(null);
		}
	};

	useEffect(() => {
		void refreshList();
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- refreshed when project count changes
	}, [projects.length]);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-title font-semibold text-ink">Worktrees</h2>
				<p className="mt-1 text-label text-ink-muted">
					管理与配置 Git 工作树（Worktrees），使主会话与子任务可以在完全独立的代码分支和目录中并行工作。
				</p>
			</div>

			<SectionTitle>工作树配置</SectionTitle>
			<Card className="mb-6">
				<Row
					title="工作树根目录"
					detail="ChatGPT / Agent 创建托管工作树的目录。留空则默认保存在项目同级目录下"
					control={
						<input
							type="text"
							value={rootDir}
							placeholder="~/.lyra/worktrees"
							onChange={(e) => update({ rootDir: e.target.value })}
							className="h-8 w-72 rounded-lg border border-line bg-input px-2.5 font-mono text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
						/>
					}
				/>
				<Row
					title="新建会话时自动创建独立工作树"
					detail="为每个新开启的对话会话自动创建专属的 Git 工作树与分支，避免破坏主工作区状态。"
					control={
						<button
							type="button"
							role="switch"
							aria-checked={autoCreate}
							onClick={() => update({ autoCreateOnNewSession: !autoCreate })}
							className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-[var(--ly-t-quick)] ${
								autoCreate ? "bg-accent" : "bg-card-hover"
							}`}
						>
							<span
								className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-[var(--ly-t-quick)] ${
									autoCreate ? "translate-x-4" : "translate-x-0"
								}`}
							/>
						</button>
					}
				/>
				<Row
					title="创建工作树前始终获取上游更新"
					detail="通常会在常规 Git 操作中获取分支更新。此设置还会在创建每个新工作树前自动获取上游更新。"
					control={
						<button
							type="button"
							role="switch"
							aria-checked={fetchUpstream}
							onClick={() => update({ fetchUpstreamBeforeCreate: !fetchUpstream })}
							className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-[var(--ly-t-quick)] ${
								fetchUpstream ? "bg-accent" : "bg-card-hover"
							}`}
						>
							<span
								className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-[var(--ly-t-quick)] ${
									fetchUpstream ? "translate-x-4" : "translate-x-0"
								}`}
							/>
						</button>
					}
				/>
				<Row
					title="自动删除旧工作树"
					detail="推荐大多数用户启用。仅当你需要手动管理旧工作树和磁盘使用空间时，再关闭此功能。"
					control={
						<button
							type="button"
							role="switch"
							aria-checked={autoClean}
							onClick={() => update({ autoCleanOld: !autoClean })}
							className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-[var(--ly-t-quick)] ${
								autoClean ? "bg-accent" : "bg-card-hover"
							}`}
						>
							<span
								className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-[var(--ly-t-quick)] ${
									autoClean ? "translate-x-4" : "translate-x-0"
								}`}
							/>
						</button>
					}
				/>
				<Row
					title="自动删除限制"
					detail="要保留的托管工作树数量；超过后，较旧的工作树会自动被清理。"
					control={
						<input
							type="number"
							min={1}
							max={100}
							value={keepLimit}
							onChange={(e) => update({ keepLimit: Number(e.target.value) || 15 })}
							className="h-8 w-20 rounded-lg border border-line bg-input px-2.5 text-center text-label text-ink focus:border-ink-faint"
						/>
					}
				/>
			</Card>

			<div className="mb-3 flex items-center justify-between">
				<SectionTitle>活跃工作树</SectionTitle>
				<button
					type="button"
					onClick={() => void refreshList()}
					disabled={refreshing}
					className="flex items-center gap-1 text-detail text-ink-muted hover:text-ink"
				>
					<RefreshCw size={12} className={refreshing ? "ly-spin" : ""} />
					刷新
				</button>
			</div>
			{worktrees.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-10 text-center">
					<FolderGit2 size={24} className="text-ink-faint" />
					<div className="mt-2 text-label text-ink-faint">尚无活跃工作树</div>
					<div className="mt-1 text-caption text-ink-faint">创建的托管 Git 工作树将显示在此处</div>
				</div>
			) : (
				<div className="divide-y divide-line/60 rounded-lg border border-line bg-card">
					{worktrees.map((tree) => (
						<div key={tree.path} className="flex items-center justify-between px-3.5 py-2.5">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-label font-medium text-ink">{tree.label}</span>
									{tree.branch && (
										<span className="rounded-sm bg-card-hover px-1.5 py-0.5 text-caption font-mono text-ink-muted">
											{tree.branch}
										</span>
									)}
								</div>
								<div className="truncate text-caption text-ink-faint font-mono">{tree.path}</div>
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => void bridge.workspace.reveal(tree.path)}
									className="rounded-md px-2 py-1 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
								>
									在访达中显示
								</button>
								<button
									type="button"
									disabled={deletingPath === tree.path}
									onClick={() => void removeTree(tree.repoPath, tree.path)}
									className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-card-hover hover:text-red-500 disabled:opacity-50"
									aria-label="删除工作树"
									data-ly-tip="删除工作树"
								>
									<Trash2 size={14} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}