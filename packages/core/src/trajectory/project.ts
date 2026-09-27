import type { AgentEvent } from "../agent/events.ts";
import type { SessionRecord } from "../session/store.ts";
import { entriesFor, fromMessage } from "./entries.ts";
import { STATUS_LABEL, type Entry } from "./types.ts";

interface Scope {
	turn: number;
	step: number;
	request?: Entry;
	command?: Entry;
	context?: number[];
}

/** Project only the surviving prefix, so rewinding cannot leave mutations from a voided result. */
export function projectTrajectory(records: SessionRecord[], live = false): Entry[] {
	const entries: Entry[] = [];
	const scopes = new Map<string, Scope>();
	const calls = new Map<string, Entry>();
	const commands = new Map<string, Entry>();
	const agents = new Map<string, Entry>();
	const key = (id: string, parentId?: string) => `${parentId ?? ""}\0${id}`;
	const scopeFor = (parentId?: string) => {
		const id = parentId ?? "";
		let scope = scopes.get(id);
		if (!scope) { scope = { turn: 0, step: 0 }; scopes.set(id, scope); }
		return scope;
	};
	const link = (a: Entry, b: Entry) => {
		a.linkedSeqs = [...new Set([...(a.linkedSeqs ?? []), b.seq])];
		b.linkedSeqs = [...new Set([...(b.linkedSeqs ?? []), a.seq])];
	};
	function append(entry: Entry, parentId?: string): Entry {
		const scope = scopeFor(parentId);
		entry.parentId = parentId;
		entry.turn = parentId ? agents.get(parentId)?.turn : scope.turn || undefined;
		entry.step = scope.step || undefined;
		entry.id = `${parentId ?? "main"}:${entry.seq}:${entry.source}:${entries.length}`;
		entries.push(entry);
		return entry;
	}
	function finish(call: Entry, result: Entry) {
		link(call, result);
		call.status = result.status;
		call.finishedAt = result.finishedAt ?? result.ts;
		call.startedAt = result.startedAt ?? call.startedAt;
		call.durationMs = result.durationMs ?? (call.startedAt === undefined ? undefined : Math.max(0, call.finishedAt - call.startedAt));
		result.startedAt = call.startedAt;
		result.durationMs = call.durationMs;
		result.input = call.input;
		result.command = call.command;
		call.output = result.output;
		call.metadata = result.metadata;
		call.images = result.images;
	}
	function message(record: SessionRecord, items: Entry[], parentId?: string) {
		const scope = scopeFor(parentId);
		for (const item of items) {
			const entry = append(item, parentId);
			if (entry.source === "tool-call" && entry.correlationId) {
				calls.set(key(entry.correlationId, parentId), entry);
				entry.status = "running";
			} else if (entry.source === "tool-result" && entry.correlationId) {
				const call = calls.get(key(entry.correlationId, parentId));
				if (call) finish(call, entry);
			}
			if (scope.request && (entry.source === "assistant" || entry.source === "thinking" || entry.source === "tool-call")) link(scope.request, entry);
		}
		const msg = record.type === "message" ? record.message : record.type === "event" && record.event.type === "subagent_message" ? record.event.message : undefined;
		if (msg?.role === "assistant" && scope.request) {
			const request = scope.request;
			request.status = msg.stopReason === "error" ? "error" : msg.stopReason === "aborted" ? "cancelled" : "done";
			request.finishedAt = record.ts;
			request.durationMs = msg.durationMs ?? Math.max(0, record.ts - (request.startedAt ?? record.ts));
			request.decodeMs = msg.sseDurationMs;
			request.ttftMs = msg.sseDurationMs === undefined ? undefined : Math.max(0, request.durationMs - msg.sseDurationMs);
			request.usage = msg.usage;
			request.output = items.map(item => item.command ?? item.detail).filter(Boolean).join("\n\n");
			request.metadata = { ...object(request.metadata), stopReason: msg.stopReason, error: msg.errorMessage, responseId: msg.responseId };
			scope.request = undefined;
		}
	}
	function event(record: SessionRecord, data: AgentEvent, parentId?: string) {
		const { seq, ts } = record;
		const scope = scopeFor(parentId);
		const basic = (source: Entry["source"], summary: string, detail = "") => append({ seq, ts, source, summary, detail }, parentId);
		if (data.type === "subagent_event") { event(record, data.event, data.id); return; }
		if (data.type === "subagent_message") { message(record, fromMessage(seq, ts, data.message), data.id); return; }
		if (data.type === "command_status") {
			const command = data.command;
			let entry = commands.get(command.id);
			if (!entry) {
				entry = basic("compaction", command.input);
				entry.correlationId = command.id;
				entry.command = command.input;
				entry.input = command.input;
				entry.startedAt = command.timestamp;
				// Manual maintenance between turns must not look like another model step.
				entry.turn = undefined; entry.step = undefined;
				commands.set(command.id, entry);
			}
			entry.status = command.status === "failed" ? "error" : command.status;
			entry.summary = `${command.input} · ${STATUS_LABEL[entry.status]}`;
			entry.detail = entry.output ? `${command.detail}\n\n${entry.output}` : command.detail;
			entry.linkedSeqs = [...new Set([...(entry.linkedSeqs ?? []), seq])];
			if (command.status === "running") scope.command = entry;
			else {
				entry.finishedAt = ts; entry.durationMs = Math.max(0, ts - command.timestamp);
				if (scope.command === entry) scope.command = undefined;
			}
			return;
		}
		if (data.type === "compacted" && scope.command) {
			const entry = scope.command;
			entry.output = `压缩前 ${data.before} 条消息，压缩后 ${data.after} 条。\n\n${data.summary ?? ""}`;
			entry.detail = entry.output;
			entry.metadata = { before: data.before, after: data.after, kept: data.kept };
			entry.linkedSeqs = [...(entry.linkedSeqs ?? []), seq];
			return;
		}
		if (data.type === "request") {
			if (!scope.step) scope.step = 1;
			scope.request = basic("request", `${data.model} · ${data.messageCount} 条输入消息`, `供应商：${data.provider}\n模型：${data.model}\n思考等级：${data.thinking ?? "默认"}\n输入消息：${data.messageCount}`);
			Object.assign(scope.request, { status: "running", startedAt: ts, provider: data.provider, model: data.model, metadata: { thinking: data.thinking, messageCount: data.messageCount } });
			scope.request.linkedSeqs = scope.context;
			return;
		}
		if (data.type === "tool_start") {
			let call = calls.get(key(data.toolCallId, parentId));
			if (!call) {
				call = basic("tool-call", data.summary, JSON.stringify(data.args, null, 2));
				Object.assign(call, { correlationId: data.toolCallId, toolName: data.toolName, input: JSON.stringify(data.args, null, 2), command: typeof data.args.command === "string" ? data.args.command : undefined });
				calls.set(key(data.toolCallId, parentId), call);
			}
			call.startedAt = ts; call.status = "running";
			return;
		}
		// Nested tool results are committed by subagent_message; the end event only anchors timing.
		if (data.type === "tool_end") {
			const call = calls.get(key(data.toolCallId, parentId));
			if (call) { call.finishedAt = ts; call.status = data.isError ? "error" : "done"; }
			return;
		}
		if (data.type === "agent_start" || data.type === "turn_start" || data.type === "agent_end") {
			if (data.type === "turn_start") { scope.step++; return; }
			const entry = basic("lifecycle", data.type === "agent_start" ? "开始执行" : `执行结束 · ${data.reason}`, data.type === "agent_end" ? data.error ?? data.reason : data.sessionId);
			entry.status = data.type === "agent_start" ? "done" : data.reason === "aborted" ? "cancelled" : data.reason === "error" || data.reason === "stalled" || data.reason === "max_turns" ? "error" : "done";
			if (data.type === "agent_start") scope.step = 0;
			else {
				for (const pending of entries) {
					if (pending.parentId !== parentId || pending.status !== "running") continue;
					pending.status = data.reason === "aborted" ? "cancelled" : data.reason === "error" ? "error" : "interrupted";
					pending.finishedAt = ts;
					if (pending.startedAt !== undefined) pending.durationMs = Math.max(0, ts - pending.startedAt);
					if (data.error) pending.metadata = { ...object(pending.metadata), error: data.error };
				}
				scope.request = undefined;
			}
			return;
		}
		if (data.type === "retry" || data.type === "notice" || data.type === "rule_triggered") {
			const detail = data.type === "retry" ? `重试 ${data.attempt} · 等待 ${data.delayMs} ms\n${data.reason}` : data.type === "notice" ? data.message : JSON.stringify(data.rules, null, 2);
			const entry = basic("notice", detail.split("\n")[0].slice(0, 120), detail);
			entry.metadata = data;
			if (data.type === "notice" && data.level === "error") entry.status = "error";
			return;
		}
		if (data.type === "approval_request") {
			// The gate's finding travels beside `detail` now (`ApprovalRequest.risk`); the record keeps
			// it on top, where it sat when the gate still wrote it into the text.
			const entry = basic("approval", data.title, data.risk ? `${data.risk.text}\n\n${data.detail}`.trim() : data.detail);
			entry.correlationId = data.toolCallId; entry.metadata = data;
			const call = calls.get(key(data.toolCallId, parentId)); if (call) link(call, entry);
			return;
		}
		for (const item of entriesFor({ ...record, type: "event", event: data })) {
			const entry = append(item, parentId);
			if (data.type === "context") scope.context = [seq];
			if (data.type === "subagent") {
				Object.assign(entry, { parentId: data.parentId, startedAt: ts, status: "running", input: data.prompt, provider: data.provider, model: data.model });
				agents.set(data.id, entry);
			} else if (data.type === "subagent_done") {
				entry.status = data.status === "failed" ? "error" : data.status === "aborted" ? "cancelled" : "done";
				entry.output = data.answer; entry.finishedAt = ts;
				if (data.error) entry.detail += `\n\n${data.error}`;
				const start = agents.get(data.id); if (start) finish(start, entry);
			}
		}
	}
	for (const record of records) {
		if (record.type === "message") {
			if (record.message.role === "user" && !record.message.synthetic) { scopeFor().turn++; scopeFor().step = 0; }
			message(record, entriesFor(record));
		} else if (record.type === "event") event(record, record.event);
	}
	if (!live) for (const entry of entries) if (entry.status === "running") entry.status = "interrupted";
	return entries;
}

function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}
