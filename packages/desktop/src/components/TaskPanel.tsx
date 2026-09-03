import { ListTodo } from "lucide-react";
import { useState } from "react";

import { PanelEmpty } from "../ui/layout/PanelEmpty.tsx";
import { Mark, lastTurnFailed } from "./task/Mark.tsx";
import { DetailCard } from "./detail/DetailCard.tsx";
import { RunDetail } from "./task/RunDetail.tsx";
import { Scroller } from "../ui/scroll/Scroller.tsx";
import { ScrollText } from "../ui/scroll/ScrollText.tsx";
import { Text } from "../ui/primitives/Text.tsx";
import { useApp } from "../store.ts";

/**
 * Everything this conversation set out to do and everything it actually did.
 *
 * The card floating over the transcript answers "what now" and puts itself away when the plan is
 * finished — which is right for a heads-up display and wrong for going back over the work. This
 * is the other question: what was the plan, which parts got done, and what was run along the way.
 *
 * Both halves are already in the conversation — the plan on the tool call that wrote it, the runs
 * on their cards — but scattered through a transcript that may be hundreds of messages long. The
 * value here is entirely in having them in one column, in order.
 */
export function TaskPanel() {
	const todos = useApp((s) => s.todos);
	const toolRuns = useApp((s) => s.toolRuns);
	const running = useApp((s) => s.running);
	const messages = useApp((s) => s.messages);
	/*
	 * The same three answers the floating card gives, from the same evidence.
	 *
	 * A step that is `in_progress` while nothing is running has either paused or failed, and the
	 * plan itself cannot tell you which — `todo_write` knows only pending, in progress and done.
	 * How the last turn ended is what distinguishes them.
	 */
	const failed = !running && lastTurnFailed(messages);
	/*
	 * One row open at a time.
	 *
	 * Several open at once turns the column into a wall of output you have to scroll past to reach
	 * the next step — the list stops being a list. Opening one closes the last.
	 */
	const [openId, setOpenId] = useState<string | null>(null);

	// Newest first: what just happened is what you came to look at.
	const runs = Object.values(toolRuns).sort((a, b) => b.startedAt - a.startedAt);
	const done = todos.filter((todo) => todo.status === "completed").length;

	if (todos.length === 0 && runs.length === 0) {
		return (
			<PanelEmpty icon={ListTodo} title="任务">
				这个对话还没有执行过任何操作。
			</PanelEmpty>
		);
	}

	return (
		<Scroller className="flex-1 pt-2" contentClassName="px-2 pb-3" top="none" bottom="none">
			{todos.length > 0 && (
				<>
					<Header label="计划" hint={`${done}/${todos.length}`} />
					{todos.map((todo, index) => (
						<div key={`${index}-${todo.content}`} className="ly-scroll flex items-center gap-2 rounded-md px-1.5 py-[5px]">
							<Mark status={todo.status} paused={!running && !failed} failed={failed} />
							<ScrollText
								text={todo.content}
								className={`ly-fade-tail min-w-0 flex-1 text-detail ${
									todo.status === "completed" ? "text-ink-faint line-through decoration-line" : "text-ink-muted"
								}`}
							/>
						</div>
					))}
				</>
			)}

			{runs.length > 0 && (
				<>
					<Header label="执行记录" hint={String(runs.length)} />
					{runs.map((run) => (
						<DetailCard
							key={run.toolCallId}
							open={openId === run.toolCallId}
							onToggle={() => setOpenId(openId === run.toolCallId ? null : run.toolCallId)}
							summary={<ScrollText text={run.summary} className="ly-fade-tail min-w-0 flex-1 text-detail" />}
							trailing={
								<>
									<span
										className={`h-[6px] w-[6px] shrink-0 rounded-full ${
											run.status === "running" ? "ly-pulse bg-info" : run.status === "error" ? "bg-danger" : "bg-ok/70"
										}`}
									/>
									<Text size="caption" tone="faint" numeric className="shrink-0">
										{run.finishedAt ? formatSpan(run.finishedAt - run.startedAt) : "进行中"}
									</Text>
								</>
							}
						>
							<RunDetail run={run} />
						</DetailCard>
					))}
				</>
			)}
		</Scroller>
	);
}

function Header({ label, hint }: { label: string; hint: string }) {
	return (
		<div className="flex items-center justify-between px-1.5 pt-3 pb-1">
			<Text size="caption" tone="faint">
				{label}
			</Text>
			<Text size="caption" tone="faint" numeric>
				{hint}
			</Text>
		</div>
	);
}

/** Whole seconds under a minute; nobody is timing a tool call to the millisecond. */
function formatSpan(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
