/**
 * 把一条已经发出去的消息，还原成输入框里那袋附件。
 *
 * 给「方向键往回翻」用：翻出来的只有字而没有图，人看到的是一条和当初不一样的消息——他当初发的是
 * 「这张图里有什么」加一张图，翻回来却只剩那句话，再按一次发送，模型收到的是一个没有指代对象的
 * 问题。附件跟着回来，翻历史才是「把当初那条拿回来」而不是「把当初那句话拿回来」。
 *
 * 还原走的是 `outgoing.ts` 打包时的逆路，所以两边必须对着看：
 *
 *   - 文本附件  → 一个 `attachmentBody` 块（`### 标题: 名字` 加一段 ``` 围栏）
 *   - 图片      → 一行 `attachmentImageLabel` 加一个 `image` 块
 *   - 读不出来的 → 一个 `attachmentStub` 块（`[… — contents not included]`）
 *
 * **不靠 `isAttachmentBody` 挨个认块**：那个判断对图片前面那行标签也返回 true（两者都是
 * `\n\n### 标题: 名字`），按它顺序配对会把图片的标签行当成某份文档的正文，错位从第一个图文混排
 * 的消息开始。权威清单是 `message.attachments`——它就是发送那一刻的 `draft.attachments`，顺序、
 * 名字、门类都在里面；content 只用来取「数据」这一样东西。
 */

import type { Message, UserContent } from "@lyra/core";

import type { FileKind } from "./file-kind.ts";

/** 输入框里一份附件的形状，和 `Composer` 里的 `Attachment` 对得上。 */
export interface RestoredAttachment {
	id: string;
	name: string;
	mimeType: string;
	kind?: FileKind;
	data?: string;
	text?: string;
	isText: boolean;
}

/**
 * 把 `attachmentBody` 包过的正文剥回来。
 *
 * 贪婪匹配到最后一对 ``` ——正文里本来就可能有代码块，而打包时没有转义它们。取最外面那一对是
 * 唯一能把内层围栏原样带回来的读法。
 */
function unwrap(text: string): string | undefined {
	const match = text.match(/\n```\n([\s\S]*)\n```\n*$/);
	return match ? match[1] : undefined;
}

export function attachmentsFrom(message: Message): RestoredAttachment[] {
	if (message.role !== "user") return [];
	const metas = message.attachments ?? [];
	if (metas.length === 0) return [];

	const images = message.content.filter(
		(block): block is Extract<UserContent, { type: "image" }> => block.type === "image",
	);
	/*
	 * 只认真正装着正文的那种块——带 ``` 围栏的。
	 *
	 * 图片的标签行和 stub 都不带围栏，于是都不会混进这个队列里，图文混排时两边各数各的也就不会
	 * 错位。取不到正文的那一份还原成「只有名字」，而那正是它当初发出去的样子。
	 */
	const bodies = message.content.filter(
		(block): block is Extract<UserContent, { type: "text" }> =>
			block.type === "text" && block.text.includes("\n```\n"),
	);

	let imageAt = 0;
	let bodyAt = 0;
	return metas.map((meta) => {
		const mimeType = meta.mimeType ?? "";
		const id = crypto.randomUUID();
		const kind = meta.kind as FileKind | undefined;
		if (mimeType.startsWith("image/") || meta.kind === "image") {
			const block = images[imageAt++];
			return { id, name: meta.name, mimeType: mimeType || block?.mimeType || "image/png", kind, data: block?.data, isText: false };
		}
		const text = bodies[bodyAt++] ? unwrap(bodies[bodyAt - 1]!.text) : undefined;
		return {
			id,
			name: meta.name,
			mimeType: mimeType || "application/octet-stream",
			kind,
			...(text !== undefined ? { text } : {}),
			isText: text !== undefined,
		};
	});
}
