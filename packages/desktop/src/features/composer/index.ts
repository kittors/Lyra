/**
 * 输入框，对外的那一面。
 *
 * 别的域只能从这里拿东西，不能伸进这个目录里的文件——那条规则由 `pnpm arch` 执行。
 *
 * 这张表也是这个域的公开承诺：里面的东西改了签名，别处会跟着断；不在里面的可以随便动。
 * 它短是件好事。要往里加之前先想想，是不是那件事本来就该发生在这个域里面。
 */

export { Composer } from "./Composer.tsx";
export { ComposerSend, ComposerShell } from "./ComposerShell.tsx";
export { InputMenu } from "./InputMenu.tsx";
/* 转录里那条消息也要按门类画附件图标——同一套门类，同一个图标，不该有第二份。 */
export { fileKind, KIND_LABEL } from "./attachments/file-kind.ts";
export type { FileKind } from "./attachments/file-kind.ts";
/*
 * 「带了哪几个文件」那一排，输入框上方和气泡外面是同一个。
 *
 * 两边各画各的时候，同一份文件在输入框里是胶囊、在气泡里是行内文字，而同一张图在气泡外有缩略
 * 图、气泡里还有一遍文件名。这个导出就是那件事不许再发生的地方。
 */
export { AttachmentStrip } from "./attachments/AttachmentStrip.tsx";
export type { StripFile } from "./attachments/AttachmentStrip.tsx";
