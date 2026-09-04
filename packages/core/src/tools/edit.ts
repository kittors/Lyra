/**
 * Editing a file, two ways.
 *
 * The patch form is the one to reach for: the model names the original line numbers it wants to
 * change and writes only the replacement lines. Measured against the string-replacement form on
 * this repository's own source — 270 real calls, `docs/dev-log/01-edit-format-eval.md`:
 *
 *   gemini-2.5-flash-lite   first-attempt 78% → 96%, output tokens −49%
 *   gemini-3.7-flash-high   first-attempt 96% → 100%, output tokens −74%
 *
 * The pass rate is not even the important part. Under string replacement, ten of the failures
 * were a *wrong file written successfully* — the anchor matched somewhere plausible, the tool
 * reported success, and nothing downstream knew. Under the patch form every failure was a
 * rejection the model could read and retry, because a line range can be checked against the file
 * and a byte anchor cannot. Multi-point edits are the clearest case: string replacement scored
 * 0/6 on the weak model, the patch form 6/6.
 *
 * The string form stays because sessions already in flight are full of it, and because a
 * single trivially-unique replacement is a shape it handles fine.
 */

import { readFile, writeFile } from "node:fs/promises";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";
import { computeDiff, formatDiff } from "./diff.ts";
import { applyHunks, parsePatch, PATCH_SYNTAX, PatchError, snapshotTag } from "./hunk.ts";
import { displayPath, resolveWorkspacePath } from "./paths.ts";
import { hasRead, markRead, readRecord, wasShown } from "./read.ts";

interface EditArgs {
	path: string;
	/** Patch form. */
	tag?: string;
	patch?: string;
	/** String-replacement form. */
	old_string?: string;
	new_string?: string;
	replace_all?: boolean;
}

export const editTool: Tool<EditArgs> = {
	name: "edit",
	snippet: "Edit a file by line number",
	guidelines: [
		"Edit with `tag` and `patch`: name the original line numbers and write only the replacement lines. Never retype lines you are keeping.",
		"Copy `tag` from the `[path#TAG]` header of the read output. If the file changed since you read it the edit is rejected — re-read and redo it.",
		"Put every change to one file in a single patch. Several operations in one call is normal.",
		"You may only edit lines you have actually seen. If `read` folded the region away as `⋯`, read that range first.",
	],
	description:
		"Edit a file. Preferred form: `tag` + `patch`, naming the ORIGINAL line numbers from the read output " +
		"and giving only the replacement lines.\n\n" +
		PATCH_SYNTAX +
		"\n\nLegacy form: `old_string` + `new_string` replaces an exact, unique byte sequence. " +
		"Prefer the patch form — it does not require reproducing existing bytes, it can make several " +
		"changes in one call, and it is rejected rather than misapplied when it does not fit.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path, absolute or relative to the workspace root." },
			tag: {
				type: "string",
				// No example value here on purpose. With `e.g. A1B2` in this description,
				// gemini-2.5-flash-lite copied that literal string in instead of reading the header.
				description: "Copy the 4-character tag from the `[path#TAG]` header of the read output. Do not invent it.",
			},
			patch: { type: "string", description: `Line-anchored patch. ${PATCH_SYNTAX}` },
			old_string: { type: "string", description: "Legacy form: exact text to replace." },
			new_string: { type: "string", description: "Legacy form: replacement text." },
			replace_all: { type: "boolean", description: "Legacy form: replace every occurrence instead of requiring uniqueness." },
		},
		required: ["path"],
		additionalProperties: false,
	},
	mutating: true,
	executionMode: "sequential",
	summarize: (args) => `Edit ${args.path}`,

	async execute(args, ctx): Promise<ToolResult> {
		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, args.path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		const usesPatch = typeof args.patch === "string" && args.patch.trim() !== "";
		const usesStrings = typeof args.old_string === "string" || typeof args.new_string === "string";
		if (usesPatch && usesStrings) {
			return errorResult("Use either `patch` or `old_string`/`new_string`, not both.");
		}
		if (!usesPatch && !usesStrings) {
			return errorResult("Nothing to do: supply `tag` + `patch`, or `old_string` + `new_string`.");
		}
		if (!hasRead(ctx, absolute)) {
			return errorResult(`Read ${args.path} before editing it.`);
		}

		let before: string;
		try {
			before = await readFile(absolute, "utf8");
		} catch {
			return errorResult(`File not found: ${args.path}`);
		}

		const outcome = usesPatch ? applyPatchForm(args, before, ctx, absolute) : applyStringForm(args, before, args.path);
		if ("error" in outcome) return errorResult(outcome.error);
		const { after, summary } = outcome;

		if (after === before) return errorResult("That edit would leave the file unchanged.");

		const diff = computeDiff(before, after);
		const shown = displayPath(ctx.cwd, absolute);

		if (ctx.requestApproval) {
			const decision = await ctx.requestApproval({
				kind: "edit",
				title: `Edit ${shown}`,
				detail: formatDiff(diff, shown),
				subject: absolute,
			});
			if (decision === "reject") return errorResult("The user rejected this edit.");
		}

		await writeFile(absolute, after, "utf8");
		/*
		 * Re-record against the file as it now is, so a follow-up edit in the same turn quotes the
		 * new fingerprint. Without this every second edit would be rejected as stale — by us.
		 */
		const afterLines = after.split("\n").length;
		markRead(ctx, absolute, after, 1, afterLines);

		return {
			content: [
				{
					type: "text",
					// The new tag is the one the model needs if it edits this file again this turn.
					text: `Edited ${shown}: ${summary}, +${diff.added} -${diff.removed}. New tag: ${snapshotTag(after)}`,
				},
			],
			details: {
				kind: "edit",
				path: shown,
				added: diff.added,
				removed: diff.removed,
				hunks: diff.hunks,
			},
		};
	},
};

