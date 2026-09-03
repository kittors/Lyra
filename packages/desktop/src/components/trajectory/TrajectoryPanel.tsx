/**
 * Everything the model saw, in the order it saw it.
 *
 * The transcript shows a conversation; this shows the record underneath it — the system prompt, the
 * reasoning, every tool call and what it returned, every sub-agent, every time the context was
 * rebuilt. Filtered by source and searchable, because the reason to open it is always a specific
 * question: what was it told, what did it try, where did it go wrong.
 *
 * Windowed like the transcript. A day-long run has thousands of entries and the list must not be
 * the reason the app stutters.
 */

import { History, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Source as TrajectorySourceKind } from "@lyra/core/trajectory-view";

import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { useApp } from "../../store.ts";
import { EntryRow } from "./EntryRow.tsx";
import { SourceFilter } from "./SourceFilter.tsx";
import { useTrajectory } from "./useTrajectory.ts";
import { bridge } from "../../services/index.ts";

/** Enough to fill any window; more arrive as you reach the end. */
const WINDOW_STEP = 150;

export function TrajectoryPanel() {
	const meta = useApp((s) => s.meta);
	const openSession = useApp((s) => s.openSession);
	const notify = useApp((s) => s.notify);

	const [sources, setSources] = useState<TrajectorySourceKind[]>([]);
	const [query, setQuery] = useState("");
	const [openSeq, setOpenSeq] = useState<string | null>(null);
	const [windowSize, setWindowSize] = useState(WINDOW_STEP);

	const { entries, counts, total, loading } = useTrajectory(sources, query);

	// A new filter or a new search starts at the top, so the window has to start over too.
	useEffect(() => setWindowSize(WINDOW_STEP), [sources, query, meta?.id]);

	if (!meta) {
		return (
			<PanelEmpty icon={History} title="轨迹">
				打开一个对话，这里会显示它的完整记录。
			</PanelEmpty>
		);
	}

	const visible = entries.slice(0, windowSize);
	const hidden = entries.length - visible.length;

	async function fork(seq: number) {
		if (!meta) return;
		const result = await bridge.sessions.fork(meta.projectId, meta.id, seq);
		if (!result) {
			notify("分叉失败", "error");
			return;
		}
		notify(`已从 #${seq} 分叉出新会话，带走 ${result.messages} 条消息`);
		await openSession(result.meta);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-1.5 px-2 pt-2">
				<Search size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="搜索这条轨迹…"
					className="ly-input min-w-0 flex-1 bg-transparent text-detail text-ink outline-none placeholder:text-ink-faint"
				/>
				<Text size="caption" tone="faint" numeric className="shrink-0">
					{entries.length}/{total}
				</Text>
			</div>

			<SourceFilter
				selected={sources}
				counts={counts}
				onToggle={(source) =>
					setSources((current) =>
						current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
					)
				}
				onClear={() => setSources([])}
			/>

			<Scroller className="flex-1 pt-1.5" contentClassName="px-2 pb-3" top="none" bottom="none">
				{loading && entries.length === 0 && (
					<Text size="caption" tone="faint" className="block px-1.5 py-2">
						读取中…
					</Text>
				)}
				{!loading && entries.length === 0 && (
					<Text size="caption" tone="faint" className="block px-1.5 py-2">
						{total === 0 ? "这个对话还没有记录。" : "没有匹配的记录。"}
					</Text>
				)}

				{visible.map((entry, index) => {
					const key = `${entry.seq}-${entry.source}-${index}`;
					return (
						<EntryRow
							key={key}
							entry={entry}
							query={query}
							open={openSeq === key}
							onToggle={() => setOpenSeq(openSeq === key ? null : key)}
							onFork={() => void fork(entry.seq)}
						/>
					);
				})}

				{hidden > 0 && (
					<button
						type="button"
						onClick={() => setWindowSize((size) => size + WINDOW_STEP)}
						className="ly-item mt-1 w-full rounded-md px-1.5 py-1.5 text-detail text-ink-faint"
					>
						还有 {hidden} 条，展开更多
					</button>
				)}
			</Scroller>
		</div>
	);
}
