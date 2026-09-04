/**
 * Running the tools a turn asked for.
 *
 * Separate from the loop because it answers a different question. The loop decides whether there is
 * another round; this decides what one round of tool use does — in parallel or in order, with
 * approval and hooks around each call, and with the guarantee that pressing stop ends the turn
 * whatever a tool is doing about it.
 */

import type { AgentEventSink } from "./events.ts";
import type { AgentEvent } from "./events.ts";
import type { AgentRunConfig } from "./loop.ts";
import { runTool } from "./tool-pipeline.ts";
import { skillRefusal } from "../skills/tool.ts";
import type {
	AssistantContent,
	Tool,
	ToolContext,
	ToolResult,
	ToolResultMessage,
	UserContent,
} from "../types.ts";

/** A tool call as it appears in an assistant message. */
type ToolCall = Extract<AssistantContent, { type: "toolCall" }>;

export async function runTools(
	toolCalls: ToolCall[],
	config: AgentRunConfig,
	state: Map<string, unknown>,
	emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
	const byName = new Map(config.tools.map((t) => [t.name, t]));
	const forceSequential = toolCalls.some((call) => byName.get(call.name)?.executionMode === "sequential");

	const execute = async (call: ToolCall): Promise<ToolResultMessage> => {
		const tool = byName.get(call.name);
		await emit({
			type: "tool_start",
			toolCallId: call.id,
			toolName: call.name,
			args: call.arguments,
			summary: tool?.summarize?.(call.arguments) ?? call.name,
		});

		const result = await executeOne(tool, call, config, state, emit);
		await emit({
			type: "tool_end",
			toolCallId: call.id,
			toolName: call.name,
			result,
			isError: result.isError === true,
		});

		const message: ToolResultMessage = {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: result.content,
			details: result.details,
			isError: result.isError === true,
			/* An error is always worth keeping, whatever else the tool said about itself. */
			uneventful: result.isError !== true && result.uneventful === true,
			timestamp: Date.now(),
		};
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		return message;
	};

	if (forceSequential) {
		const results: ToolResultMessage[] = [];
		for (const call of toolCalls) {
			results.push(await execute(call));
			if (config.signal?.aborted) break;
		}
		return results;
	}
	return Promise.all(toolCalls.map(execute));
}

/**
 * Resolves when the signal fires, and never otherwise.
 *
 * Never-resolving is the point: in a race with real work it is inert until the moment it matters,
 * and the listener is removed as soon as it does so a long turn does not accumulate one per call.
 */
function cancelled(signal: AbortSignal | undefined): Promise<ToolResult> {
	if (!signal) return new Promise<ToolResult>(() => {});
	if (signal.aborted) return Promise.resolve(errorResult("Tool execution was cancelled."));
	return new Promise<ToolResult>((resolve) => {
		signal.addEventListener("abort", () => resolve(errorResult("Tool execution was cancelled.")), { once: true });
	});
}

async function executeOne(
	tool: Tool | undefined,
	call: ToolCall,
	config: AgentRunConfig,
	state: Map<string, unknown>,
	emit: AgentEventSink,
): Promise<ToolResult> {
	if (!tool) return errorResult(`Tool "${call.name}" is not available in this session.`);

	/*
	 * A loaded skill's `allowed-tools`, enforced.
	 *
	 * Checked here rather than by filtering the tool list, because the restriction arrives in the
	 * middle of a turn — the model already has the schemas — and a tool that vanishes mid-turn is
	 * harder to explain than one that refuses with a reason.
	 */
	const refusal = skillRefusal(state, call.name);
	if (refusal) return errorResult(refusal);

	// A tool call whose JSON never parsed would silently run with no arguments.
	if (call.argumentsText && Object.keys(call.arguments).length === 0 && call.argumentsText.trim() !== "{}") {
		return errorResult(
			`Arguments for "${call.name}" were not valid JSON, so the call was not executed. Re-issue it with complete arguments.`,
		);
	}

	const ctx: ToolContext = {
		cwd: config.cwd,
		sessionId: config.sessionId,
		signal: config.signal,
		state,
		requestApproval: config.requestApproval,
		sandboxMode: config.sandboxMode,
		allowedHosts: config.allowedHosts,
		writePreview: config.writePreview,
		spawnSubAgent: config.spawnSubAgent,
		resources: config.resources,
		scratchDir: config.scratchDir,
		onProgress: (partial) => void emit({ type: "tool_update", toolCallId: call.id, partial }),
	};

	if (config.beforeToolCall) {
		try {
			const decision = await config.beforeToolCall({ toolName: call.name, args: call.arguments });
			if (decision?.block) {
				return errorResult(decision.reason || `A hook blocked "${call.name}".`);
			}
		} catch (error) {
			// A broken hook must not take the tool down with it.
			void emit({
				type: "notice",
				level: "warn",
				message: `before-tool hook failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	let result: ToolResult;
	try {
		/*
		 * Stop must not depend on the tool agreeing to stop.
		 *
		 * A tool is given the signal and is expected to honour it, but "expected to" is not a
		 * guarantee: an `executeJavaScript` against a wedged page, a socket with no timeout, a
		 * child process ignoring SIGKILL. Any one of them used to hold the turn open forever —
		 * the loop was awaiting a promise that would never settle, so pressing stop did nothing
		 * and the run could not even reach its own turn limit.
		 *
		 * Racing the signal here makes the button mean what it says. Whatever the tool is doing
		 * carries on in the background and its result is discarded; the turn is over.
		 */
		result = await Promise.race([runTool({ tool, args: call.arguments, ctx }), cancelled(config.signal)]);
	} catch (error) {
		if (config.signal?.aborted) return errorResult("Tool execution was cancelled.");
		return errorResult(error instanceof Error ? error.message : String(error));
	}

	if (config.afterToolCall) {
		try {
			const patched = await config.afterToolCall({ toolName: call.name, args: call.arguments, result });
			if (patched?.result) result = patched.result;
		} catch (error) {
			void emit({
				type: "notice",
				level: "warn",
				message: `after-tool hook failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	return result;
}

/**
 * When the model hits its output limit mid-call, streamed arguments may parse yet still be
 * missing fields. Executing them is worse than failing them, so every call in the message is
 * rejected with an explanation the model can act on.
 *
 * The same shape answers a call the model never finished saying — a stream cut off by a dropped
 * socket, or by the user stopping the turn. Nothing is executed in either case; what matters is
 * that a call which was opened gets closed. Anthropic rejects any request carrying a `tool_use`
 * with no `tool_result` after it, so one orphan does not spoil a turn, it spoils the conversation:
 * every later request fails on the same 400, including the one meant to recover the work.
 */
export async function failTruncatedCalls(
	toolCalls: ToolCall[],
	emit: AgentEventSink,
	reason = "the response hit the output token limit, so its arguments may be incomplete",
): Promise<ToolResultMessage[]> {
	const results: ToolResultMessage[] = [];
	for (const call of toolCalls) {
		const result = errorResult(`"${call.name}" was not executed: ${reason}. Re-issue the call.`);
		await emit({ type: "tool_start", toolCallId: call.id, toolName: call.name, args: call.arguments, summary: call.name });
		await emit({ type: "tool_end", toolCallId: call.id, toolName: call.name, result, isError: true });
		const message: ToolResultMessage = {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: result.content,
			isError: true,
			timestamp: Date.now(),
		};
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		results.push(message);
	}
	return results;
}

export function errorResult(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

export function textResult(text: string, details?: unknown): ToolResult {
	const content: UserContent[] = [{ type: "text", text }];
	return { content, details };
}

export type { AgentEvent };
