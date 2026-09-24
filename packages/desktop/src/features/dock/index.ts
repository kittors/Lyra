/**
 * 停靠面板与它的布局，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 *
 * 面板只属于会话：每一屏一个 `DockView`，布局都在 `usePaneDock` 里按会话存。窗口本身没有面板。
 */

export { companionOf } from "./panels/definitions.tsx";
export { useSide, sideChatOf } from "./sideStore.ts";
export { emptyDockTree, usePaneDock } from "./pane-store.ts";
export { DockView, startInset } from "./DockView.tsx";
export type { ScreenInsets } from "./DockView.tsx";
export { usePaneOnScreen } from "./scope-context.ts";
export {
	currentScope,
	openScopedPanel,
	provideReveal,
	provideScope,
	toggleScopedPanel,
	watchPanelWindows,
	usePanelWindows,
} from "./popout.ts";
export { renderPanel, renderPanelActions, renderPanelHeader, usePanelDefinitions } from "./panels/definitions.tsx";
export { useBoxSize } from "./useBoxSize.ts";
export type { PanelKind } from "./sideStore.ts";
export { has } from "./tree.ts";
