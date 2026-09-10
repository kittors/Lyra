import { Wrench } from "lucide-react";
import { FlowRow } from "./FlowRow.tsx";
import { useLayoutEffect, useRef, useState } from "react";
import { translate, type MessageKey } from "../../i18n/index.ts";
import { useTranscriptDisclosure } from "./view-state.ts";


/**
 * A stretch of tool work, said in one line.
 *
 * Every run of calls looks the same here whether it is one file or nine — and that sameness is
 * the point. The transcript used to switch between two languages: a short run drew a row of
 * bordered cards, a long one collapsed to a line of grey text, and the eye had to re-learn what
 * it was looking at every few paragraphs. One form, always, reads as prose with the reply rather
 * than as furniture between paragraphs.
 *
 * The line says what was done, not how many things were done. "执行了 4 个操作" is a count of
 * events nobody witnessed; "创建 2 个文件、执行 2 条命令" is the same row of cards, read.
 */
export function ToolGroup({
	summary,
	added,
	removed,
	running,
	children,
	stateKey,
}: {
	/** What this run did, in words — see `describeRun`. */
	summary: string;
	/** Lines added and removed across the whole run, when any of it touched a file. */
	added?: number;
	removed?: number;
	running?: boolean;
	children: React.ReactNode;
	stateKey?: string;
}) {
	const [open, setOpen] = useTranscriptDisclosure(stateKey);
	const [visited, setVisited] = useState(open);
	const body = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | null>(null);

	// Measured rather than guessed, for the same reason as the task list: an animation to a
	// max-height that is not the real one either clips the list or finishes early.
	useLayoutEffect(() => {
		const element = body.current;
		if (!element) return;
		const measure = () => setHeight(element.scrollHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [children, open]);

	/*
	 * Close above, open below.
	 *
	 * A summary line belongs to the sentence that introduced it — "现在写后端核心文件：" and
	 * "创建文件 3 个" are one thought — so the gap above it is small and the gap below it is what
	 * separates this stretch of work from the next. They used to be the same size, which left
	 * every line floating between two paragraphs, belonging to neither.
	 */
	return (
		/*
		 * Marked so a test can count these and read them.
		 *
		 * What this component is for is a claim about the transcript as a whole — one line per
		 * stretch of work, the same line from the first call to the last — and that claim is only
		 * checkable from outside, against the rows actually on screen.
		 */
		<div className="mb-2.5" data-ly-run={running ? "running" : "done"}>
			{/*
			 * 前置图标是这一行的状态：转着的扳手是「正在动手」，停下的是「做完了」。它和思考行、
			 * 命令行共用同一个 16px 的槽，所以三种行的左边缘是一条线——见 `FlowRow`。
			 *
			 * 「正在跑」只由摘要上那道光说，图标不跟着转。同一件事说两遍，是长任务让人觉得吵的原因。
			 */}
			<FlowRow
				icon={<Wrench size={13} strokeWidth={1.8} />}
				summary={
					// key 在这一层：变的是这些字，而光属于外面那一行。见 `FlowRow` 里的长注释。
					<span key={summary} className="ly-fade-in">
						{summary}
					</span>
				}
				trailing={
					(added ?? 0) + (removed ?? 0) > 0 ? (
						<span className="font-mono text-caption">
							<span className="text-ok/80">+{added ?? 0}</span> <span className="text-danger/80">-{removed ?? 0}</span>
						</span>
					) : undefined
				}
				running={running}
				open={open}
				onToggle={() => {
					setVisited(true);
					setOpen((value) => !value);
				}}
			/>

			{/* `ly-freeze`: an open group's height follows what fits, so a boundary being dragged
			    keeps changing it — and an eased height would trail the pointer. See `styles.css`. */}
			<div
				style={{ height: open ? height ?? "auto" : 0 }}
				inert={!open}
				aria-hidden={!open}
				className="ly-freeze overflow-hidden transition-[height] duration-[var(--ly-t-base)] ease-out"
			>
				<div ref={body} className="pt-1">
					{(open || visited) && children}
				</div>
			</div>
		</div>
	);
}

/**
 * What a run of calls did, in the words someone would use to describe it afterwards.
 *
 * Grouped by the kind of action rather than by tool name, because "读取" is what three different
 * tools amount to from the outside. One action of one kind names its subject — that is the case
 * where the detail fits and is worth having; anything more is counted.
 */
export function describeRun(calls: { toolName: string; subject?: string }[]): string {
	const buckets = new Map<string, string[]>();
	for (const call of calls) {
		const kind = KIND[call.toolName] ? translate(KIND[call.toolName]) : translate("tools.using");
		const list = buckets.get(kind) ?? [];
		if (call.subject) list.push(call.subject);
		buckets.set(kind, list);
	}

	const counts = new Map<string, number>();
	for (const call of calls) {
		const kind = KIND[call.toolName] ? translate(KIND[call.toolName]) : translate("tools.using");
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}

	const parts: string[] = [];
	for (const [kind, count] of counts) {
		const subjects = buckets.get(kind) ?? [];
		// One of a kind, with a name worth saying: say it.
		if (count === 1 && subjects.length === 1) parts.push(`${kind} ${subjects[0]}`);
		// One of a kind with nothing to name — "执行命令 1 个" counts to one, which is just noise.
		else if (count === 1) parts.push(kind);
		else parts.push(translate("tools.countOf", { kind, count }));
	}
	return parts.join("、");
}

/*
 * 工具名到「它在做什么」的那个说法，存 key。
 *
 * 这张表在模块加载时成型，那会儿窗口还没说自己是哪种语言。译发生在读它的地方。
 */
const KIND: Record<string, MessageKey> = {
	write: "tools.create",
	edit: "tools.edit",
	read: "tools.read",
	bash: "tools.bash",
	bash_output: "tools.output",
	glob: "tools.find",
	grep: "tools.grep",
	ls: "tools.ls",
	todo_write: "tools.todo",
	web_fetch: "tools.fetch",
	web_search: "tools.webSearch",
	task: "tools.delegate",
	preview: "tools.preview",
	symbol: "tools.symbol",
	/*
	 * 技能、学习、回忆、语言服务、问一句——这五个从前不在表里，一律落到「使用 …」。
	 *
	 * 于是一行摘要读作「使用 3 个」，而那三个各是各的事。表里缺一项的代价不是报错，是那一行悄悄
	 * 变成一句废话——`describeRun` 的兜底本来就是给真正没见过的工具准备的，不是给自家工具的。
	 */
	skill: "tools.skill",
	learn: "tools.learn",
	recall: "tools.recall",
	lsp: "tools.lsp",
	ask_user: "tools.askUser",
};
