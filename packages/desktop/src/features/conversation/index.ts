/**
 * 对话，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 */

export { BackToLatest } from "./BackToLatest.tsx";
export { Markdown } from "./Markdown.tsx";
export { MessageActions } from "./MessageActions.tsx";
export { formatTokens } from "../../lib/format-tokens.ts";
export { SessionStatus } from "./SessionStatus.tsx";
export { ThinkingBlock } from "./ThinkingBlock.tsx";
export { DetailCard } from "./detail/DetailCard.tsx";
export { runs, runKey } from "./grouping.ts";
export { MessageEditor } from "./message/MessageEditor.tsx";
export { ThinkingLine } from "./message/ThinkingLine.tsx";
export { ToolRun, segments } from "./runs.tsx";
/* 人说的一句话画成气泡——侧边聊天和子智能体面板共用，见 `SpokenBubble`。 */
export { SpokenBubble, spokenText } from "./SpokenBubble.tsx";
export { TrajectoryPanel } from "./trajectory/TrajectoryPanel.tsx";
export { useDeliveryReview, useSharedDeliveryTarget } from "./delivery-review.ts";
export { TraceText } from "./detail/TraceText.tsx";
export { showTrace } from "./trajectory/navigation.ts";
export { Conversation, ConversationSkeleton } from "./Conversation.tsx";
export { EmptyState } from "./EmptyState.tsx";
