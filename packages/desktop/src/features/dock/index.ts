/**
 * 停靠面板与它的布局，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 */

export { companionOf } from "./panels/definitions.tsx";
export { useSide } from "./sideStore.ts";
export { useDock } from "./store.ts";
export { kinds } from "./tree.ts";
export { paneVisible } from "./visibility.ts";
export { DockView } from "./DockView.tsx";
export { usePanelDefinitions } from "./panels/definitions.tsx";
export type { PanelKind } from "./sideStore.ts";
export { has } from "./tree.ts";
