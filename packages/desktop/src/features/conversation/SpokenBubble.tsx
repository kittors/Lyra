/**
 * 人说的一句话，画成一个气泡——侧边聊天和子智能体面板共用。
 *
 * 主会话的气泡（`UserMessage`）多着时间线上那一套：撤回、跳转、技能与引用的胶囊。这两个面板要的
 * 只是「这句话 + 它带的附件」，而它们从前各画各的：侧边聊天认得 `displayText`、会把附件画成行内
 * 标签；子智能体那边把所有文本块直接拼起来摊开——给它发一份文件，气泡里就是整篇文件正文，前面还顶
 * 着一行写给模型看的 `### Attached file: …`。
 *
 * 字怎么画由调用方给（通常是 `<Markdown/>`），理由同 `BubbleText`：`Markdown` 经 `dock/index.ts`
 * 绕回这个域，在这里直接 import 会连出一个新的环。
 */

import type { ReactNode } from "react";
import type { UserContent, UserMessage } from "@lyra/core";

import { translate } from "../../i18n/translate.ts";
import { isAttachmentBody } from "../../lib/attachment-placeholders.ts";
import { openFromEvent } from "../image/index.ts";
import { BubbleText } from "./BubbleText.tsx";

type TextBlock = Extract<UserContent, { type: "text" }>;
type ImageBlock = Extract<UserContent, { type: "image" }>;

/**
 * 人打的那些字。
 *
 * `displayText` 是发出时一并存下的那一份；升级之前发的老消息没有它，退回来把文本块拼起来——但
 * 附件正文不拼：那是写给模型的，少一枚胶囊，总好过把一整篇文件摊在气泡里。
 */
export function spokenText(message: UserMessage): string {
	return (
		message.displayText ??
		message.content
			.filter((block): block is TextBlock => block.type === "text" && !isAttachmentBody(block.text))
			.map((block) => block.text)
			.join("\n")
	);
}

export function SpokenBubble({ message, renderText, className = "" }: { message: UserMessage; renderText: (text: string) => ReactNode; className?: string }) {
	const text = spokenText(message);
	const images = message.content.filter((block): block is ImageBlock => block.type === "image");
	return (
		<div className={`ly-user-bubble max-w-[88%] rounded-2xl bg-card px-4 py-2.5 text-ink ${className}`} data-spoken-bubble="">
			{text && (
				<BubbleText
					text={text}
					files={message.attachments ?? []}
					className="text-body leading-relaxed"
					renderText={renderText}
					/*
					 * 这里的标签只认名字，不带动作：这两个面板没有能承接「打开」的地方（文件面板属于主窗口），
					 * 先认出它、画成一枚标签，不给一条点了没反应的路。
					 */
					renderFile={(file, at) => (
						<span key={at} className="ly-attachment-token" data-kind={file.kind}>
							{file.label ?? file.name}
						</span>
					)}
				/>
			)}
			{images.length > 0 && (
				<div className={`flex flex-wrap gap-1.5 ${text ? "mt-2" : ""}`}>
					{images.map((block, i) => (
						<button
							key={i}
							type="button"
							aria-label={translate("sideMessage.previewImage")}
							onClick={(event) =>
								openFromEvent(
									event,
									images.map((img) => ({ src: `data:${img.mimeType};base64,${img.data}` })),
									i,
								)
							}
							className="block overflow-hidden rounded-md border border-line bg-card shadow-xs transition-opacity duration-[var(--ly-t-quick)] hover:opacity-85"
						>
							<img src={`data:${block.mimeType};base64,${block.data}`} alt={translate("sideMessage.attachedImage")} className="h-14 w-20 object-cover" />
						</button>
					))}
				</div>
			)}
		</div>
	);
}
