import type { AssistantContent, Message, UserContent } from "@lyra/core";

/**
 * How much of one block the window is allowed to hold.
 *
 * The session log keeps the original. This is only the copy that crosses IPC and
 * becomes React props. A 25 MB grep dump or a 12 MB text block freezes the renderer
 * during structured clone and first layout; 24k characters is enough to read and
 * to know the rest is in the log.
 */
export const DISPLAY_TEXT_CHARS = 24_000;

export function slimSnapshot<T extends { messages: Message[] }>(snapshot: T): T {
	const messages = slimMessagesForDisplay(snapshot.messages);
	return messages === snapshot.messages ? snapshot : { ...snapshot, messages };
}

export function slimMessagesForDisplay(messages: Message[]): Message[] {
	let changed = false;
	const next = messages.map((message) => {
		const slimmed = slimMessage(message);
		if (slimmed !== message) changed = true;
		return slimmed;
	});
	return changed ? next : messages;
}

function slimMessage(message: Message): Message {
	if (message.role === "toolResult") {
		const content = slimUserContent(message.content);
		const details = slimDetails(message.details);
		if (content === message.content && details === message.details) return message;
		return { ...message, content, ...(details === message.details ? {} : { details }) };
	}
	if (message.role === "assistant") {
		const content = slimAssistantContent(message.content);
		return content === message.content ? message : { ...message, content };
	}
	if (message.role === "user") {
		const content = slimUserContent(message.content);
		return content === message.content ? message : { ...message, content };
	}
	return message;
}

function slimUserContent(content: UserContent[]): UserContent[] {
	let changed = false;
	const next = content.map((part) => {
		if (part.type !== "text") return part;
		const text = slimText(part.text);
		if (text === null) return part;
		changed = true;
		return { ...part, text };
	});
	return changed ? next : content;
}

function slimAssistantContent(content: AssistantContent[]): AssistantContent[] {
	let changed = false;
	const next = content.map((part) => {
		if (part.type === "text") {
			const text = slimText(part.text);
			if (text === null) return part;
			changed = true;
			return { ...part, text };
		}
		if (part.type === "thinking") {
			const thinking = slimText(part.thinking);
			if (thinking === null) return part;
			changed = true;
			return { ...part, thinking };
		}
		return part;
	});
	return changed ? next : content;
}

function slimDetails(details: unknown): unknown {
	if (typeof details !== "string") return details;
	return slimText(details) ?? details;
}

function slimText(text: string): string | null {
	const points = [...text];
	if (points.length <= DISPLAY_TEXT_CHARS) return null;
	const keep = Math.floor(DISPLAY_TEXT_CHARS / 2);
	const omitted = points.length - keep * 2;
	return (
		`${points.slice(0, keep).join("")}\n\n` +
		`… [${omitted.toLocaleString("en-US")} characters omitted for display; the full result stays in the session log.] …\n\n` +
		points.slice(points.length - keep).join("")
	);
}
