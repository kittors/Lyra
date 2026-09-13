import type { UserContent } from "@lyra/core";
import type { InitialPrompt } from "./create-session.ts";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function promptContent(value: unknown): UserContent[] {
	// The remote contract also accepts plain text from older paired clients.
	if (typeof value === "string" && value.trim()) return [{ type: "text", text: value }];
	if (!Array.isArray(value) || value.length === 0) throw new Error("content must be a non-empty array");
	return value.map((block: unknown) => {
		if (!object(block)) throw new Error("Invalid content block");
		if (block.type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
		if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
			return { type: "image", data: block.data, mimeType: block.mimeType };
		}
		throw new Error("Invalid user content block");
	});
}

function presentation(value: Record<string, unknown>): Pick<InitialPrompt, "displayText" | "skillRef" | "sessionRefs" | "attachments"> {
	const result: Pick<InitialPrompt, "displayText" | "skillRef" | "sessionRefs" | "attachments"> = {};
	if (value.displayText !== undefined) {
		if (typeof value.displayText !== "string") throw new Error("displayText must be a string");
		result.displayText = value.displayText;
	}
	if (value.skillRef !== undefined) {
		const skill = value.skillRef;
		if (!object(skill) || typeof skill.name !== "string" || !skill.name.trim()) throw new Error("Invalid skill reference");
		if (skill.path !== undefined && typeof skill.path !== "string") throw new Error("Invalid skill path");
		if (skill.pluginId !== undefined && typeof skill.pluginId !== "string") throw new Error("Invalid skill plugin");
		result.skillRef = { name: skill.name, ...(skill.path === undefined ? {} : { path: skill.path }), ...(skill.pluginId === undefined ? {} : { pluginId: skill.pluginId }) };
	}
	if (value.sessionRefs !== undefined) {
		if (!Array.isArray(value.sessionRefs)) throw new Error("sessionRefs must be an array");
		result.sessionRefs = value.sessionRefs.map((ref: unknown) => {
			if (!object(ref) || typeof ref.id !== "string" || !ref.id.trim() || typeof ref.title !== "string") throw new Error("Invalid session reference");
			return { id: ref.id, title: ref.title };
		});
	}
	if (value.attachments !== undefined) {
		if (!Array.isArray(value.attachments)) throw new Error("attachments must be an array");
		/*
		 * 这里过的是「它是什么」，不是「它装了什么」。
		 *
		 * 字节走 `content`，这一项一个字节都不许带——一份上千行的文档正文要是从这儿混进去，每条消息
		 * 都会把它再存一遍，转录一轮大一倍。那条规矩不变。
		 *
		 * 但 `path` 和 `label` 不是字节，它们是这份附件的身份，而这道门一度把它们一起丢了：
		 * `MessageAttachment` 定义了这两个字段、发送那头填好了、气泡那头读它——中间这一道白名单把它们
		 * 抹掉，于是一条已经发出去的消息对着自己带的那份表格，右键点上去什么都做不了（菜单空到不弹）。
		 * 界面、类型、发送端三处都是对的，只有这一行不知道它们存在。
		 */
		result.attachments = value.attachments.map((file: unknown) => {
			if (!object(file) || typeof file.name !== "string" || !file.name.trim()) throw new Error("Invalid attachment");
			if (file.kind !== undefined && typeof file.kind !== "string") throw new Error("Invalid attachment kind");
			if (file.mimeType !== undefined && typeof file.mimeType !== "string") throw new Error("Invalid attachment type");
			if (file.path !== undefined && typeof file.path !== "string") throw new Error("Invalid attachment path");
			if (file.label !== undefined && typeof file.label !== "string") throw new Error("Invalid attachment label");
			return {
				name: file.name,
				...(file.kind === undefined ? {} : { kind: file.kind }),
				...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
				...(file.path === undefined ? {} : { path: file.path }),
				...(file.label === undefined ? {} : { label: file.label }),
			};
		});
	}
	return result;
}

export function initialPrompt(value: unknown): InitialPrompt | undefined {
	if (value === undefined) return undefined;
	if (!object(value)) throw new Error("initial must be an object");
	if (value.synthetic !== undefined && typeof value.synthetic !== "boolean") throw new Error("synthetic must be boolean");
	return { content: promptContent(value.content), ...(value.synthetic === undefined ? {} : { synthetic: value.synthetic }), ...presentation(value) };
}

export function promptOptions(value: unknown): Omit<InitialPrompt, "content"> & {
	deliver?: "steer" | "followUp";
	resumePending?: boolean;
} {
	if (value === undefined || value === null) return {};
	if (!object(value)) throw new Error("options must be an object");
	const { synthetic, deliver, resumePending } = value;
	if (synthetic !== undefined && typeof synthetic !== "boolean") throw new Error("synthetic must be boolean");
	if (resumePending !== undefined && typeof resumePending !== "boolean") throw new Error("resumePending must be boolean");
	if (deliver !== undefined && deliver !== "steer" && deliver !== "followUp") throw new Error("Invalid delivery mode");
	return {
		...(synthetic === undefined ? {} : { synthetic }),
		...(deliver === undefined ? {} : { deliver }),
		...(resumePending === undefined ? {} : { resumePending }),
		...presentation(value),
	};
}
