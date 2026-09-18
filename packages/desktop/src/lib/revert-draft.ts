import type { Message, UserContent, UserMessage } from "@lyra/core";
import { isAttachmentBody } from "./attachment-placeholders.ts";

export type RestoredAttachment = {
	id: string;
	name: string;
	mimeType: string;
	kind?: string;
	data?: string;
	text?: string;
	isText: boolean;
	path?: string;
	label?: string;
};

export type RestoredDraft = {
	text: string;
	attachments: RestoredAttachment[];
	sessionRefs: Array<{ id: string; title: string }>;
};

type ImageBlock = Extract<UserContent, { type: "image" }>;
type TextBlock = Extract<UserContent, { type: "text" }>;

/** Last real user turn, ignoring the synthetic 「继续」 notes that never appear as a bubble. */
export function lastUserMessageIndex(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "user" && !message.synthetic) return i;
	}
	return -1;
}

function bodyText(block: string): string | undefined {
	return block.match(/```\n([\s\S]*?)\n```/)?.[1];
}

/**
 * What the composer should hold after this user message is taken back.
 *
 * Images come from the content blocks (pixels live there). Paths and labels come from
 * `attachments`. Typed words prefer `displayText` so a file body does not land in the field.
 */
export function draftFromUserMessage(message: UserMessage): RestoredDraft {
	const images = message.content.filter((block): block is ImageBlock => block.type === "image");
	const bodies = message.content.filter((block): block is TextBlock => block.type === "text" && isAttachmentBody(block.text));
	const spoken = message.content
		.filter((block): block is TextBlock => block.type === "text" && !isAttachmentBody(block.text))
		.map((block) => block.text)
		.join("\n");
	let imageAt = 0;
	let bodyAt = 0;
	const attachments: RestoredAttachment[] = [];
	for (const [index, file] of (message.attachments ?? []).entries()) {
		const kind = file.kind;
		const isImage = kind === "image" || Boolean(file.mimeType?.startsWith("image/"));
		const isText = kind === "text";
		const image = isImage ? images[imageAt++] : undefined;
		const body = isText ? bodies[bodyAt++] : undefined;
		attachments.push({
			id: `revert-${index}-${file.name}`,
			name: file.name,
			mimeType: file.mimeType ?? image?.mimeType ?? "application/octet-stream",
			isText: Boolean(isText),
			...(kind ? { kind } : {}),
			...(image ? { data: image.data } : {}),
			...(body ? { text: bodyText(body.text) } : {}),
			...(file.path ? { path: file.path } : {}),
			...(file.label ? { label: file.label } : {}),
		});
	}
	for (; imageAt < images.length; imageAt++) {
		attachments.push({
			id: `revert-image-${imageAt}`,
			name: "",
			mimeType: images[imageAt].mimeType,
			kind: "image",
			data: images[imageAt].data,
			isText: false,
		});
	}
	return {
		text: message.displayText ?? spoken,
		attachments,
		sessionRefs: message.sessionRefs ?? [],
	};
}
