import { Database, RefreshCw, Search } from "lucide-react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, EmptyHint, GhostButton, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

interface Stats {
	exists: boolean;
	builtAt?: number;
	files?: number;
	symbols?: number;
	bytes?: number;
}

export function IndexSettings() {
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
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">索引库</h1>
			<p className="mt-2 max-w-[580px] pb-7 text-label leading-relaxed text-ink-muted">
				索引记录函数、类、接口、类型和常量的<strong className="font-medium text-ink">定义位置</strong>，Agent 用 symbol 工具查它。
			</p>

			{!workspace ? (
				<Card>
					<EmptyHint>先选择一个项目。</EmptyHint>
				</Card>
			) : (
				<>
					<SectionTitle>状态</SectionTitle>
					<Card className="mb-7">
						<Row
							title="项目"
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
										{building ? "构建中…" : stats?.exists ? "重建" : "建立索引"}
									</span>
								</GhostButton>
							}
						/>
						<Row
							title="符号数"
							control={
								<span className="font-mono text-label text-ink">
									{stats?.symbols?.toLocaleString()}
								</span>
							}
						/>
						<Row
							title="已索引文件"
							control={<span className="font-mono text-label text-ink">{stats?.files?.toLocaleString()}</span>}
						/>
						<Row
							title="索引大小"
							control={
								<span className="font-mono text-label text-ink">
									{stats?.bytes ? `${(stats.bytes / 1024).toFixed(0)} KB` : null}
								</span>
							}
						/>
						<Row
							title="上次构建"
							control={
								<span className="text-label text-ink-muted">
									{stats?.builtAt ? new Date(stats.builtAt).toLocaleString("zh-CN") : "从未"}
								</span>
							}
						/>
					</Card>

					<SectionTitle>试搜</SectionTitle>
					<Card>
						<div className="border-b border-line-soft p-3">
							<div className="relative">
								<Search
									size={14}
									strokeWidth={1.9}
									className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
								/>
								<input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="输入符号名，例如 runAgent"
									className="h-[34px] w-full rounded-[10px] border border-line bg-input pr-3 pl-9 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
								/>
							</div>
						</div>

						{hits.length === 0 ? (
							<EmptyHint>
								{query.trim().length < 2
									? "输入至少两个字符开始搜索"
									: stats?.exists
										? "没有匹配的符号"
										: "还没有索引，先点上面的「建立索引」"}
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
