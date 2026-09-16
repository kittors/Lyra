/**
 * Reading back what compaction took out of the window.
 *
 * A summary is lossy by construction, and the loss is the point — a hundred turns cannot be carried
 * verbatim. What makes that acceptable is that the original is not gone: the session log keeps every
 * message ever committed, in full, and this searches it.
 *
 * That changes what compaction is. Without it, summarising is a decision about what the agent is
 * allowed to remember, made once, by a model with no idea what it will need later — so the honest
 * response is to keep as much as possible in the window, which is exactly the pressure that makes
 * long sessions unaffordable. With it, summarising is a cache eviction: the detail is one call away,
 * and the agent can tell when it needs to make that call. Compacting to a tenth of the window stops
 * being reckless.
 *
 * Deliberately not a general file search. `grep` over the log would work and would be terrible: the
 * matches come back as JSON, one line per record, with an entire tool result on the line that
 * matched. This answers in messages, trimmed, oldest first.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import { lyraHome, projectIdFor } from "../session/store.ts";
import type { Message, Tool, ToolResult } from "../types.ts";

/** How many matching messages to answer with when the caller does not say. */
const DEFAULT_LIMIT = 8;
/** However many are asked for. More than this is a re-read of the session, not a recall. */
const MAX_LIMIT = 20;
/**
 * How much of a matching message to quote.
 *
 * Enough to carry a full request, an error with its stack, or the head of a file. Beyond that the
 * answer starts costing more window than the summary saved, which would make recalling a thing
 * you have to be careful about — and a tool the agent is wary of is a tool it does not use.
 */
const QUOTE_CHARS = 1200;

interface RecallArgs {
	query: string;
	limit?: number;
	offset?: number;
}

