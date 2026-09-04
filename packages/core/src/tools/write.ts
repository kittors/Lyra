import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";
import { computeDiff, formatDiff } from "./diff.ts";
import { displayPath, exists, resolveWorkspacePath } from "./paths.ts";
import { hasRead, markRead } from "./read.ts";

interface WriteArgs {
	path: string;
	content: string;
}

export const writeTool: Tool<WriteArgs> = {
	name: "write",
	snippet: "Create or overwrite whole files",
	guidelines: [
		"Prefer edit over write for changes to an existing file; write replaces the entire contents.",
		"Never create documentation, README or example files unless the user asked for them.",
	],
	description:
		"Write a file, creating parent directories as needed. Overwrites the whole file. " +
		"To modify part of an existing file, prefer `edit` — it is safer and cheaper. " +
		"You must `read` an existing file before overwriting it.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path, absolute or relative to the workspace root." },
			content: { type: "string", description: "Complete file contents." },
		},
		required: ["path", "content"],
		additionalProperties: false,
	},
	mutating: true,
	executionMode: "sequential",
	summarize: (args) => `Write ${args.path}`,

	async execute(args, ctx): Promise<ToolResult> {
		if (typeof args.content !== "string") return errorResult("`content` must be a string.");

		/*
		 * Writable addresses, of which there is exactly one.
		 *
		 * The refusal for everything else is the point rather than a gap. A model that could
		 * `write rule://no-force-push` could rewrite the constraint that stops it force-pushing,
		 * and the rewrite would look like any other tool call. Changing a rule goes through the
		 * filesystem, where the user's own review of a diff applies.
		 */
		if (ctx.resources?.canResolve(args.path)) {
			try {
				await ctx.resources.write(args.path, args.content, {
					cwd: ctx.cwd,
					sessionId: ctx.sessionId,
					scratchDir: ctx.scratchDir,
					state: ctx.state,
					signal: ctx.signal,
				});
				return {
					content: [{ type: "text", text: `Wrote ${args.path} (${args.content.length} characters).` }],
					details: { kind: "resource", url: args.path },
				};
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		}

		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, args.path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		const alreadyExists = await exists(absolute);
		// Overwriting a file the agent has not read is how unrelated work gets destroyed.
		if (alreadyExists && !hasRead(ctx, absolute)) {
			return errorResult(`Read ${args.path} before overwriting it, so you do not discard content you have not seen.`);
		}

		const previous = alreadyExists ? await readFile(absolute, "utf8").catch(() => "") : "";

		if (ctx.requestApproval) {
			const decision = await ctx.requestApproval({
				kind: "write",
				title: alreadyExists ? `Overwrite ${displayPath(ctx.cwd, absolute)}` : `Create ${displayPath(ctx.cwd, absolute)}`,
				detail: formatDiff(computeDiff(previous, args.content), displayPath(ctx.cwd, absolute)),
				subject: absolute,
			});
			if (decision === "reject") return errorResult("The user rejected this write.");
		}

		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, args.content, "utf8");
		markRead(ctx, absolute);

		const lines = args.content === "" ? 0 : args.content.split("\n").length;
		const diff = computeDiff(previous, args.content);
		return {
			content: [
				{
					type: "text",
					text: `${alreadyExists ? "Updated" : "Created"} ${displayPath(ctx.cwd, absolute)} (${lines} lines).`,
				},
			],
			details: {
				kind: "write",
				path: displayPath(ctx.cwd, absolute),
				created: !alreadyExists,
				added: diff.added,
				removed: diff.removed,
				hunks: diff.hunks,
			},
		};
	},
};
