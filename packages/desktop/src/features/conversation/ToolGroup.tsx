import { Collapse } from "../../ui/layout/Collapse.tsx";
import { Wrench } from "lucide-react";
import { FlowRow } from "./FlowRow.tsx";
import { translate } from "../../i18n/index.ts";
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
	extra,
}: {
	/** What this run did, in words — see `describeRun`. */
	summary: string;
	/** Lines added and removed across the whole run, when any of it touched a file. */
	added?: number;
	removed?: number;
	running?: boolean;
	children: React.ReactNode;
	stateKey?: string;
	/** 行尾、改动行数之前的那一小块：派出去的子智能体的脸。 */
	extra?: React.ReactNode;
}) {
	const [open, setOpen] = useTranscriptDisclosure(stateKey);

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
		<div data-ly-run={running ? "running" : "done"}>
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
					extra || (added ?? 0) + (removed ?? 0) > 0 ? (
						<span className="flex items-center gap-2">
							{extra}
							{(added ?? 0) + (removed ?? 0) > 0 && (
								<span className="font-mono text-caption">
									<span className="text-ok/80">+{added ?? 0}</span> <span className="text-danger/80">-{removed ?? 0}</span>
								</span>
							)}
						</span>
					) : undefined
				}
				running={running}
				open={open}
				onToggle={() => {
					setOpen((value) => !value);
				}}
				label={translate("tools.run")}
			/>

			<Collapse open={open} bodyClassName="flex flex-col gap-2.5 pt-2.5" keepMounted>{children}</Collapse>
		</div>
	);
}

/* 「这一段做了什么」的说法搬到了 `lib/tool-kinds.ts`：子智能体那几处读数也要用它。 */
export { describeRun } from "../../lib/tool-kinds.ts";
