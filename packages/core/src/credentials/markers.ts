/**
 * `[credential:name]`, the mark a masked value leaves behind, and turning it back into the value.
 *
 * Only the file tools turn it back. A one-way mask breaks read-then-edit: the model edits what it
 * read, and what it read is no longer what is on disk. oh-my-pi shipped exactly that (#6968): every
 * edit whose old text held a masked token failed to match, and the model fell back to `sed -i`,
 * around the edit tool's own checks. Making the mask silently reversible everywhere was its next
 * mistake (#13616): the model believed it wrote a placeholder and the file got the real token.
 * So the edit tool restores what is being kept and asks about what is being introduced.
 */

import type { RedactSecret } from "./redact.ts";

/** `kzhy-root`, or `my-key.passphrase` for a credential's second secret. */
const MARKER = /\[credential:([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\.[a-z_]+)?)\]/g;

export function markerLabels(text: string): string[] {
	const labels: string[] = [];
	for (const match of text.matchAll(MARKER)) if (!labels.includes(match[1]!)) labels.push(match[1]!);
	return labels;
}

/** Each mark replaced by its value. A label nobody knows stays as written — it may just be text. */
export function restoreMarkers(text: string, value: (label: string) => string | undefined): string {
	return text.replace(MARKER, (whole, label: string) => value(label) ?? whole);
}

/**
 * Credentials a change writes where they were not before, by name.
 *
 * Keeping a value that is already in the file — rewording the line it sits on — is the edit doing
 * what was read. Putting one somewhere new is a decision about where a secret lives, and a file in
 * a repository gets pushed: the file tools ask about it in every mode. oh-my-pi restored marks
 * silently and the model never knew a real token had gone into the file (#13616).
 */
export function introducedCredentials(secrets: readonly RedactSecret[], before: string, after: string): string[] {
	const found = secrets.filter((secret) => after.includes(secret.value) && !before.includes(secret.value));
	return [...new Set(found.map((secret) => secret.label.split(".")[0]!))];
}
