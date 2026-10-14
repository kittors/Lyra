import { errorResult } from "../agent/tool-run.ts";
import { CREDENTIAL_KINDS, type CredentialKind, type CredentialMeta, envName } from "../credentials/types.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

export const CREDENTIAL_TOOL_NAME = "request_credential";

interface RequestCredentialArgs {
	name: string;
	title: string;
	purpose: string;
	kind: CredentialKind;
	target?: string;
}

/** How to use what was just provided, by kind — the model's next call depends on it. */
function usage(meta: CredentialMeta): string[] {
	const variable = envName(meta.name);
	const lines: string[] = [];
	if (meta.kind === "ssh_key") lines.push(`bash: add credentials: ["${meta.name}"]. ssh, scp, rsync and git use the key through an agent; no -i needed.`);
	else if (meta.kind === "token") lines.push(`bash: add credentials: ["${meta.name}"]; the token is in $${variable}.`);
	else lines.push(`bash: add credentials: ["${meta.name}"]. ssh, scp, sudo -A and git ask for the password themselves; a command that names $${variable} also gets it there.`);
	if (meta.kind === "login") lines.push(`The username is ${meta.username} ($${variable}_USERNAME).`);
	if (meta.kind !== "ssh_key") {
		const field = meta.kind === "login" ? `"${meta.name}" for the password, "${meta.name}.username" for the username` : `"${meta.name}"`;
		lines.push(`browser: browser_act { action: "type", selector: …, credential: ${field} }.`);
	}
	return lines;
}

/*
 * Said when nothing came back, and said in full, because the obvious next move is the wrong one:
 * a model told "no credential" asks the person to type it into the chat, which is the one thing this
 * tool exists to prevent. OpenHands' `request_secret` ends its refusal the same way.
 */
const DECLINED =
	"The user did not provide the credential. Do not ask them to paste it into the conversation. Continue with whatever does not need it, and say plainly in your reply that it was not provided.";

export const requestCredentialTool: Tool<RequestCredentialArgs> = {
	// A literal, as every tool's is: `test/tool-registry.test.ts` finds the tools by reading the source.
	name: "request_credential",
	snippet: "Ask the user for a password, key or token without seeing it",
	// One card at a time: two at once would stack, and the second is the one that gets dismissed.
	executionMode: "sequential",
	guidelines: [
		"When a task needs a password, an SSH key, an API token or a login, call request_credential. Never ask the user to paste one into the conversation.",
		"Use a credential by name — bash `credentials: [name]`, browser_act type `credential: name` — and pass values through the environment or stdin, never on a command line. Do not add BatchMode=yes to an ssh that uses one.",
		"[credential:name] in the user's own message is a saved credential they are handing you: use it by that name. To learn its kind and where it may be used, call request_credential with that name; no card is shown for one the conversation already has.",
	],
	description:
		"Ask the user for a credential on a secure card. The value goes to the app, never to you: you get its name, " +
		"and use it by that name in bash (`credentials`) and browser_act (`credential`). Output that contains the value " +
		"reaches you masked as [credential:name]. A credential saved earlier under the same name is offered to the user first.",
	parameters: {
		type: "object",
		properties: {
			name: { type: "string", description: "Lowercase letters, digits and hyphens, e.g. kzhy-root. Reuse the same name to reuse the credential." },
			title: { type: "string", description: "What it is, shown as the card's title, e.g. 'Root password for kzhy'." },
			purpose: { type: "string", description: "One sentence on what you will do with it, shown to the user." },
			kind: { type: "string", enum: [...CREDENTIAL_KINDS], description: "password, ssh_key (a private key), token (an API token), or login (username and password)." },
			target: { type: "string", description: "Where it may be used: ssh://user@host or https://host. It can be used nowhere else. Omit only when it truly has no single destination." },
		},
		required: ["name", "title", "purpose", "kind"],
		additionalProperties: false,
	},
	summarize: (args) => `Credential: ${String(args.name ?? "")}`,
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		if (!ctx.credentials || !ctx.requestApproval) return errorResult("This host cannot ask the user for a credential.");
		if (typeof args.purpose !== "string" || !args.purpose.trim()) return errorResult("purpose: say in one sentence what the credential is for; it is shown on the card.");
		const outcome = await ctx.credentials.request(
			{ name: args.name, title: args.title, purpose: args.purpose.trim(), kind: args.kind, ...(args.target ? { target: args.target } : {}) },
			ctx.requestApproval,
		);
		if (outcome.status === "invalid") return errorResult(outcome.message);
		if (outcome.status === "declined") return { content: [{ type: "text", text: DECLINED }], details: { kind: "credential", name: args.name, status: "declined" } };
		const { meta } = outcome;
		const scope = meta.saved ? "saved on this computer" : "for this conversation only";
		const bound = meta.target ? `usable only for ${meta.target}` : "usable anywhere";
		const text = [`Provided: ${meta.name} (${meta.kind}, ${scope}, ${bound}). You cannot see its value.`, ...usage(meta)].join("\n");
		return {
			content: [{ type: "text", text }],
			details: { kind: "credential", name: meta.name, credentialKind: meta.kind, status: "provided", saved: meta.saved, ...(meta.target ? { target: meta.target } : {}) },
		};
	},
};
