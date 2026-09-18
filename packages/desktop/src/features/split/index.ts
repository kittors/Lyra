/**
 * 对话分屏，对外的那一面。
 *
 * `SplitWorkspace` 不从这里出去。它会去画 `Conversation`，而会话菜单又要调这里的
 * `splitWith`——从正门再导出工作区会把 `modals → split → conversation → composer → modals`
 * 连成环。壳（`app/`）按文件点名工作区，和设置页那几块全屏视图同一条路。
 */

export { SessionCarryGhost } from "./SessionCarryGhost.tsx";
export { useSplit } from "./store.ts";
export { offerSessionDrag, dropSessionDrag } from "./session-drag.ts";
export { openInPane, openInNewWindow, revealInWorkspace, resetSplit, splitWith, focusPane, closePane, paneAtPoint, canOfferSplit, revealSession, abandonSessionReveal, SESSION_SETTLE_MS } from "./actions.ts";
export { SCREEN_MIN_WIDTH_PX, SCREEN_MIN_HEIGHT_PX, subtreeMinPx, canSplitSide, pickSplitTarget } from "./geometry.ts";
export { MAX_PANES, leafCount, canSplit, contains, firstSession, sessionIds } from "./tree.ts";
export type { SplitNode } from "./tree.ts";
export { useSessionWindows, watchSessionWindows } from "./session-windows.ts";