export const recallTool: Tool<RecallArgs> = {
	name: "recall",
	snippet: "Search this session's earlier history",
	description:
		"Search the full transcript of this session, including messages that context compaction has since removed from view. Use it to recover the exact wording of an earlier request, a file's earlier contents, a command's exact output, or any detail a summary condensed. Matching is case-insensitive; every space-separated term must appear in the message. Images cannot be replayed — a match that carried one says so, and the only way to see it again is to ask the user to resend it.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"Terms to look for. All of them must appear in a message for it to match, so start broad — one distinctive word — and add terms only if there are too many results.",
			},
			limit: {
				type: "number",
				description: `Maximum messages to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
			},
			offset: {
				type: "number",
				description:
					"How many of the newest matches to skip, for walking backwards through a long result set. 0 (the default) is the newest page; the footer of every answer tells you the exact offset that reaches the next one.",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
	summarize: (args) => `Recall “${args.query}”`,

	async execute(args, ctx): Promise<ToolResult> {
		const terms = args.query
			.toLowerCase()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		if (terms.length === 0) return errorResult("recall needs something to search for.");

		const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)));
		const offset = Math.max(0, Math.floor(args.offset ?? 0));
		const path = join(lyraHome(), "sessions", projectIdFor(ctx.cwd), `${ctx.sessionId}.jsonl`);

		let hits: { index: number; message: Message }[];
		try {
			hits = await search(path, terms, ctx.signal);
		} catch {
			return errorResult("This session has no transcript on disk yet, so there is nothing to recall.");
		}

		if (hits.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `No message in this session contains all of: ${terms.join(", ")}.\n\nTry one distinctive term rather than a phrase — matching is literal, not semantic.`,
					},
				],
			};
		}

		/*
		 * Newest matches first, each page shown oldest-first within itself.
		 *
		 * The cap has to drop something, and the older half of a long session is the half most
		 * likely to have been summarised twice over — but reading them back in the order they
		 * happened is what makes a sequence of them legible as a sequence.
		 *
		 * `offset` counts back from the newest, so page boundaries do not move when the session
		 * grows underneath a walk through the results. It exists because the footer used to say
		 * "N older matches not shown" and offer no way to reach them: the only advice was to narrow
		 * the query, which is the opposite direction from "show me the older ones". Models filled
		 * the gap by inventing the parameter — measured: 234 calls in one session passing an
		 * `offset` this schema did not declare, every one of them silently ignored, every one
		 * returning the same page and the same footer. Declaring it costs four lines and turns that
		 * loop into a walk that terminates.
		 */
		const end = Math.max(0, hits.length - offset);
		const shown = hits.slice(Math.max(0, end - limit), end);

		if (shown.length === 0) {
			return {
				content: [
					{
						type: "text",
						text:
							`${hits.length} match${hits.length === 1 ? "" : "es"} for ${terms.join(", ")}, but offset ${offset} is past the oldest of them.\n\n` +
							`This is the start of the transcript — there is nothing older to page to. Use offset 0 for the newest matches, or search for something else.`,
					},
				],
				details: { query: args.query, matches: hits.length, shown: 0, offset },
			};
		}

		const body = shown.map((hit) => quote(hit.index, hit.message)).join("\n\n");

		/*
		 * A footer that can be acted on, rather than one that only says no.
		 *
		 * "Narrow the query to reach them" was true and useless: the model wanted to go backwards
		 * and was handed an instruction about going sideways. Naming the exact next offset — and
		 * saying plainly when there is no next page — is what makes the difference between a walk
		 * and a loop.
		 */
		const older = hits.length - offset - shown.length;
		const footer =
			older > 0
				? `\n\n[${older} older match${older === 1 ? "" : "es"} before this page. To read the next page back, call recall again with the same query and offset=${offset + shown.length}.]`
				: "\n\n[This is the oldest match for that query — there is nothing older to page to.]";

		return {
			content: [{ type: "text", text: `${hits.length} match${hits.length === 1 ? "" : "es"} in this session.\n\n${body}${footer}` }],
			details: { query: args.query, matches: hits.length, shown: shown.length, offset },
		};
	},
};

/**
 * Every message in the log whose text contains all the terms.
 *
 * Streamed line by line rather than read whole. A long session's log runs to tens of megabytes —
 * that is the entire reason this tool exists — and loading it to search it would spend more memory
 * than the context window it is trying to protect.
 */
async function search(path: string, terms: string[], signal?: AbortSignal): Promise<{ index: number; message: Message }[]> {
	const stream = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	const hits: { index: number; message: Message }[] = [];
	let index = 0;

	try {
		for await (const line of lines) {
			if (signal?.aborted) break;
			if (!line) continue;

			let record: { type?: string; message?: Message };
			try {
				record = JSON.parse(line);
			} catch {
				// A half-written final line is normal on a session that is still running.
				continue;
			}
			if (record.type !== "message" || !record.message) continue;

			const message = record.message;
			/*
			 * The position is counted before the echo check, not after.
			 *
			 * `index` is what the answer labels each match with, and a label is only useful if it
			 * means the same thing every time it is printed. Advancing it only for searchable
			 * messages would renumber the whole transcript the moment this filter changed.
			 */
			const position = index++;
			if (isOwnEcho(message)) continue;

			const text = searchableText(message).toLowerCase();
			if (terms.every((term) => text.includes(term))) hits.push({ index: position, message });
		}
	} finally {
		lines.close();
		stream.destroy();
	}
	return hits;
}

/**
 * A message this tool produced, which must never be something it can find.
 *
 * Recall writes into the log it reads. Every call appends two records — the call, carrying the
 * query, and the result, carrying whole quoted messages — and both contain the very terms that
 * were just searched for. So the hit count grows by two with every call, and `slice` from the
 * newest end returns the tool's own echo before it returns any history.
 *
 * Measured, in one session: searching for 「彻底」 returned 26 matches, then 28, then 30, then 32,
 * climbing by exactly two per call while the model paged backwards trying to outrun it. 280 calls,
 * every single one of whose answers contained its own earlier calls; 28.2M tokens, 63% of that
 * session, about an hour of wall clock. The model was not malfunctioning. It was reading a
 * transcript that grew a little longer each time it looked, which is a chase with no end.
 *
 * Excluding both halves of the pair is what makes the target stand still. Nothing is lost by it:
 * a recall result is a copy of history that is already searchable in its original place, so the
 * only thing this hides is the duplicate.
 */
function isOwnEcho(message: Message): boolean {
	if (message.role === "toolResult") return message.toolName === "recall";
	if (message.role !== "assistant") return false;
	/*
	 * An assistant turn is an echo only if recall is *all* it did.
	 *
	 * The reasoning that led to a search is the model's own and worth finding later; it is the
	 * quoted query that feeds the loop. A turn that called recall alongside real work keeps its
	 * text and its thinking — `searchableText` drops just the call.
	 */
	const blocks = message.content.filter((block) => block.type !== "thinking");
	return blocks.length > 0 && blocks.every((block) => block.type === "toolCall" && block.name === "recall");
}

/**
 * What a message offers to a search, which is not quite what it offers to a reader.
 *
 * A recall call's arguments are excluded wherever they appear. They are this tool's own words
 * quoted back — matching them tells the caller only that it once searched for the thing it is
 * searching for now, and counting them is what lets a result set outrun the reader paging through
 * it. See `isOwnEcho` for what that cost.
 */
function searchableText(message: Message): string {
	return textOf(message, { skipRecallCalls: true });
}

/** Everything in a message that a person would have read, flattened for matching and quoting. */
function textOf(message: Message, options?: { skipRecallCalls?: boolean }): string {
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") parts.push(block.text);
		else if (block.type === "thinking") parts.push(block.thinking);
		else if (block.type === "toolCall") {
			if (options?.skipRecallCalls && block.name === "recall") continue;
			parts.push(`${block.name} ${block.argumentsText ?? JSON.stringify(block.arguments ?? {})}`);
		}
	}
	return parts.join("\n");
}

/**
 * Images are findable but not replayable, and the answer has to say both.
 *
 * A screenshot is often the whole of what a request meant, and compaction drops it — the bytes are
 * far too big to carry and far too big to quote back. What the model then sees is a summary that
 * mentions a screenshot and a transcript search that cannot produce one, and with nothing saying
 * the difference it reads that as "search harder". Measured, in the same session as above: 56
 * calls hunting 「Figure 1 Figure 2」, 「Figure 1」, 「第一张图 第二张图」 — a search for something no
 * query could ever return.
 *
 * Saying it plainly, on the message that carried the image, ends that: the image is gone from the
 * window, it is not coming back through this tool, and the person who sent it is the only one who
 * can send it again.
 */
function imageNote(message: Message): string {
	const images = message.content.filter((block) => block.type === "image").length;
	if (images === 0) return "";
	return `\n[This message carried ${images} image${images === 1 ? "" : "s"}. Images cannot be replayed through recall — if you need to see ${images === 1 ? "it" : "them"} again, ask the user to resend ${images === 1 ? "it" : "them"}.]`;
}

/**
 * One match, labelled and trimmed.
 *
 * Head and tail rather than head alone: a tool result puts its answer at the top and its totals,
 * its error and its "N more matches" at the bottom, and the middle is the part nobody needs.
 */
function quote(index: number, message: Message): string {
	const when = new Date(message.timestamp).toISOString().replace("T", " ").slice(0, 16);
	const who = message.role === "toolResult" ? `tool:${message.toolName}` : message.role;
	const text = textOf(message).trim();

	const points = [...text];
	const body =
		points.length <= QUOTE_CHARS
			? text
			: `${points.slice(0, Math.floor(QUOTE_CHARS * 0.75)).join("")}\n… [${points.length - QUOTE_CHARS} characters omitted] …\n${points.slice(-Math.floor(QUOTE_CHARS * 0.25)).join("")}`;

	return `--- message ${index} · ${who} · ${when} ---\n${body}${imageNote(message)}`;
}
