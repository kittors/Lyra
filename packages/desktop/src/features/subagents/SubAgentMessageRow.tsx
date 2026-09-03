/**
 * One row in the sub-agent transcript.
 *
 * Follows the main conversation's layout and mechanics:
 * - Markdown rendering
 * - Collapsible ToolGroup and ToolCard
 * - Tool loading, diff hunks and execution status derived from toolRuns
 * - ThinkingBlock
 */

import { memo, useMemo } from "react";
import type { Message, UserContent } from "@lyra/core";
import { openFromEvent } from "../image/index.ts";
import { runs } from "../conversation/index.ts";
import { ToolRun } from "../conversation/index.ts";
import { Markdown } from "../conversation/index.ts";
import { ThinkingBlock } from "../conversation/index.ts";
import { subAgentRuns } from "./runs.ts";

export const SubAgentTranscript = memo(function SubAgentTranscript({
	messages,
	isLive,
}: {
	messages: Message[];
	isLive?: boolean;
}) {
	const transcriptRuns = useMemo(() => runs(messages), [messages]);
	const toolRuns = useMemo(() => subAgentRuns(messages), [messages]);

	return (
		<div className="flex flex-col">
			{transcriptRuns.map((run, idx) => {
				if (run.kind === "compaction") return null;

				if (run.kind === "tools") {
					// Which run is being worked on is `grouping.ts`'s answer; whether anyone is working on
					// it at all is this panel's. The same pair as in `Conversation`.
					return <ToolRun key={`sub-run-${idx}`} calls={run.calls} live={Boolean(isLive && run.live)} runs={toolRuns} />;
				}

				const { message, upTo } = run;
				// Set only on the reply whose reasoning `grouping.ts` drew above the work; see `Run.from`.
				const from = run.from ?? 0;
				if (message.role === "user") {
					if (message.synthetic) return null;
					const text = message.content
						.filter((block): block is Extract<UserContent, { type: "text" }> => block.type === "text")
						.map((block) => block.text)
						.join("\n");
					const images = message.content.filter(
						(block): block is Extract<UserContent, { type: "image" }> => block.type === "image",
					);
					return (
						<div key={`user-${idx}`} className="ly-enter mb-3 flex justify-end">
							<div className="max-w-[88%] rounded-[13px] rounded-br-[5px] bg-card px-3 py-2 text-label leading-relaxed text-ink">
								{text && <div className="whitespace-pre-wrap">{text}</div>}
								{images.length > 0 && (
									<div className={`flex flex-wrap gap-1.5 ${text ? "mt-2" : ""}`}>
										{images.map((block, i) => (
											<button
												key={i}
												type="button"
												aria-label="预览图片"
												onClick={(event) =>
													openFromEvent(
														event,
														images.map((img) => ({ src: `data:${img.mimeType};base64,${img.data}` })),
														i,
													)
												}
												className="block overflow-hidden rounded-md border border-line bg-card shadow-xs transition-opacity duration-[var(--ly-t-quick)] hover:opacity-85"
											>
												<img
													src={`data:${block.mimeType};base64,${block.data}`}
													alt="附图"
													className="h-14 w-20 object-cover"
												/>
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					);
				}

				if (message.role === "assistant") {
					const visibleBlocks = message.content.slice(from, upTo);
					return (
						<div key={`assistant-${idx}`} className="ly-enter mb-3">
							{visibleBlocks.map((block, offset) => {
								const bIdx = from + offset;
								if (block.type === "thinking") {
									return (
										<ThinkingBlock
											key={bIdx}
											text={block.thinking}
											redacted={block.redacted === true}
											live={message.stopReason === "pending" && bIdx === message.content.length - 1}
										/>
									);
								}
								if (block.type === "text" && block.text.trim()) {
									return (
										<div key={bIdx} className="mb-2 min-w-0 max-w-full overflow-hidden">
											<Markdown text={block.text} className="min-w-0 max-w-full break-words" />
										</div>
									);
								}
								return null;
							})}
							{message.stopReason === "error" && message.errorMessage && (
								<div className="mt-2 rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail text-danger">
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
