/**
 * Checking what the model asked for before a card is put in front of anyone.
 *
 * The answers are sentences the model can act on, because the model is who reads them: a card that
 * never appeared has no other way of explaining itself.
 */

import type { RedactSecret } from "./redact.ts";
import { CREDENTIAL_KINDS, CREDENTIAL_NAME, type CredentialKind, type CredentialSpec, type FieldKey, fieldsFor, targetAllowed } from "./types.ts";

export function validateSpec(spec: CredentialSpec): string | null {
	if (typeof spec.name !== "string" || !CREDENTIAL_NAME.test(spec.name)) return "name must be 1-40 lowercase letters, digits or hyphens, like kzhy-root.";
	if (!CREDENTIAL_KINDS.includes(spec.kind)) return `kind must be one of: ${CREDENTIAL_KINDS.join(", ")}.`;
	if (typeof spec.title !== "string" || !spec.title.trim() || spec.title.length > 80) return "title must be a short label of at most 80 characters.";
	if (typeof spec.purpose !== "string" || spec.purpose.length > 400) return "purpose must say in a sentence or two what it is for.";
	if (spec.target !== undefined && !targetAllowed(spec.target)) return "target must be ssh://user@host or https://host, or left out to allow anywhere.";
	return null;
}

/**
 * What a card or the vault page sent, kept to the fields this kind has.
 *
 * Passwords keep their spaces — a space can be part of one. A pasted key and a username lose the
 * ones around them, which a copy from a terminal or a web page always brings along.
 */
export function readValues(kind: CredentialKind, given: Partial<Record<FieldKey, string>> | undefined): { values: Partial<Record<FieldKey, string>> } | { problem: "missing" } {
	const values: Partial<Record<FieldKey, string>> = {};
	for (const field of fieldsFor(kind)) {
		const raw = given?.[field.key];
		const value = typeof raw === "string" ? (field.key === "private_key" || field.key === "username" ? raw.trim() : raw) : "";
		if (value) values[field.key] = value;
		else if (!field.optional) return { problem: "missing" };
	}
	return { values };
}

/** A credential's secret values as masking sees them: the main secret under its name, the others as `name.field`. */
export function secretsOf(name: string, kind: CredentialKind, values: Partial<Record<FieldKey, string>>): RedactSecret[] {
	const out: RedactSecret[] = [];
	for (const field of fieldsFor(kind)) {
		const value = values[field.key];
		if (!field.secret || !value) continue;
		const label = field.key === "passphrase" ? `${name}.passphrase` : name;
		out.push({ label, value });
		// A key is printed a line at a time as often as whole; each body line is caught on its own.
		if (field.key === "private_key") for (const line of value.split(/\r?\n/)) if (line.trim().length >= 20) out.push({ label, value: line.trim() });
	}
	return out;
}
