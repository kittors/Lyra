/**
 * The vault page's side of the broker: credentials the person keeps by hand.
 *
 * Listed without their values, added and re-entered from a form, removed. Nothing here hands a value
 * back: the broker reads one only to give it to a command or a page, and the vault page copies one to
 * the clipboard from the main process (`electron/ipc/credentials.ts`), never through the renderer.
 */

import { markerLabels } from "./markers.ts";
import { Redactor, type RedactSecret } from "./redact.ts";
import { readValues, secretsOf, validateSpec } from "./spec.ts";
import { type KeyProblem, publicKeyLine, readPrivateKey } from "./ssh-agent.ts";
import type { CredentialRecord, CredentialVault } from "./store.ts";
import type { CredentialApproval, CredentialKind, CredentialMeta, FieldKey } from "./types.ts";

/** Why the vault page could not save, in terms its form can turn into a sentence. */
export type SavedProblem = KeyProblem | "missing" | "invalid" | "exists" | "gone";
export type SavedOutcome = { ok: true; record: CredentialRecord } | { ok: false; problem: SavedProblem; message?: string };

export interface SavedInput {
	name: string;
	kind: CredentialKind;
	title: string;
	target?: string;
	approval?: CredentialApproval;
	values: Partial<Record<FieldKey, string>>;
}

export interface SavedPatch {
	title?: string;
	target?: string | null;
	approval?: CredentialApproval;
	/** Every field of the kind, typed again; absent keeps what is saved. */
	values?: Partial<Record<FieldKey, string>>;
}

function metaOf(record: CredentialRecord): CredentialMeta {
	const { values, ...meta } = record;
	void values;
	return { ...meta, saved: true };
}

/** A key that will not open is refused at the form, not discovered at the first ssh. */
function keyProblem(kind: CredentialKind, values: Partial<Record<FieldKey, string>>): KeyProblem | null {
	if (kind !== "ssh_key") return null;
	const read = readPrivateKey(values.private_key ?? "", values.passphrase);
	return "problem" in read ? read.problem : null;
}

/** The values to seal: everything but the username, which the record keeps in the clear. */
export function sealedValues(values: Partial<Record<FieldKey, string>>): Partial<Record<FieldKey, string>> {
	const { username, ...secrets } = values;
	void username;
	return secrets;
}

export async function listSaved(vault: CredentialVault): Promise<CredentialMeta[]> {
	return (await vault.list()).map(metaOf);
}

export async function addSaved(vault: CredentialVault, input: SavedInput, now: number): Promise<SavedOutcome> {
	const title = typeof input.title === "string" ? input.title.trim() : "";
	const invalid = validateSpec({ name: input.name, kind: input.kind, title, purpose: "", ...(input.target ? { target: input.target } : {}) });
	if (invalid) return { ok: false, problem: "invalid", message: invalid };
	// Never over an existing one: the page edits a saved credential, it does not replace it by accident.
	if (await vault.get(input.name)) return { ok: false, problem: "exists" };
	const read = readValues(input.kind, input.values);
	if ("problem" in read) return { ok: false, problem: read.problem };
	const key = keyProblem(input.kind, read.values);
	if (key) return { ok: false, problem: key };
	const record: CredentialRecord = {
		name: input.name,
		kind: input.kind,
		title,
		...(input.target ? { target: input.target } : {}),
		...(read.values.username ? { username: read.values.username } : {}),
		createdAt: now,
		approval: input.approval ?? "per-conversation",
		values: sealedValues(read.values),
	};
	await vault.put(record);
	return { ok: true, record };
}

export async function updateSaved(vault: CredentialVault, name: string, patch: SavedPatch): Promise<SavedOutcome> {
	const record = await vault.get(name);
	if (!record) return { ok: false, problem: "gone" };
	const next: CredentialRecord = {
		...record,
		...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
		...(patch.approval ? { approval: patch.approval } : {}),
	};
	if (patch.target === null) delete next.target;
	else if (typeof patch.target === "string") next.target = patch.target;
	const invalid = validateSpec({ name: next.name, kind: next.kind, title: next.title, purpose: "", ...(next.target ? { target: next.target } : {}) });
	if (invalid) return { ok: false, problem: "invalid", message: invalid };
	if (patch.values) {
		const read = readValues(next.kind, patch.values);
		if ("problem" in read) return { ok: false, problem: read.problem };
		const key = keyProblem(next.kind, read.values);
		if (key) return { ok: false, problem: key };
		next.values = sealedValues(read.values);
		if (read.values.username) next.username = read.values.username;
		else delete next.username;
	}
	await vault.put(next);
	return { ok: true, record: next };
}

/**
 * What the vault page's copy button puts on the clipboard: the secret, or for a key its public half —
 * the half anyone copies a key for. The private key never leaves; a command gets it from the agent.
 */
export function copyableOf(record: CredentialRecord): { text: string; secret: boolean } | null {
	if (record.kind === "ssh_key") {
		const read = readPrivateKey(record.values.private_key ?? "", record.values.passphrase);
		return "problem" in read ? null : { text: publicKeyLine(read.key, record.name), secret: false };
	}
	const text = record.values[record.kind === "token" ? "token" : "password"];
	return text ? { text, secret: true } : null;
}

/**
 * In a message the person sends, a value this short is far more often a number than a PIN: "1234"
 * is left alone there. Tool output masks values of any length, where a wrong guess costs less.
 */
const PROMPT_MIN = 6;

/** A message's texts with every saved or held value replaced by its mark, and the saved credentials they name. */
export function screenTexts(saved: readonly CredentialRecord[], held: readonly RedactSecret[], texts: readonly string[]): { texts: string[]; named: CredentialRecord[] } {
	const secrets = [...saved.flatMap((record) => secretsOf(record.name, record.kind, record.values)), ...held].filter((secret) => secret.value.length >= PROMPT_MIN);
	const redactor = secrets.length > 0 ? new Redactor(secrets) : null;
	const masked = texts.map((text) => (redactor ? redactor.text(text) : text));
	const named: CredentialRecord[] = [];
	for (const label of masked.flatMap(markerLabels)) {
		const record = saved.find((one) => one.name === label.split(".")[0]);
		// A mark for something never saved is only text.
		if (record && !named.includes(record)) named.push(record);
	}
	return { texts: masked, named };
}
