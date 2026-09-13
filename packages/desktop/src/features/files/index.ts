/**
 * 文件树与查看器，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 */

export { FileActions } from "./FileActions.tsx";
export { FileBrowser } from "./FileBrowser.tsx";
export { FilePanel } from "./FilePanel.tsx";
export { FileTitle } from "./FileTitle.tsx";
export { PreviewCard } from "./PreviewCard.tsx";
export type { PreviewInfo } from "./PreviewCard.tsx";
export { iconColour, lookFor } from "./fileIcon.tsx";
/*
 * 「用什么打开」搬去了 `store/open-targets.ts`。
 *
 * 它从来不是这个域的私产——文件树只是第一个用户。留在这里的话，别的域要用就得走这扇门，而门
 * 后面挂着查看器和转录；附件条正是这样绕出一个环来的。这里不再转出，引它的人直接从 store 拿。
 */
