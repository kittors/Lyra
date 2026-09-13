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
/*
 * 拿一份附件去做点什么——打开、指出它在哪、抄下路径。
 *
 * 和上面那一排是一套：格子上的双击、菜单里的那几行、气泡外那一排，走的都得是同一段行为，包括
 * 「先确认文件还在」这一步。两份实现的话，只在出错时才看得见的那一步迟早只剩一份有。
 */
export { useAttachmentActions } from "./attachments/actions.ts";
/* 一份附件能拿去做什么，那张单子——附件条上、句子里、气泡里，点出来的是同一份。 */
export { AttachmentMenu } from "./attachments/AttachmentMenu.tsx";
/*
 * 放进来的文件，连同它们在磁盘上的位置。
 *
 * 三个输入框（主的、侧边聊天、子智能体）都要取路径，而取的时机很挑——`pathForDrop` 必须在事件
 * 还活着的时候同步调用。各写各的话，漏掉的那一个只会表现为「菜单里全是灰的」。
 */
export { pickedFrom } from "./attachments/picked.ts";
/*
 * 一份附件在屏幕上叫什么。
 *
 * 气泡那边也要算一次：转录里存了名字的直接用，存之前发出去的那些按同一套规则现算——同样的输入
 * 得同样的结果，否则正文里那枚标记会配不上气泡外面那一格。
 */
export { displayName } from "./attachments/display.ts";
export type { PickedFile } from "./attachments/picked.ts";
