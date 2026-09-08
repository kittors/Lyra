import { SessionServices } from "./SessionServices.tsx";
import { ListTodo } from "lucide-react";
import { memo, useDeferredValue, useMemo, useRef, useState } from "react";

import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Mark, lastTurnFailed } from "./Mark.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { InlineSelect } from "../settings/index.ts";
import { filterRuns } from "./filter-runs.ts";
import { TaskRuns } from "./TaskRuns.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { useApp } from "../../store/index.ts";

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
export const TaskPanel = memo(function TaskPanel() {
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
	const scrollRef = useRef<HTMLDivElement>(null);
	const sessionId = useApp((s) => s.activeSessionId);
	const runs = useMemo(() => Object.values(toolRuns).sort((a, b) => b.startedAt - a.startedAt), [toolRuns]);
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState("");
	const search = useDeferredValue(query);
	const matched = useMemo(() => filterRuns(runs, search, status), [runs, search, status]);
	const done = todos.filter((todo) => todo.status === "completed").length;


	return (
		<Scroller scrollRef={scrollRef} className="flex-1 pt-2" contentClassName="relative px-2 pb-3">
			<SessionServices />
			{todos.length === 0 && runs.length === 0 && <PanelEmpty icon={ListTodo} title="任务">暂无执行记录</PanelEmpty>}
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
					<Header label="执行记录" hint={`${matched.length}/${runs.length}`} />
					<div className="mb-2 flex items-center gap-1">
						<SearchField value={query} onChange={setQuery} placeholder="搜索命令、参数、完整结果…" className="flex-1" />
						{/*
						 * 这里曾是全项目最后一个 `<select>`。
						 *
						 * 原生下拉的列表是系统画的：不认主题、不认字号、不认圆角，在 macOS 上还会盖住它自己的
						 * 触发器。应用里其它给你选东西的地方都走 `Popover`——模型选择器、力度选择器、分支菜单，
						 * 这个也一样，顺带继承它们的键盘操作和关闭规则。
						 */}
						<InlineSelect ariaLabel="筛选任务执行状态" value={status} onChange={setStatus}
							options={[{ value: "", label: "全部" }, { value: "running", label: "进行中" }, { value: "error", label: "失败" }, { value: "done", label: "完成" }]} />
					</div>
					{!matched.length && <p className="px-2 py-2 text-caption text-ink-faint">没有匹配的执行记录</p>}
					<TaskRuns key={`${sessionId}:${search}:${status}`} runs={matched} scrollRef={scrollRef} query={search} />
				</>
			)}
		</Scroller>
	);
});

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
