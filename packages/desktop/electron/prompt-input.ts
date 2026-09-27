import type { UserContent } from "@lyra/core";
import { noteAttachmentPath } from "./attachment-reads.ts";
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

/**
 * 这份输入是谁递进来的。
 *
 * 只有 `attachments[].path` 在乎这件事，而它在乎得厉害：那个字段进了会话之后会被
 * `runtime/session-turn.ts` 的 `collectAllowedPaths` 收成一份「这一轮可以读的工作区外文件」，也就是
 * 说，**它是一张写在消息里的通行证**。本机递进来的是用户自己在输入框里拖的文件，那正是它的用途；
 * 远端递进来的是一串可以随便编的字符串。
 *
 * 手机那一侧本来是关着的：`files.write/bytes/document` 在契约里刻意标了 `remote: false`，
 * `phoneProjectPath` 还用 realpath 把它锁在已打开的项目里。附件的 `path` 是从侧门绕过那道锁的一条
 * 路——同一个形状在 `sync.ts` 里已经犯过一次（手机可在任意目录建会话，等价拿回被白名单挡掉的
 * terminal 能力），那次的注释还在。
 */
type PromptOrigin = "local" | "remote";

/**
 * A finished phone upload's path on this desktop, by the id the phone was given; see `sync-uploads.ts`.
 *
 * The one way a remote attachment gets a `path`: the phone names an upload, never a location, and the
 * location is the one this desktop wrote the file to.
 */
export type UploadResolver = (idOrPath: string) => string | null;

function presentation(
	value: Record<string, unknown>,
	origin: PromptOrigin = "local",
	uploads?: UploadResolver,
): Pick<InitialPrompt, "displayText" | "skillRef" | "sessionRefs" | "attachments"> {
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
			// A remote path is discarded below whatever its type, so only a local one has to be well-formed.
			if (origin === "local" && file.path !== undefined && typeof file.path !== "string") throw new Error("Invalid attachment path");
			if (file.label !== undefined && typeof file.label !== "string") throw new Error("Invalid attachment label");
			/*
			 * A remote attachment gets a path only from the upload store: by the id a phone was given,
			 * or — when a sent message is edited — by the path the store gave out, and only if it is one.
			 */
			const uploaded = origin !== "remote"
				? undefined
				: file.upload !== undefined
					? uploadedPath(file.upload, uploads)
					: typeof file.path === "string"
						? (uploads?.(file.path) ?? undefined)
						: undefined;
			return {
				name: file.name,
				...(file.kind === undefined ? {} : { kind: file.kind }),
				...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
				// 远端给的 `path` 丢掉，理由见 `PromptOrigin`。丢掉只损失气泡上的右键菜单，留着是放行任意文件。
				...(file.path === undefined || origin === "remote" || typeof file.path !== "string" ? {} : { path: file.path }),
				...(uploaded ? { path: uploaded } : {}),
				...(file.label === undefined ? {} : { label: file.label }),
			};
		});
		/*
		 * 本机递进来的附件，右边的文件面板也认——见 `attachment-reads.ts`。
		 *
		 * 记在这道门上，因为「这个路径算不算数」就是在这里定的：远端的上面已经丢了，留下来的正是 core
		 * 那边会当成「这一轮可以读」的那一份。等转录下一次交给窗口时再记就晚了——刚发出去的那条消息，
		 * 点「预览」只会得到一句「无法读取」。整批都过了校验才记，被拒掉的那一次什么都不留。
		 */
		if (origin === "local") for (const file of result.attachments) noteAttachmentPath(file.path);
	}
	return result;
}

/**
 * The upload an attachment names, as a path — or a refusal the phone can show.
 *
 * Refused rather than dropped: a message that says "see the attached log" and arrives without it
 * would have the agent answer about a file it was never given.
 */
function uploadedPath(id: unknown, uploads: UploadResolver | undefined): string {
	const path = typeof id === "string" && uploads ? uploads(id) : null;
	if (!path) throw new Error("upload-missing: the attached file has not finished uploading, or has expired");
	return path;
}

export function initialPrompt(value: unknown, origin: PromptOrigin = "local", uploads?: UploadResolver): InitialPrompt | undefined {
	if (value === undefined) return undefined;
	if (!object(value)) throw new Error("initial must be an object");
	if (value.synthetic !== undefined && typeof value.synthetic !== "boolean") throw new Error("synthetic must be boolean");
	return {
		content: promptContent(value.content),
		...(value.synthetic === undefined ? {} : { synthetic: value.synthetic }),
		...presentation(value, origin, uploads),
	};
}

export function promptOptions(
	value: unknown,
	origin: PromptOrigin = "local",
	uploads?: UploadResolver,
): Omit<InitialPrompt, "content"> & {
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
		...presentation(value, origin, uploads),
	};
}

/**
 * 操控框里那句话给人看的那一份：人打的字和附件的名字门类。
 *
 * 和主会话的消息过同一道门（`presentation`）——附件的 `path` 是写在消息里的通行证，这道白名单
 * 不能因为换了个入口就少过一遍。只收本机递进来的：手机那一侧发的仍然是一段字，不带这一项。
 */
export function steerDisplay(value: unknown): { displayText?: string; attachments?: NonNullable<InitialPrompt["attachments"]> } | undefined {
	if (value === undefined || value === null) return undefined;
	if (!object(value)) throw new Error("display must be an object");
	const { displayText, attachments } = presentation(value, "local");
	return { ...(displayText === undefined ? {} : { displayText }), ...(attachments?.length ? { attachments } : {}) };
}
