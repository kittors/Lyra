/**
 * What a credential is, as everything outside the broker sees it.
 *
 * Two families of shape live here and must not be confused. The ones that carry no value — a spec,
 * a prompt, the metadata — travel through events, the session log and IPC freely. The one that
 * does, a submission, crosses IPC once, from the card to the broker, and goes nowhere else.
 */

import type { ApprovalDecision, ApprovalRequest } from "../types/tool.ts";
import type { Redactor, RedactSecret } from "./redact.ts";

export type CredentialKind = "password" | "ssh_key" | "token" | "login";

export const CREDENTIAL_KINDS: readonly CredentialKind[] = ["password", "ssh_key", "token", "login"];

/** What the model asks for: a name and a description, never a value. */
export interface CredentialSpec {
	name: string;
	title: string;
	purpose: string;
	kind: CredentialKind;
	/** Where it may be used — `ssh://user@host`, `https://origin`. Absent means anywhere. */
	target?: string;
}

export type FieldKey = "username" | "password" | "private_key" | "passphrase" | "token";

/** One input on the card. `secret` fields are masked, redacted, and never shown back to anyone. */
export interface CredentialField {
	key: FieldKey;
	secret: boolean;
	optional?: boolean;
	multiline?: boolean;
}

const FIELDS: Record<CredentialKind, CredentialField[]> = {
	password: [{ key: "password", secret: true }],
	token: [{ key: "token", secret: true }],
	login: [{ key: "username", secret: false }, { key: "password", secret: true }],
	ssh_key: [{ key: "private_key", secret: true, multiline: true }, { key: "passphrase", secret: true, optional: true }],
};

export function fieldsFor(kind: CredentialKind): CredentialField[] {
	return FIELDS[kind];
}

/**
 * How a saved credential is let into a conversation that has not used it yet.
 *
 * The three grains of 1Password's SSH agent: ask every time, ask once per conversation, never ask.
 * The middle one is the default — see `docs/plan/secure-credentials` §4.6 for why a credential typed
 * in this conversation is never asked about again, and a saved one is asked about once.
 */
export type CredentialApproval = "every-use" | "per-conversation" | "never";

/** Everything about a credential except its value: what the model, the log and settings may see. */
export interface CredentialMeta {
	name: string;
	kind: CredentialKind;
	title: string;
	target?: string;
	/** The one field that is not secret, for a login. */
	username?: string;
	saved: boolean;
	createdAt: number;
	usedAt?: number;
	approval: CredentialApproval;
}

/** The question a card renders. It rides on `approval_request` and holds no value. */
export interface CredentialPrompt {
	/** The broker's handle for this request; the submission names it to find its way back. */
	key: string;
	name: string;
	kind: CredentialKind;
	target?: string;
	fields: CredentialField[];
	/** A saved credential answers this; the card offers it before asking for anything to be typed. */
	saved?: { createdAt: number; target?: string; username?: string };
}

/** What the person typed. Crosses IPC once, card to broker, and is never written anywhere else. */
export interface CredentialSubmission {
	values?: Partial<Record<FieldKey, string>>;
	remember?: boolean;
	/** Take the saved credential the card offered instead of typing a new one. */
	useSaved?: boolean;
}

/** `kzhy-root`, `sub-admin`: what a model can name and an environment variable can be made of. */
export const CREDENTIAL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The name as an environment variable: `kzhy-root` is `KZHY_ROOT`. */
export function envName(name: string): string {
	return name.toUpperCase().replace(/-/g, "_");
}

/** A parsed `target`. Ports are kept but never compared: an ssh prompt does not show one. */
export interface CredentialTarget {
	scheme: string;
	user?: string;
	host: string;
	port?: number;
}

export function parseTarget(target: string | undefined): CredentialTarget | null {
	if (!target) return null;
	try {
		const url = new URL(target);
		const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
		if (!host) return null;
		return {
			scheme: url.protocol.replace(/:$/, "").toLowerCase(),
			...(url.username ? { user: decodeURIComponent(url.username) } : {}),
			host,
			...(url.port ? { port: Number(url.port) } : {}),
		};
	} catch {
		return null;
	}
}

/** `http` stays in for a login page on a local dev server; anything else names no place a credential goes. */
const TARGET_SCHEMES: ReadonlySet<string> = new Set(["ssh", "https", "http"]);

/** A target a credential can be bound to. The vault page checks with this too, so it says no in the same cases. */
export function targetAllowed(target: string): boolean {
	const parsed = parseTarget(target);
	return parsed !== null && TARGET_SCHEMES.has(parsed.scheme);
}

/** The approval channel, as the broker uses it: a card goes out, an answer comes back. */
export type CredentialAsk = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export type RequestOutcome =
	| { status: "provided"; meta: CredentialMeta }
	| { status: "declined" }
	| { status: "invalid"; message: string };

/** What one command is given, and what has to happen when it ends. */
export interface PreparedCommand {
	env: Record<string, string>;
	/** Sockets the command must be able to reach — a sandbox that denies the network is told about these. */
	sockets: string[];
	/** Prompts a helper declined to answer, one line each, for the command's result. */
	notes(): string[];
	/** Closes the sockets and removes their directory. Safe to call twice. */
	dispose(): Promise<void>;
}

/**
 * One conversation's view of the broker — what `ToolContext.credentials` is.
 *
 * Sub-agents get their parent's view, not one of their own: a credential the person filled for the
 * conversation is for whatever the conversation delegates, and the masking has to know every value
 * any of them might print.
 */
export interface CredentialAccess {
	request(spec: CredentialSpec, ask: CredentialAsk): Promise<RequestOutcome>;
	prepare(names: readonly string[], command: string, ask: CredentialAsk): Promise<PreparedCommand>;
	/** One field's value — `name` for the main secret, `name.username` and so on — for a host tool that places it itself. */
	reveal(label: string): string | undefined;
	describe(name: string): CredentialMeta | undefined;
	/** Every secret value unlocked in this conversation, labelled, for masking. */
	secrets(): RedactSecret[];
	/** A masker for exactly those, rebuilt only when they change. */
	redactor(): Redactor;
	/** `[credential:x]` back into values. */
	restore(text: string): string;
}
