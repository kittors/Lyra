/**
 * The two tools that act on the conversation itself rather than on the workspace.
 *
 * `spawn_session` puts a suggested conversation in front of the person — a card with a Start button
 * — and returns at once. `archive_session` files this conversation away once the turn that asked for
 * it has ended. Both need a host with conversations to offer: the desktop passes them in as
 * `extraTools`, the CLI does not and so has neither. Design and trade-offs: ADR-0039.
 */

import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";

const SPAWN_SESSION_TOOL = "spawn_session";
const ARCHIVE_SESSION_TOOL = "archive_session";

/**
 * Tools about the conversation as a whole, which a sub-agent must never be handed.
 *
 * A sub-agent is not a conversation. Its `ctx.sessionId` is `<parent>:sub:<id>`; a card it suggested
 * would be drawn nowhere, because its calls live in its own transcript rather than the parent's; and
 * an archive it asked for would file away the conversation of the person who dispatched it.
 */
export const SESSION_LEVEL_TOOLS: ReadonlySet<string> = new Set([SPAWN_SESSION_TOOL, ARCHIVE_SESSION_TOOL]);

/**
 * What a suggestion card is drawn from.
 *
 * Carried in the tool result's `details`, which the log keeps: a conversation reopened tomorrow still
 * has its card, with the prompt it would start with.
 */
export interface SessionSuggestionDetails {
	kind: "session_suggestion";
	title: string;
	summary: string;
	prompt: string;
}

export interface SessionOpsHost {
	/**
	 * File this conversation away once the current turn has ended.
	 *
	 * Asked for rather than done here: archiving through the host's ordinary path disposes the
	 * session, and disposing aborts the very turn that is still waiting for this call to return.
	 */
	archiveAfterTurn(sessionId: string, reason?: string): void;
}

/** Counted in code points, the way a person counts characters in a card title. */
const TITLE_MAX = 60;
const SUMMARY_MAX = 400;
/** A whole brief fits in this; anything longer is a transcript pasted into a prompt. */
const PROMPT_MAX = 20_000;
const REASON_MAX = 200;

interface SpawnArgs {
	title?: unknown;
	summary?: unknown;
	prompt?: unknown;
}

/** The trimmed text, or why it cannot be used — said so the model can send it again, fixed. */
function field(value: unknown, name: string, max: number): string | { error: string } {
	if (typeof value !== "string" || !value.trim()) return { error: `${name} is required and must be non-empty text.` };
	const text = value.trim();
	const length = [...text].length;
	if (length > max) return { error: `${name} is ${length} characters; keep it to ${max}.` };
	return text;
}

function spawnSession(args: SpawnArgs): ToolResult {
	const title = field(args.title, "title", TITLE_MAX);
	const summary = field(args.summary, "summary", SUMMARY_MAX);
	const prompt = field(args.prompt, "prompt", PROMPT_MAX);
	for (const checked of [title, summary, prompt]) if (typeof checked !== "string") return errorResult(checked.error);
	const details: SessionSuggestionDetails = { kind: "session_suggestion", title: title as string, summary: summary as string, prompt: prompt as string };
	return {
		content: [
			{
				type: "text",
				// The model has to hear that nothing ran: a card waiting on a click looks, from here, exactly like work in progress.
				text: `Suggested "${details.title}". Nothing has started: a card is waiting in the conversation, and the new session begins only if the person clicks Start. Carry on with the current task.`,
			},
		],
		details,
	};
}

/**
 * The tools, bound to a host.
 *
 * `spawn_session` needs nothing from it: the suggestion is the result, and starting it is the
 * person's click in the host's interface. `archive_session` only hands the host a request and ends
 * the turn; the archiving itself happens after `agent_end`, where nothing is left to abort.
 */
export function createSessionOpsTools(host: SessionOpsHost): Tool[] {
	const spawn: Tool<SpawnArgs> = {
		name: SPAWN_SESSION_TOOL,
		snippet: "Suggest a separate conversation for out-of-scope work; it starts only if the person clicks Start",
		description:
			"Suggest a new, separate conversation for something you noticed that is worth doing but would bloat the current change — dead code, stale docs, missing tests, a TODO you confirmed, a security problem spotted in passing. " +
			"Not for vague code smells, low-confidence guesses, small fixes you can make inline, or the current task itself. " +
			"Returns immediately and starts nothing: the person sees a card and decides. Keep working on the current task afterwards. " +
			"The prompt is the new conversation's first message and is all it will know: name the files and give enough context to act without this conversation.",
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", maxLength: TITLE_MAX, description: "The card's title: an imperative phrase starting with a verb, at most 60 characters." },
				summary: { type: "string", description: "One or two sentences for the card: first why you are suggesting it now, then what the new conversation will do." },
				prompt: { type: "string", description: "The new conversation's first message. Self-contained: file paths and context, no references to this conversation." },
			},
			required: ["title", "summary", "prompt"],
			additionalProperties: false,
		},
		summarize: (args) => `Suggest session ${typeof args.title === "string" ? args.title.trim() : ""}`.trim(),
		execute: async (args) => spawnSession(args),
	};
	const archive: Tool<{ reason?: unknown }> = {
		name: ARCHIVE_SESSION_TOOL,
		snippet: "Archive this conversation when the person asked for it; ends the turn",
		description:
			"Archive this conversation once the current turn ends. Use it only when the person asked for this conversation to be archived, for example \"archive it when you're done\" — never on your own initiative. " +
			"Your turn ends as soon as this returns and nothing you write after it is read, so put your final reply in the same message, before the call. " +
			"The person can restore the conversation from Settings › Archived chats.",
		parameters: {
			type: "object",
			properties: {
				reason: { type: "string", description: "Optional: what was finished, in a few words." },
			},
			additionalProperties: false,
		},
		summarize: () => "Archive session",
		async execute(args, ctx) {
			// A sub-agent never gets this tool (`SESSION_LEVEL_TOOLS`); refusing here as well keeps a
			// tool list rebuilt some other way from filing the parent away under a sub-agent's id.
			if (ctx.sessionId.includes(":sub:")) return errorResult("Only the conversation itself can archive itself; a sub-agent cannot.");
			let reason: string | undefined;
			if (args.reason !== undefined) {
				const checked = field(args.reason, "reason", REASON_MAX);
				if (typeof checked !== "string") return errorResult(checked.error);
				reason = checked;
			}
			host.archiveAfterTurn(ctx.sessionId, reason);
			return {
				content: [
					{
						type: "text",
						text: "This conversation is archived as soon as this turn ends, which is now. The person can restore it from Settings › Archived chats.",
					},
				],
				details: { kind: "session_archive", ...(reason ? { reason } : {}) },
				// Ends the turn here: the archive waits for `agent_end`, and anything said after this would be filed away unread.
				terminate: true,
			};
		},
	};
	return [spawn, archive];
}
