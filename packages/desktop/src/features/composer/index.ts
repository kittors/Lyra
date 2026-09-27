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
export { KIND_LABEL, sentKind } from "./attachments/file-kind.ts";
export type { FileKind } from "./attachments/file-kind.ts";
/* 发出去的附件给不给「预览」：右边的文件面板打开它，看得到的是不是它本身。 */
export { previewableInPanel } from "./attachments/display.ts";
/*
 * 「带了哪几个文件」那一排，输入框上方和气泡外面是同一个。
 *
 * 两边各画各的时候，同一份文件在输入框里是胶囊、在气泡里是行内文字，而同一张图在气泡外有缩略
 * 图、气泡里还有一遍文件名。这个导出就是那件事不许再发生的地方。
 */
export { AttachmentStrip } from "./attachments/AttachmentStrip.tsx";
export type { StripFile } from "./attachments/AttachmentStrip.tsx";
/* 一份附件能拿去做什么，那张单子——附件条上、句子里、气泡里，点出来的是同一份。 */
export { AttachmentMenu } from "./attachments/AttachmentMenu.tsx";
/* 拿一份附件去做点什么：打开、预览、外部应用、定位。 */
export { useAttachmentActions } from "./attachments/actions.ts";
/*
 * 一份附件在屏幕上叫什么。
 *
 * 气泡那边也要算一次：转录里存了名字的直接用，存之前发出去的那些按同一套规则现算——同样的输入
 * 得同样的结果，否则正文里那枚标记会配不上气泡外面那一格。
 */
export { displayName } from "./attachments/display.ts";
/*
 * 把草稿摊成内容块的那一步，和给人看的那一份。三个输入框（主的、侧边聊天、子智能体）共用——句子里
 * 那枚标记的一生在 `useComposerAttachments` 里面，见下。
 */
export { attachmentMeta, spellDraft, type OutgoingMeta } from "./outgoing.ts";
/*
 * 一个输入框收下附件之后的那一整套，和它还没发出去的那份草稿。
 *
 * 主输入框、侧边聊天、子智能体三个框共用。从前另外两个各抄了一份最早的样子：所有文件都摆成卡片
 * 挤在上面、PDF 读成乱码、右键标记什么都没有、面板一关草稿就没了。
 */
export { useComposerAttachments } from "./useComposerAttachments.tsx";
export { useDraft } from "./useDraft.ts";
export type { DraftAttachment } from "./attachments/read.ts";
/* 方向键往回翻自己说过的话——三个框同一套手感。 */
export { useInputHistory } from "./useInputHistory.ts";
/*
 * 忙的时候说出口的话排在哪儿、长什么样。主会话和侧边聊天是两条队、同一条条——见 `QueueSource`。
 */
export { QueueList } from "./QueuedMessages.tsx";
export { queuePreview, queueThumbnail } from "./outgoing.ts";
