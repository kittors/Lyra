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
		// Name and kind only. The bytes travel in `content`; nothing here is allowed to carry them.
		result.attachments = value.attachments.map((file: unknown) => {
			if (!object(file) || typeof file.name !== "string" || !file.name.trim()) throw new Error("Invalid attachment");
			if (file.kind !== undefined && typeof file.kind !== "string") throw new Error("Invalid attachment kind");
			if (file.mimeType !== undefined && typeof file.mimeType !== "string") throw new Error("Invalid attachment type");
			return {
				name: file.name,
				...(file.kind === undefined ? {} : { kind: file.kind }),
				...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
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
