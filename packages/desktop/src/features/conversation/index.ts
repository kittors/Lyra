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
export { formatTokens } from "./RunningIndicator.tsx";
export { SessionStatus } from "./SessionStatus.tsx";
export { ThinkingBlock } from "./ThinkingBlock.tsx";
export { ToolCard } from "./ToolCard.tsx";
export { CodeText } from "./detail/CodeText.tsx";
export { DetailCard } from "./detail/DetailCard.tsx";
export { Section } from "./detail/Section.tsx";
export { runs } from "./grouping.ts";
export { MessageEditor } from "./message/MessageEditor.tsx";
export { ThinkingLine } from "./message/ThinkingLine.tsx";
export { ToolRun } from "./runs.tsx";
export { TrajectoryPanel } from "./trajectory/TrajectoryPanel.tsx";
export { Conversation, ConversationSkeleton } from "./Conversation.tsx";
export { EmptyState } from "./EmptyState.tsx";
