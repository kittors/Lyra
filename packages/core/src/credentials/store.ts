/**
 * Saved credentials: one sealed record per name, in the vault under `credential:<name>`.
 *
 * The record seals the description with the value. A server's address and the username on it are
 * not secrets on their own, but "this is where the root password goes" is worth keeping out of
 * `settings.json`, which is synced, copied between machines and pasted into bug reports — the reason
 * the vault exists at all (ADR-0003).
 *
 * `keepSecrets` in `config/settings.ts` forgets only `provider:` and `mcp:` ids it no longer
 * recognises, so saving the settings never touches these.
 */

import { putSecrets, secret, secretIds } from "../config/vault.ts";
import { CREDENTIAL_KINDS, CREDENTIAL_NAME, type CredentialApproval, type CredentialMeta, type FieldKey } from "./types.ts";

export interface CredentialRecord extends Omit<CredentialMeta, "saved"> {
	values: Partial<Record<FieldKey, string>>;
}

export interface CredentialVault {
	list(): Promise<CredentialRecord[]>;
	get(name: string): Promise<CredentialRecord | null>;
	put(record: CredentialRecord): Promise<void>;
	remove(name: string): Promise<void>;
}

const PREFIX = "credential:";
const APPROVALS: ReadonlySet<string> = new Set<CredentialApproval>(["every-use", "per-conversation", "never"]);

/** A record read back, or null when it is not one: a hand-edited file must not crash a listing. */
function parseRecord(raw: string | null): CredentialRecord | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Partial<CredentialRecord>;
		if (typeof value.name !== "string" || !CREDENTIAL_NAME.test(value.name)) return null;
		if (!CREDENTIAL_KINDS.includes(value.kind as CredentialRecord["kind"])) return null;
		if (!value.values || typeof value.values !== "object") return null;
		return {
			name: value.name,
			kind: value.kind as CredentialRecord["kind"],
			title: typeof value.title === "string" ? value.title : value.name,
			...(typeof value.target === "string" ? { target: value.target } : {}),
			...(typeof value.username === "string" ? { username: value.username } : {}),
			createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
			...(typeof value.usedAt === "number" ? { usedAt: value.usedAt } : {}),
			approval: typeof value.approval === "string" && APPROVALS.has(value.approval) ? value.approval : "per-conversation",
			values: Object.fromEntries(Object.entries(value.values).filter(([, item]) => typeof item === "string")),
		};
	} catch {
		return null;
	}
}

/** The vault in `~/.lyra`, which is where saved credentials live outside of tests. */
export function vaultStore(): CredentialVault {
	return {
		async list() {
			const ids = await secretIds(PREFIX);
			const records = await Promise.all(ids.map(async (id) => parseRecord(await secret(id))));
			return records.filter((record): record is CredentialRecord => record !== null).sort((a, b) => b.createdAt - a.createdAt);
		},
		async get(name) {
			return parseRecord(await secret(PREFIX + name));
		},
		async put(record) {
			await putSecrets({ [PREFIX + record.name]: JSON.stringify(record) });
		},
		async remove(name) {
			// An empty value is how `putSecrets` deletes.
			await putSecrets({ [PREFIX + name]: "" });
		},
	};
}

/** The same, in memory, for tests and for a host that keeps nothing. */
export function memoryStore(initial: CredentialRecord[] = []): CredentialVault {
	const records = new Map(initial.map((record) => [record.name, structuredClone(record)]));
	return {
		async list() {
			return [...records.values()].map((record) => structuredClone(record)).sort((a, b) => b.createdAt - a.createdAt);
		},
		async get(name) {
			const record = records.get(name);
			return record ? structuredClone(record) : null;
		},
		async put(record) {
			records.set(record.name, structuredClone(record));
		},
		async remove(name) {
			records.delete(name);
		},
	};
}
