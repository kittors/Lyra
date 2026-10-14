/**
 * What arrives over the credential channels, rebuilt field by field before it reaches the broker,
 * and what goes back, stripped of values. Kept apart from the handlers so the rules can be tested
 * without a window: these are the only gates between a renderer's object and the vault.
 */

import type { CredentialApproval, CredentialKind, CredentialSubmission, FieldKey, SavedInput, SavedOutcome, SavedPatch } from "@lyra/core";
import type { SavedResult } from "./ipc-types.ts";

const FIELDS: readonly FieldKey[] = ["username", "password", "private_key", "passphrase", "token"];
const KINDS: ReadonlySet<string> = new Set<CredentialKind>(["password", "ssh_key", "token", "login"]);
const APPROVALS: ReadonlySet<string> = new Set<CredentialApproval>(["every-use", "per-conversation", "never"]);

/** Its own fields only: nothing is read through a prototype, whatever shape the object arrived in. */
function record(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" ? Object.fromEntries(Object.entries(input)) : {};
}

/** Typed values, rebuilt field by field: nothing but these crosses into the broker. */
function valuesOf(input: unknown): Partial<Record<FieldKey, string>> {
	const given = record(input);
	const values: Partial<Record<FieldKey, string>> = {};
	for (const key of FIELDS) {
		const value = given[key];
		if (typeof value === "string") values[key] = value;
	}
	return values;
}

export function submissionOf(input: unknown): CredentialSubmission {
	const raw = record(input);
	return { values: valuesOf(raw.values), remember: raw.remember === true, useSaved: raw.useSaved === true };
}

function approvalOf(value: unknown): { approval?: CredentialApproval } {
	return typeof value === "string" && APPROVALS.has(value) ? { approval: value as CredentialApproval } : {};
}

/** A blank target is "anywhere": the form's empty field, not a target to check. */
function targetOf(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" ? value.trim() || null : undefined;
}

export function addInputOf(input: unknown): SavedInput {
	const raw = record(input);
	const target = targetOf(raw.target);
	return {
		name: typeof raw.name === "string" ? raw.name.trim() : "",
		kind: typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw.kind as CredentialKind) : ("" as CredentialKind),
		title: typeof raw.title === "string" ? raw.title : "",
		...(target ? { target } : {}),
		...approvalOf(raw.approval),
		values: valuesOf(raw.values),
	};
}

export function patchOf(input: unknown): SavedPatch {
	const raw = record(input);
	const target = targetOf(raw.target);
	return {
		...(typeof raw.title === "string" ? { title: raw.title } : {}),
		...(target !== undefined ? { target } : {}),
		...approvalOf(raw.approval),
		...(raw.values && typeof raw.values === "object" ? { values: valuesOf(raw.values) } : {}),
	};
}

/** What the page is told: the record without its values. */
export function resultOf(outcome: SavedOutcome): SavedResult {
	if (!outcome.ok) return { ok: false, problem: outcome.problem, ...(outcome.message ? { message: outcome.message } : {}) };
	const { values, ...meta } = outcome.record;
	void values;
	return { ok: true, meta: { ...meta, saved: true } };
}
