import { errorResult } from "../agent/tool-run.ts";
import type { CredentialMeta } from "../credentials/types.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

/** One line per credential: everything about it except the value, which this tool cannot see either. */
function line(meta: CredentialMeta): string {
	const facts = [meta.kind, meta.username ? `user ${meta.username}` : "", meta.target ? `only for ${meta.target}` : "", meta.saved ? "" : "this conversation only"].filter(Boolean);
	return `- [credential:${meta.name}] ${meta.title} (${facts.join(", ")})`;
}

/**
 * The credentials a conversation can name, for a model that was asked about one.
 *
 * "What is my NAS password" has an answer the model must not have. It gets the name instead and writes
 * `[credential:name]` in its reply; the app draws that as a button the person clicks to copy the value
 * (`features/vault/CredentialRef.tsx`), so the answer reaches the one who asked and nobody else.
 */
export const listCredentialsTool: Tool<Record<string, never>> = {
	// A literal, as every tool's is: `test/tool-registry.test.ts` finds the tools by reading the source.
	name: "list_credentials",
	snippet: "See which credentials the user keeps, by name — never their values",
	executionMode: "parallel",
	description:
		"List the credentials the user keeps and any given in this conversation: reference, title, kind, username and where each may be used. " +
		"Never their values — you cannot see those. To use one, name it (bash `credentials`, browser_act `credential`). " +
		"To show one to the user, write its reference, e.g. [credential:nas-root], in your reply: the app turns it into a button that copies the value for them.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	summarize: () => "List credentials",
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		if (!ctx.credentials) return errorResult("This host keeps no credentials.");
		const known = await ctx.credentials.list();
		const text =
			known.length === 0
				? "The user keeps no credentials, and none was given in this conversation. Ask for one with request_credential."
				: known.map(line).join("\n");
		return { content: [{ type: "text", text }], details: { kind: "credentials", count: known.length } };
	},
};
