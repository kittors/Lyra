import type { AgentEvent } from "../agent/events.ts";
import type { SessionRecord } from "../session/store.ts";
import type { Message } from "../types.ts";
import type { Entry } from "./types.ts";

/** One record, as the one or more things it actually records. */
export function entriesFor(record: SessionRecord): Entry[] {
	if (record.type === "message") return fromMessage(record.seq, record.ts, record.message);
	if (record.type === "event") return fromEvent(record.seq, record.ts, record.event);
	return [];
}

export function fromMessage(seq: number, ts: number, message: Message): Entry[] {
	if (message.role === "user") {
		const text = textOf(message.content);
		const images = message.content.filter(part => part.type === "image");
		return [{ seq, ts, source: "user", summary: firstLine(text) || `图片 ${images.length} 张`, detail: text, input: text, images }];
	}

	if (message.role === "toolResult") {
		const text = textOf(message.content);
		return [
			{
				seq,
				ts,
				source: "tool-result",
				summary: firstLine(text) || "(无输出)",
				detail: text,
				correlationId: message.toolCallId,
				toolName: message.toolName,
				output: text,
				status: message.details && typeof message.details === "object" && "cancelled" in message.details && message.details.cancelled === true ? "cancelled" : message.isError ? "error" : "done",
				startedAt: message.startedAt,
				finishedAt: message.timestamp,
				durationMs: message.durationMs,
				metadata: message.details,
				images: message.content.filter(part => part.type === "image"),
			},
		];
	}

	if (message.role !== "assistant") return [];

	/*
	 * An assistant message is up to three different things at once.
	 *
	 * Splitting them is the whole point of a by-source view: "show me only the reasoning" cannot
	 * work while reasoning is a field on an entry that is labelled as a reply.
	 */
	const out: Entry[] = [];
	for (const part of message.content) {
		if (part.type === "thinking" && part.thinking.trim()) {
			out.push({ seq, ts, source: "thinking", summary: firstLine(part.thinking), detail: part.thinking });
		}
		if (part.type === "text" && part.text.trim()) {
			out.push({ seq, ts, source: "assistant", summary: firstLine(part.text), detail: part.text });
		}
		if (part.type === "toolCall") {
			const command = typeof part.arguments.command === "string" ? part.arguments.command : undefined;
			const rest = { ...part.arguments };
			delete rest.command;
			out.push({
				seq,
				ts,
				source: "tool-call",
				summary: `${part.name} ${firstLine(command ?? compact(part.arguments))}`.trim(),
				detail: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "",
				correlationId: part.id,
				toolName: part.name,
				input: JSON.stringify(part.arguments, null, 2),
				command,
			});
		}
	}
	const primary = out.find(entry => entry.source === "assistant") ?? out.find(entry => entry.source === "thinking") ?? out[0];
	if (primary) Object.assign(primary, {
		usage: message.usage, provider: message.provider, model: message.model,
	});
	// Older logs may contain only tool calls; their model usage survives without giving the
	// tool the model's latency or completion status before the tool has actually executed.
	if (primary && primary.source !== "tool-call") Object.assign(primary, {
		startedAt: message.timestamp, durationMs: message.durationMs,
		finishedAt: message.durationMs === undefined ? undefined : message.timestamp + message.durationMs,
		decodeMs: message.sseDurationMs,
		ttftMs: message.durationMs !== undefined && message.sseDurationMs !== undefined ? Math.max(0, message.durationMs - message.sseDurationMs) : undefined,
		status: message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "cancelled" : "done",
		metadata: { stopReason: message.stopReason, error: message.errorMessage, responseId: message.responseId },
	});
	return out;
}

function fromEvent(seq: number, ts: number, event: AgentEvent): Entry[] {
	if (event.type === "context") {
		return [
			{
				seq,
				ts,
				source: "system",
				summary: `系统提示词 ${event.systemPrompt.length} 字`,
				detail: event.systemPrompt,
			},
			{
				seq,
				ts,
				source: "context",
				summary: `工具 ${event.tools.length} 个、技能 ${event.skills.length} 个`,
				detail: `工具：\n${event.tools.join("\n")}\n\n技能：\n${event.skills.join("\n") || "（无）"}`,
				metadata: event.schemas,
			},
		];
	}

	if (event.type === "subagent") {
		return [
			{
				seq,
				ts,
				source: "subagent",
				summary: `${event.resumed ? "续跑" : "派发"} ${event.agent}：${event.description}`,
				detail: `agent: ${event.agent}\n工具: ${event.tools.join(", ")}\n\n${event.prompt}`,
				correlationId: event.id,
			},
		];
	}

	if (event.type === "subagent_done") {
		return [
			{
				seq,
				ts,
				source: "subagent",
				summary: `子 Agent 回报（${event.steps.length} 步）`,
				detail: `步骤：\n${event.steps.join("\n")}\n\n回答：\n${event.answer}`,
				correlationId: event.id,
			},
		];
	}

	if (event.type === "compacted") {
		return [
			{
				seq,
				ts,
				source: "compaction",
				summary: `历史压缩：${event.before} → ${event.after} 条`,
				detail: `压缩前 ${event.before} 条消息，压缩后 ${event.after} 条。${event.summary ? `\n\n${event.summary}` : ""}`,
				metadata: { before: event.before, after: event.after, kept: event.kept },
				status: "done",
			},
		];
	}

	return [];
}

function textOf(content: { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n")
		.trim();
}

function firstLine(text: string): string {
	const line = text.split("\n").find((candidate) => candidate.trim());
	return (line ?? "").trim().slice(0, 120);
}

/** Arguments on one line, for the summary. */
function compact(args: Record<string, unknown>): string {
	const parts = Object.entries(args).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`);
	return parts.join(" ").slice(0, 100);
}
