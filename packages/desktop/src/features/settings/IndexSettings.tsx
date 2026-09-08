import { Input } from "../../ui/inputs/NativeField.tsx";
import { Database, RefreshCw, Search } from "lucide-react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, EmptyHint, GhostButton, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

interface Stats {
	exists: boolean;
	builtAt?: number;
	files?: number;
	symbols?: number;
	bytes?: number;
}

export function IndexSettings() {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	const [stats, setStats] = useState<Stats | null>(null);
	const [building, setBuilding] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<{ name: string; kind: string; file: string; line: number }[]>([]);

	const refresh = useCallback(async () => {
		if (!workspace) return;
		setStats(await bridge.index.stats(workspace.path));
	}, [workspace]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Search as you type — the index is in memory on the main side, so this is cheap.
	useEffect(() => {
		if (!workspace || query.trim().length < 2) {
			setHits([]);
			return;
		}
		let cancelled = false;
		void bridge.index.search(workspace.path, query.trim()).then((result) => {
			if (!cancelled) setHits(result);
		});
		return () => {
			cancelled = true;
		};
	}, [workspace, query]);

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("index.title")}</h1>
			<p className="mt-2 max-w-[580px] pb-7 text-label leading-relaxed text-ink-muted">
				{t("index.recordsWhat")}<strong className="font-medium text-ink">{t("index.definitions")}</strong>{t("index.definitionsDetail")}
			</p>

			{!workspace ? (
				<Card>
					<EmptyHint>{t("index.pickProject")}</EmptyHint>
				</Card>
			) : (
				<>
					<SectionTitle>{t("common.status")}</SectionTitle>
					<Card className="mb-7">
						<Row
							title={t("common.project")}
							detail={workspace.path}
							control={
								<GhostButton
									disabled={building}
									onClick={async () => {
										setBuilding(true);
										try {
											setStats(await bridge.index.rebuild(workspace.path));
										} finally {
											setBuilding(false);
										}
									}}
								>
									<span className="flex items-center gap-1.5">
										<RefreshCw size={11} strokeWidth={2} className={building ? "ly-spin" : undefined} />
										{building ? t("index.building") : stats?.exists ? t("index.rebuild") : t("index.build")}
									</span>
								</GhostButton>
							}
						/>
						<Row
							title={t("index.symbols")}
							control={
								<span className="font-mono text-label text-ink">
									{stats?.symbols?.toLocaleString()}
								</span>
							}
						/>
						<Row
							title={t("index.files")}
							control={<span className="font-mono text-label text-ink">{stats?.files?.toLocaleString()}</span>}
						/>
						<Row
							title={t("index.size")}
							control={
								<span className="font-mono text-label text-ink">
									{stats?.bytes ? `${(stats.bytes / 1024).toFixed(0)} KB` : null}
								</span>
							}
						/>
						<Row
							title={t("index.lastBuilt")}
							control={
								<span className="text-label text-ink-muted">
									{stats?.builtAt ? new Date(stats.builtAt).toLocaleString("zh-CN") : t("common.never")}
								</span>
							}
						/>
					</Card>

					<SectionTitle>{t("index.trySearch")}</SectionTitle>
					<Card>
						<div className="border-b border-line-soft p-3">
							<div className="relative">
								<Search
									size={14}
									strokeWidth={1.9}
									className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
								/>
								<Input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder={t("index.searchPlaceholder")}
									className="h-[34px] w-full rounded-[10px] border border-line bg-input pr-3 pl-9 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
								/>
							</div>
						</div>

						{hits.length === 0 ? (
							<EmptyHint>
								{query.trim().length < 2
									? t("index.tooShort")
									: stats?.exists
										? t("index.noSymbols")
										: t("index.buildFirst")}
							</EmptyHint>
						) : (
							<Scroller className="max-h-[340px]">
								{hits.map((hit) => (
									<button
										key={`${hit.file}:${hit.line}`}
										type="button"
										onClick={() => void bridge.system.openPath(`${workspace.path}/${hit.file}`)}
										className="flex w-full items-center gap-2.5 border-b border-line-soft px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-card-hover/50"
									>
										<Database size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
										<span className="shrink-0 font-mono text-label text-ink">{hit.name}</span>
										<span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-caption text-ink-faint">
											{hit.kind}
										</span>
										<span className="min-w-0 flex-1 truncate text-right font-mono text-detail text-ink-muted">
											{hit.file}:{hit.line}
										</span>
									</button>
								))}
							</Scroller>
						)}
					</Card>
				</>
			)}
		</div>
	);
}