type Outcome = { after: string; summary: string } | { error: string };

function applyPatchForm(args: EditArgs, before: string, ctx: Parameters<typeof hasRead>[0], absolute: string): Outcome {
	const actual = snapshotTag(before);
	if (typeof args.tag !== "string" || args.tag.trim() === "") {
		return { error: `\`tag\` is required. Copy it from the \`[path#TAG]\` header of the read output — this file is currently ${actual}.` };
	}
	if (args.tag.trim().toUpperCase() !== actual) {
		return {
			error:
				`The file changed since you read it (you quoted ${args.tag.trim().toUpperCase()}, it is now ${actual}). ` +
				`Re-read ${args.path} and redo the edit against the new line numbers.`,
		};
	}

	let parsed: ReturnType<typeof parsePatch>;
	try {
		parsed = parsePatch(args.patch!);
	} catch (error) {
		return { error: error instanceof PatchError ? error.message : String(error) };
	}

	/*
	 * Refuse to touch lines that were never displayed.
	 *
	 * The tag proves the file has not moved; it says nothing about whether the model has seen the
	 * region it is editing. After a paged read of lines 1-200, line 700 is a guess.
	 *
	 * Out-of-range is checked first, and deliberately: "you have not read line 9" sends the model
	 * off to read a line that does not exist, while "the file has 5 lines" ends the confusion.
	 * Both errors were true; only one is useful.
	 */
	const totalLines = before.endsWith("\n") ? before.slice(0, -1).split("\n").length : before.split("\n").length;
	for (const hunk of parsed.hunks) {
		const highest = hunk.op === "insert" ? hunk.after : hunk.end;
		if (highest > totalLines) {
			return { error: `Line ${highest} is past the end of ${args.path}: the file has ${totalLines} lines.` };
		}
	}

	const record = readRecord(ctx, absolute);
	if (record && record.ranges.length > 0) {
		for (const hunk of parsed.hunks) {
			const from = hunk.op === "insert" ? Math.max(1, hunk.after) : hunk.start;
			const to = hunk.op === "insert" ? Math.max(1, hunk.after) : hunk.end;
			if (!wasShown(record, from, to)) {
				return { error: `Lines ${from}-${to} were not in what you read. Read that part of ${args.path} before editing it.` };
			}
		}
	}

	try {
		const after = applyHunks(parsed.hunks, before);
		const ops = parsed.hunks.length;
		return { after, summary: `${ops} operation${ops === 1 ? "" : "s"}` };
	} catch (error) {
		return { error: error instanceof PatchError ? error.message : String(error) };
	}
}

function applyStringForm(args: EditArgs, before: string, path: string): Outcome {
	if (typeof args.old_string !== "string" || typeof args.new_string !== "string") {
		return { error: "`old_string` and `new_string` must both be strings." };
	}
	if (args.old_string === args.new_string) {
		return { error: "`old_string` and `new_string` are identical, so this edit would do nothing." };
	}

	const occurrences = countOccurrences(before, args.old_string);
	if (occurrences === 0) {
		return {
			error:
				`\`old_string\` was not found in ${path}. It must match exactly, including whitespace and indentation. ` +
				`Consider the \`patch\` form instead — it anchors on line numbers rather than bytes.`,
		};
	}
	if (occurrences > 1 && !args.replace_all) {
		return {
			error:
				`\`old_string\` appears ${occurrences} times in ${path}. Set replace_all: true, or use the \`patch\` form, ` +
				`which names the exact line and has no ambiguity.`,
		};
	}

	const after = args.replace_all ? before.split(args.old_string).join(args.new_string) : before.replace(args.old_string, args.new_string);
	const count = args.replace_all ? occurrences : 1;
	return { after, summary: `${count} replacement${count === 1 ? "" : "s"}` };
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle === "") return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count++;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}
