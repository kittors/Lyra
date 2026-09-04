/**
 * Run one edit task against one model with one format.
 *
 * The loop mirrors what the agent actually does: the model calls `edit`, the applier either lands
 * it or hands the error back, and the model gets another go. Three attempts, because that is
 * roughly where a real session stops being useful and the user takes over.
 *
 * The headline number is FIRST-attempt success. Anything measured over three attempts flatters a
 * format that fails in a recoverable way, and recoverable failures still cost the user a round
 * trip each.
 *
 * Outcomes are classified rather than pass/fail, because the classes mean different things:
 * `wrong-result` is a file quietly corrupted, which is far worse than `apply-failed` — the model
 * at least knows about the latter.
 */

import { streamAssistant } from "../../packages/core/src/ai/index.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig } from "../../packages/core/src/types.ts";
import type { EditCase } from "./cases.ts";
import { type EditFormat, snapshotTag } from "./formats.ts";

export type Outcome =
	| "pass"
	/** Model produced no tool call at all. */
	| "no-call"
	/** Tool call arguments did not parse or were structurally invalid. */
	| "bad-args"
	/** Applier rejected the edit — anchor not found, range out of bounds, stale tag. */
	| "apply-failed"
	/** Edit applied cleanly but produced the wrong bytes. The dangerous one. */
	| "wrong-result"
	/** Provider or harness error. */
	| "error";

export interface AttemptRecord {
	outcome: Outcome;
	detail?: string;
	outputTokens: number;
	elapsedMs: number;
	/**
	 * The arguments the model actually produced.
	 *
	 * Recorded because "the format failed" is not a finding — the finding is what the model wrote
	 * instead. Without this, a strict parser and a confused model look identical in the numbers.
	 */
	args?: Record<string, unknown>;
}

export interface CaseResult {
	caseId: string;
	scenario: EditCase["scenario"];
	formatId: string;
	modelId: string;
	/** Did the very first call produce the exact expected file? */
	firstAttemptPass: boolean;
	/** Did any of the attempts? */
	eventualPass: boolean;
	attempts: AttemptRecord[];
	totalOutputTokens: number;
	totalElapsedMs: number;
	/** Outcome of the first attempt, for failure-mode breakdown. */
	firstOutcome: Outcome;
}

const SYSTEM_PROMPT = `You are a code editing assistant. You are shown one file and asked to make one change.

- Make exactly the change requested. Change nothing else — not whitespace, not surrounding lines.
- Call the \`edit\` tool once. Do not explain, do not ask questions.
- Preserve the file's existing indentation style (this file uses tabs where you see them).`;

const MAX_ATTEMPTS = 3;

function toolCallsOf(message: AssistantMessage | undefined): { id: string; name: string; arguments: Record<string, unknown> }[] {
	const out: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
	for (const block of message?.content ?? []) {
		if (block.type !== "toolCall") continue;
		out.push({ id: block.id, name: block.name, arguments: (block.arguments ?? {}) as Record<string, unknown> });
	}
	return out;
}

async function callModel(
	provider: ProviderConfig,
	model: ModelConfig,
	messages: Message[],
	format: EditFormat,
): Promise<{ message: AssistantMessage; elapsedMs: number }> {
	const started = Date.now();
	const stream = streamAssistant(
		provider,
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages, tools: [format.spec] },
		{ maxTokens: 4096, retryAttempts: 3, temperature: 0 },
	);
	while (true) {
		const next = await stream.next();
		if (next.done) return { message: next.value, elapsedMs: Date.now() - started };
	}
}

export async function runCase(
	testCase: EditCase,
	format: EditFormat,
	provider: ProviderConfig,
	model: ModelConfig,
): Promise<CaseResult> {
	const tag = snapshotTag(testCase.before);
	const rendered = format.renderFile(testCase.path, testCase.before, tag);

	const messages: Message[] = [
		{
			role: "user",
			content: [{ type: "text", text: `${rendered}\n\n${testCase.instruction}` }],
			timestamp: Date.now(),
		},
	];

	const attempts: AttemptRecord[] = [];
	let eventualPass = false;

	for (let attempt = 0; attempt < MAX_ATTEMPTS && !eventualPass; attempt++) {
		let outcome: Outcome = "error";
		let detail: string | undefined;
		let outputTokens = 0;
		let elapsedMs = 0;
		let feedback: string | null = null;
		let seenArgs: Record<string, unknown> | undefined;

		try {
			const { message, elapsedMs: took } = await callModel(provider, model, messages, format);
			elapsedMs = took;
			outputTokens = message.usage?.output ?? 0;
			messages.push(message);

			const calls = toolCallsOf(message).filter((c) => c.name === "edit");
			if (calls.length === 0) {
				outcome = "no-call";
				detail = message.content.find((c) => c.type === "text")?.text?.slice(0, 160) ?? "(no text)";
				feedback = "You did not call the edit tool. Call it now with the change requested.";
			} else {
				const call = calls[0];
				seenArgs = call.arguments;
				const result = format.apply(call.arguments, testCase.before, tag);
				if (!result.ok) {
					// Distinguish "the arguments were not even the right shape" from "the edit was
					// well-formed but did not fit the file" — they need different fixes.
					const structural = /must be a string|is required|non-empty array|unknown op|needs numeric|no operations|unrecognised line|no preceding operation/.test(result.error ?? "");
					outcome = structural ? "bad-args" : "apply-failed";
					detail = result.error;
					feedback = `The edit failed: ${result.error}\nTry again.`;
				} else if (result.content === testCase.after) {
					outcome = "pass";
					eventualPass = true;
				} else {
					outcome = "wrong-result";
					detail = firstDifference(result.content ?? "", testCase.after);
					feedback = `The edit applied but produced the wrong result. ${detail}\nTry again.`;
				}

				messages.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: "edit",
					content: [{ type: "text", text: feedback ?? "Applied." }],
					isError: feedback !== null,
					timestamp: Date.now(),
				});
				feedback = null;
			}

			if (outcome === "no-call") {
				messages.push({ role: "user", content: [{ type: "text", text: "You did not call the edit tool. Call it now." }], timestamp: Date.now() });
			}
		} catch (error) {
			outcome = "error";
			detail = error instanceof Error ? error.message.slice(0, 200) : String(error);
		}

		attempts.push({ outcome, detail, outputTokens, elapsedMs, args: seenArgs });
	}

	return {
		caseId: testCase.id,
		scenario: testCase.scenario,
		formatId: format.id,
		modelId: model.id,
		firstAttemptPass: attempts[0]?.outcome === "pass",
		eventualPass,
		attempts,
		totalOutputTokens: attempts.reduce((sum, a) => sum + a.outputTokens, 0),
		totalElapsedMs: attempts.reduce((sum, a) => sum + a.elapsedMs, 0),
		firstOutcome: attempts[0]?.outcome ?? "error",
	};
}

/** Where the produced file first diverges, in the words a model can act on. */
function firstDifference(got: string, want: string): string {
	const g = got.split("\n");
	const w = want.split("\n");
	for (let i = 0; i < Math.max(g.length, w.length); i++) {
		if (g[i] !== w[i]) {
			return `Line ${i + 1} is ${JSON.stringify(g[i] ?? "(missing)")} but should be ${JSON.stringify(w[i] ?? "(should not exist)")}.`;
		}
	}
	return "Files differ only in trailing whitespace.";
}
