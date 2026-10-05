/**
 * One row in the sub-agent transcript.
 *
 * Follows the main conversation's layout and mechanics:
 * - Markdown rendering
 * - Collapsible ToolGroup and ToolCard — including calls in the middle of a reply
 * - Tool loading, diff hunks and execution status derived from toolRuns
 * - ThinkingBlock
 *
 * 用户那一侧分两种人说的话。派它出去的那个 Agent 说的（开头那份任务、续跑时补的一句）画成一张
 * 任务卡片——它不是看着面板的人说的，画成右边的气泡等于替人认领了一段他没写过的话。人自己在操控
 * 框里说的，画成和侧边聊天同一个气泡：认得 `displayText`，附件是句子里的标签，不是整篇正文。
 */

import { translate } from "../../i18n/translate.ts";
import { CornerRightDown } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Message, UserMessage } from "@lyra/core";
import { MessageActions, runs, runKey, segments, SpokenBubble, spokenText, ToolRun } from "../conversation/index.ts";
import { Markdown } from "../conversation/index.ts";
import { ThinkingBlock } from "../conversation/index.ts";
import { subAgentRuns } from "./runs.ts";

/**
 * 这一句是派它出去的那一方说的吗。
 *
 * 新的转录里它们带着 `origin: "parent"`；更早的没有这个标记，那时开头那一句就是任务本身。
 */
export function fromParent(message: Message, index: number): boolean {
	return message.role === "user" && (message.origin === "parent" || index === 0);
}

export const SubAgentTranscript = memo(function SubAgentTranscript({
	messages,
	isLive,
	echo,
}: {
	messages: Message[];
	isLive?: boolean;
	/**
	 * 下面那张「回报给主 Agent」卡片里已经写着的那段话。
	 *
	 * 没声明输出格式的子智能体，交回去的就是它最后说的那段话——转录末尾一遍、回报卡片里又一遍，
	 * 同一段字上下紧挨着出现两次。跑完之后最后那条回复里被回报原样收走的字就不在这儿画了，只在
	 * 卡片里画：那张卡片说得清「这是主 Agent 读到的」，这里不用再说一遍。
	 */
	echo?: string;
}) {
	const transcriptRuns = useMemo(() => runs(messages), [messages]);
	const toolRuns = useMemo(() => subAgentRuns(messages), [messages]);
	const lastReply = isLive || !echo ? -1 : messages.findLastIndex((message) => message.role === "assistant");

	return (
		<div className="flex flex-col">
			{transcriptRuns.map((run) => {
				if (run.kind === "compaction") return null;

				if (run.kind === "tools") {
					// Which run is being worked on is `grouping.ts`'s answer; whether anyone is working on
					// it at all is this panel's. The same pair as in `Conversation`.
					return <ToolRun key={runKey(run)} calls={run.calls} live={Boolean(isLive && run.live)} runs={toolRuns} />;
				}

				const { message, upTo } = run;
				// Set only on the reply whose reasoning `grouping.ts` drew above the work; see `Run.from`.
				const from = run.from ?? 0;
				if (message.role === "user") {
					if (message.synthetic) return null;
					if (fromParent(message, run.index)) return <TaskBrief key={runKey(run)} message={message} resumed={run.index > 0} />;
					return (
						<div key={runKey(run)} className="group/msg ly-enter mb-3 flex flex-col items-end">
							{/* 和侧边聊天同一个气泡——见 `SpokenBubble`。 */}
							<SpokenBubble message={message} renderText={(plain) => <Markdown text={plain} />} />
							<MessageActions timestamp={message.timestamp} text={spokenText(message)} className="pr-1" />
						</div>
					);
				}

				if (message.role === "assistant") {
					/*
					 * 按段画，和主会话的 `rows.tsx` 一样：夹在两段话中间的那几次调用收成一行。
					 *
					 * 这里从前只认思考和文字，别的一律 `null`——而一条回复里「先说两句、调几个工具、再说两
					 * 句、再调」是常事，排在最后的那几次归下面那一行画，夹在中间的就这么不见了。面板上看起来
					 * 是它说完一段话，下一段就凭空知道了答案。
					 */
					return (
						<div key={runKey(run)} className="ly-enter mb-3 flex flex-col gap-2.5">
							{segments(message.content.slice(from, upTo)).map((segment, position) => {
								if (segment.kind === "tools") {
									return (
										<ToolRun
											key={`tools-${from + position}`}
											calls={segment.blocks.map((block) => ({ block, stopReason: message.stopReason }))}
											runs={toolRuns}
										/>
									);
								}
								const { block, index } = segment;
								const at = from + index;
								if (block.type === "thinking") {
									return (
										<ThinkingBlock
											key={at}
											text={block.thinking}
											redacted={block.redacted === true}
											live={message.stopReason === "pending" && at === message.content.length - 1}
										/>
									);
								}
								if (block.type === "text" && block.text.trim()) {
									if (run.index === lastReply && echo?.includes(block.text.trim())) return null;
									return (
										<div key={at} className="min-w-0 max-w-full overflow-hidden">
											<Markdown
												text={block.text}
												className="min-w-0 max-w-full break-words"
												streaming={message.stopReason === "pending" && at === message.content.length - 1}
											/>
										</div>
									);
								}
								return null;
							})}
							{message.stopReason === "error" && message.errorMessage && (
								<div className="rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail text-danger">
									{message.errorMessage}
								</div>
							)}
						</div>
					);
				}

				return null;
			})}
		</div>
	);
});

/** 长到这个份上，先收起来：一份交代得很细的任务能有几十行，摊开就把它干的活推到屏幕外。 */
const BRIEF_LINES = 8;
const BRIEF_CHARS = 420;

/**
 * 派它出去的那一方交代的话。
 *
 * 左边、一张淡卡片、上面写着是谁交代的——而不是右边的人话气泡。长的先收着，露出开头几行和一个
 * 「展开全部」：它要读，但它不该把这个子智能体此刻在干什么挤到屏幕外面。
 */
function TaskBrief({ message, resumed }: { message: UserMessage; resumed: boolean }) {
	const text = spokenText(message);
	const [open, setOpen] = useState(false);
	const long = text.length > BRIEF_CHARS || text.split("\n").length > BRIEF_LINES;
	return (
		<section data-sub-brief="" data-resumed={resumed || undefined} className="ly-enter mb-3 min-w-0 rounded-xl border border-line-soft bg-card/40 px-3.5 pt-1.5 pb-2.5">
			<header className="mb-1 flex h-6 items-center gap-1.5 text-caption text-ink-faint">
				<CornerRightDown size={12.5} strokeWidth={2} aria-hidden className="shrink-0" />
				<span>{translate("subAgent.brief")}</span>
			</header>
			<div
				data-sub-brief-body=""
				className={`min-w-0 text-ink-muted ${long && !open ? "max-h-[10em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" : ""}`}
			>
				<Markdown text={text} className="min-w-0 max-w-full break-words text-detail" />
			</div>
			{long && (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((was) => !was)}
					className="mt-1 text-caption text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
				>
					{open ? translate("common.collapse") : translate("subAgent.briefMore")}
				</button>
			)}
		</section>
	);
}
