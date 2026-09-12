import { translate } from "../../i18n/translate.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { FolderGit2, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../ui/motion/loaders.tsx";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

export function WorktreesSettings() {
	const { t } = useI18n();
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
				notify(t("worktrees.removed"));
				await refreshList();
			} else {
				notify(res.error ?? t("worktrees.removeFailed"), "error");
			}
		} catch (err) {
			notify(err instanceof Error ? err.message : t("worktrees.removeFailed"), "error");
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
					{translate("worktrees.intro")}
				</p>
			</div>

			<SectionTitle>{t("worktrees.config")}</SectionTitle>
			<Card className="mb-6">
				<Row
					title={t("worktrees.root")}
					detail={t("worktrees.rootDetail")}
					control={
						<Input
							type="text"
							value={rootDir}
							placeholder="~/.lyra/worktrees"
							onChange={(e) => update({ rootDir: e.target.value })}
							className="h-8 w-72 rounded-lg border border-line bg-input px-2.5 font-mono text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
						/>
					}
				/>
				<Row
					title={t("worktrees.autoCreate")}
					detail={t("worktrees.autoCreateDetail")}
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
					title={t("worktrees.fetchFirst")}
					detail={t("worktrees.fetchFirstDetail")}
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
					title={t("worktrees.autoPrune")}
					detail={t("worktrees.autoPruneDetail")}
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
					title={t("worktrees.keepLimit")}
					detail={t("worktrees.keepLimitDetail")}
					control={
						<Input
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
				<SectionTitle>{t("worktrees.active")}</SectionTitle>
				<button
					type="button"
					onClick={() => void refreshList()}
					disabled={refreshing}
					className="flex items-center gap-1 text-detail text-ink-muted hover:text-ink"
				>
					{refreshing ? <Spinner size={12} /> : <RefreshCw size={12} />}
					{translate("common.refresh")}
				</button>
			</div>
			{worktrees.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-10 text-center">
					<FolderGit2 size={24} className="text-ink-faint" />
					<div className="mt-2 text-label text-ink-faint">{t("worktrees.empty")}</div>
					<div className="mt-1 text-caption text-ink-faint">{t("worktrees.emptyDetail")}</div>
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
									{translate("worktrees.revealInFinder")}
								</button>
								<button
									type="button"
									disabled={deletingPath === tree.path}
									onClick={() => void removeTree(tree.repoPath, tree.path)}
									className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-card-hover hover:text-red-500 disabled:opacity-50"
									aria-label={t("worktrees.delete")}
									data-ly-tip={t("worktrees.delete")}
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