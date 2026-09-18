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
export { openInPane, openInNewWindow, revealInWorkspace, splitWith, paneAtPoint, canOfferSplit } from "./actions.ts";
export { subtreeMinPx } from "./geometry.ts";
export { leafCount, canSplit, contains, firstSession } from "./tree.ts";
export { useSessionWindows, watchSessionWindows } from "./session-windows.ts";
