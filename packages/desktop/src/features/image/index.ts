/**
 * 图片查看与标注，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 */

export { openFromEvent, openViewer } from "./viewer-store.ts";
export { ImageViewer } from "./ImageViewer.tsx";
/* 对话里的图标注完按「完成」，交给那个对话的输入框——谁的图谁来指名，分屏下不串到别的屏。 */
export { attachToComposer } from "./hand-off.ts";
