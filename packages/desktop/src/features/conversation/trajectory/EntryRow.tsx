/**
 * One entry in the trajectory, closed and open.
 *
 * Closed it is a kind, a line and a sequence number. Open it is the whole thing — the system prompt
 * in full, a tool's arguments and what came back, the prompt a sub-agent was sent off with. That is
 * the point of keeping the log: being able to read what the model actually saw, not a paraphrase.
 *
 * Code is set as code and prose is not. A command or a JSON argument reads better in a terminal
 * face; a question someone typed does not, and setting it that way made the panel look like a dump
 * rather than a record.
 *
 * "从这里分叉" sits in the open state rather than on hover, because forking is a deliberate act and
 * a button that appears under the pointer invites the accidental kind.
 */

import { GitBranch } from "lucide-react";
import { useState } from "react";
import { SOURCE_LABEL, matchRanges, type Entry as TrajectoryEntry } from "@lyra/core/trajectory-view";
import { CodeText } from "../detail/CodeText.tsx";
import { DetailCard } from "../detail/DetailCard.tsx";
import { Section } from "../detail/Section.tsx";
import { Text } from "../../../ui/primitives/Text.tsx";

/**
 * How each kind of entry is set.
 *
 * A tool call is a name and a JSON argument object; a result is whatever the tool printed. Both
 * read as code. A system prompt, a reply and a question are prose — setting them in a terminal
 * face made the panel look like a dump of machine noise rather than a record of a conversation.
 */
const CODE_KIND: Record<string, "shell" | "json" | "text"> = {
	"tool-call": "json",
	"tool-result": "text",
	context: "text",
	system: "text",
};

/**
 * How much of a long entry opens by default.
 *
 * A system prompt is eight thousand characters; opened whole in a 274px column it is six thousand
 * pixels of scrolling between one row and the next, which makes the list unusable for the thing it
 * is for — moving through a run. It is still readable in full, on request.
 */
const PREVIEW_CHARS = 1200;

export function EntryRow({
	entry,
	open,
	query,
	onToggle,
	onFork,
}: {
	entry: TrajectoryEntry;
	open: boolean;
	query: string;
	onToggle: () => void;
	onFork: () => void;
}) {
	const [whole, setWhole] = useState(false);
	const long = entry.detail.length > PREVIEW_CHARS;
	const shown = long && !whole ? entry.detail.slice(0, PREVIEW_CHARS) : entry.detail;

	return (
		<DetailCard
			open={open}
			onToggle={onToggle}
			label={SOURCE_LABEL[entry.source]}
			summary={<Highlighted text={entry.summary} query={query} />}
			trailing={
				<Text size="caption" tone="faint" numeric className="shrink-0">
					#{entry.seq}
				</Text>
			}
		>
			{entry.command && (
				<Section title="命令" mono tone="ink">
					<span className="mr-2 select-none text-ink-faint">$</span>
					<CodeText text={entry.command} kind="shell" query={query} />
				</Section>
			)}

			{shown && (
				<Section
					title={entry.command ? "参数" : SOURCE_LABEL[entry.source]}
					mono={Boolean(CODE_KIND[entry.source])}
				>
					<CodeText text={shown} kind={CODE_KIND[entry.source] ?? "text"} query={query} />
					{long && !whole && (
						<button
							type="button"
							onClick={() => setWhole(true)}
							className="ly-item mt-1.5 block rounded px-1 py-[2px] font-sans text-caption text-ink-faint"
						>
							…显示全部 {entry.detail.length} 字
						</button>
					)}
				</Section>
			)}

			<div className="flex items-center justify-between px-3 py-2">
				<Text size="caption" tone="faint" numeric>
					{new Date(entry.ts).toLocaleString("zh-CN")}
				</Text>
				<button
					type="button"
					onClick={onFork}
					className="ly-item flex items-center gap-1 rounded-md px-1.5 py-[3px] text-caption text-ink-muted"
					data-ly-tip="用这一刻之前的历史开一个新会话，原会话不受影响"
				>
					<GitBranch size={11} strokeWidth={1.8} />
					从这里分叉
				</button>
			</div>
		</DetailCard>
	);
}

/** The searched-for words, marked where they occur. */
function Highlighted({ text, query }: { text: string; query: string }) {
	const ranges = query.trim() ? matchRanges(text, query) : [];
	if (ranges.length === 0) return <>{text}</>;

	const parts: React.ReactNode[] = [];
	let at = 0;
	for (const [index, range] of ranges.entries()) {
		if (range.start > at) parts.push(text.slice(at, range.start));
		parts.push(
			<mark key={index} className="rounded-[2px] bg-accent/20 text-ink">
				{text.slice(range.start, range.end)}
			</mark>,
		);
		at = range.end;
	}
	if (at < text.length) parts.push(text.slice(at));
	return <>{parts}</>;
}
