/**
 * Where the accounts and their tokens are kept.
 *
 * This app avoided being a credential store for as long as it could — `gh` held the token, and
 * that was one less thing to be responsible for. Supporting four hosts and several identities ends
 * that: there is no CLI that holds a GitLab token and a Gitee token and a token for the company's
 * own Gitea, and asking somebody to install three of them would be worse than storing one.
 *
 * The token used to be encrypted by the OS keychain, and is not any more. That was the right
 * default and the wrong one for how this app is shipped: the macOS builds are ad-hoc signed, so
 * every release has a different code identity, and a keychain entry is bound to the identity that
 * created it. The effect was signing in to GitHub again after every single update. See
 * `config/vault.ts` in core for the measurement and the trade that replaces it.
 *
 * What still holds:
 *
 * - The token is never in `settings.json` — the file that is synced, copied between machines and
 *   pasted into bug reports.
 * - Both the token and the key that seals it are `0600`, in the app's own directory.
 * - It never crosses IPC. The renderer gets accounts without tokens; every call that needs one is
 *   made here.
 */

import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, writeFileAtomic } from "@lyra/core";
import { isSealed, seal, unseal } from "@lyra/core";
import { parseAccounts } from "./accounts.ts";
import type { ForgeAccount } from "./types.ts";

interface StoredEntry {
	account: ForgeAccount;
	/** Base64 of the encrypted token, or the token itself when `encrypted` is false. */
	token: string;
	encrypted: boolean;
}

interface StoredFile {
	version: 1;
	entries: StoredEntry[];
}

const FILE = () => join(lyraHome(), "forges.json");

/** Read once, kept in memory: every list refresh would otherwise be a disk read and a decrypt. */
let loaded: StoredFile | null = null;

/**
 * Whether what is in memory is the whole of what is on disk.
 *
 * False when the file could not be parsed, or when it held entries this build refused — a
 * hand-edited file, one written by a newer version, an account whose `baseUrl` no longer passes
 * validation. In every one of those cases the list in memory is *shorter than the truth*, and
 * writing it back is not saving, it is deleting.
 *
 * That is not hypothetical. This file was found holding `{"version":1,"entries":[]}` — 35 bytes,
 * where an account had been — because a read that came up empty was followed by an ordinary
 * write, and the write believed it. Nothing warned, and there was nothing left to recover from.
 */
let intact = true;

/**
 * Forget what was read, for tests that point `LYRA_HOME` somewhere else between cases.
 *
 * The cache is keyed on nothing — it assumes one home per process, which is true of the app and
 * false of a test file. Without this the second case reads the first one's accounts.
 */
export function resetForgeStore(): void {
	loaded = null;
	intact = true;
}

async function read(): Promise<StoredFile> {
	if (loaded) return loaded;
	const raw = await readFile(FILE(), "utf8").catch(() => null);
	// No file is an answer, not a failure: this profile has never signed in to anything.
	if (raw === null) {
		intact = true;
		return (loaded = { version: 1, entries: [] });
	}

	try {
		const parsed = JSON.parse(raw) as { entries?: unknown[] };
		const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
		// The accounts go through the same validation as a hand-edited file, and an entry whose
		// account did not survive it is dropped along with its token — a token nobody can attribute
		// to a host is not a credential, it is a secret with no purpose.
		const kept: StoredEntry[] = [];
		for (const entry of entries as StoredEntry[]) {
			const [account] = parseAccounts([entry?.account]);
			if (account && typeof entry.token === "string") {
				kept.push({ account, token: entry.token, encrypted: entry.encrypted === true });
			}
		}
		// Dropping a bad entry is right; forgetting that anything was dropped is what loses data.
		intact = kept.length === entries.length;
		if (!intact) {
			console.warn(`[forge] ${entries.length - kept.length} account(s) in forges.json were not readable by this build`);
		}
		return (loaded = { version: 1, entries: kept });
	} catch {
		intact = false;
		console.warn("[forge] forges.json could not be parsed; it will be preserved rather than overwritten");
		return (loaded = { version: 1, entries: [] });
	}
}

async function write(file: StoredFile): Promise<void> {
	const path = FILE();
	await mkdir(lyraHome(), { recursive: true });

	/*
	 * Never overwrite a file we could not fully read.
	 *
	 * Signing one account in must not delete another that this build merely failed to parse. The
	 * unreadable copy is moved aside instead of being replaced, so the tokens in it still exist —
	 * recoverable by hand, which is the difference between an inconvenience and a loss.
	 *
	 * Kept, not deleted: it holds credentials, and the point of this branch is that we do not
	 * understand its contents well enough to be sure they are worthless.
	 */
	if (!intact) {
		const aside = `${path}.unreadable-${Date.now()}`;
		await rename(path, aside).catch(() => {});
		console.warn(`[forge] the previous forges.json was kept at ${aside} rather than being overwritten`);
		intact = true;
	}

	loaded = file;
	// 0600 from the moment the temporary file exists, so the tokens are never readable by anyone else.
	await writeFileAtomic(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

/** The change in progress; the next one starts after it. See `change`. */
let changing: Promise<unknown> = Promise.resolve();

/**
 * Read, modify and write the file as one step, one change at a time.
 *
 * Every change reads the list, awaits sealing a token, and writes the list back. Two at once —
 * signing in to two hosts, or a token being resealed while another account is saved — both started
 * from the same list: the second write failed on the shared temporary name, or it succeeded and
 * dropped the first change, and an account that had signed in successfully was gone on the next
 * launch.
 */
function change<T>(body: () => Promise<T>): Promise<T> {
	const run = changing.then(body);
	changing = run.catch(() => {});
	return run;
}

/**
 * The keychain, for reading what an older build wrote and nothing else.
 *
 * Entries stored before this change are sealed by `safeStorage`, and the ones that can still be
 * opened are worth carrying across rather than making somebody sign in again to complete a
 * migration whose entire purpose is to stop making them sign in again. The ones that cannot — the
 * macOS case this change exists for — are dropped, and the account is marked as needing a token.
 *
 * Imported dynamically for the same reason as everything else here that touches Electron: this
 * module is reachable from tests, where `electron` is not a module that exists.
 */
async function legacyKeychain(): Promise<{ decrypt(value: Buffer): string } | null> {
	try {
		const { safeStorage } = await import("electron");
		if (!safeStorage?.isEncryptionAvailable()) return null;
		return { decrypt: (value) => safeStorage.decryptString(value) };
	} catch {
		return null;
	}
}

/*
 * There used to be an `encryptionAvailable` here, and a settings page with two versions of the
 * truth to match: encrypted where the machine had a keyring, plaintext where it did not. The seal
 * no longer asks the OS for anything, so there is one answer and the question is gone with it.
 */

export async function listAccounts(): Promise<ForgeAccount[]> {
	return (await read()).entries.map((entry) => entry.account);
}

export async function accountById(id: string): Promise<ForgeAccount | null> {
	return (await read()).entries.find((entry) => entry.account.id === id)?.account ?? null;
}

/**
 * The secret for one account, opened. Null when there is no such account, or no opening it.
 *
 * Three shapes reach here, because two of them predate this file's current form: a value sealed by
 * the vault, one sealed by the keychain an older build used, and — on a machine that never had a
 * keyring — a token in the clear. The first is the ordinary case; the other two are read once and
 * rewritten as the first.
 */
export async function tokenFor(id: string): Promise<string | null> {
	const entry = (await read()).entries.find((e) => e.account.id === id);
	if (!entry) return null;

	if (isSealed(entry.token)) return unseal(entry.token);

	if (!entry.encrypted) {
		// Plaintext from a build that found no keyring. Seal it now that sealing needs no keyring.
		await reseal(id, entry.token);
		return entry.token;
	}

	const legacy = await legacyKeychain();
	if (!legacy) return null;
	try {
		const token = legacy.decrypt(Buffer.from(entry.token, "base64"));
		await reseal(id, token);
		return token;
	} catch {
		/*
		 * The keychain will not open what it wrote, which on macOS means the app was updated: the
		 * entry is bound to the code identity that created it, and an ad-hoc signed build gets a new
		 * one every release. This is the case the vault exists to end — but it cannot recover a token
		 * already lost to it.
		 *
		 * Null rather than a throw: the caller turns it into "this account needs signing in again",
		 * which is both true and actionable, where a decryption stack trace is neither.
		 */
		return null;
	}
}

/** Rewrite one account's token in the current format, leaving everything else alone. */
function reseal(id: string, token: string): Promise<void> {
	return change(async () => {
		const file = await read();
		const at = file.entries.findIndex((e) => e.account.id === id);
		if (at < 0) return;
		const entries = [...file.entries];
		entries[at] = { ...entries[at], token: await seal(token), encrypted: true };
		await write({ version: 1, entries });
	});
}

/** Save an account and its token, replacing whatever was filed under the same id. */
export function saveAccount(account: ForgeAccount, token: string): Promise<void> {
	return change(async () => {
		const file = await read();
		const entry: StoredEntry = { account, token: await seal(token), encrypted: true };

		const at = file.entries.findIndex((e) => e.account.id === account.id);
		const entries = [...file.entries];
		if (at < 0) entries.push(entry);
		else entries[at] = entry;
		await write({ version: 1, entries });
	});
}

/** Change what is known about an account without touching its token. */
export function updateAccount(id: string, patch: Partial<ForgeAccount>): Promise<ForgeAccount | null> {
	return change(async () => {
		const file = await read();
		const at = file.entries.findIndex((e) => e.account.id === id);
		if (at < 0) return null;

		const account = { ...file.entries[at].account, ...patch, id };
		const entries = [...file.entries];
		entries[at] = { ...file.entries[at], account };
		await write({ version: 1, entries });
		return account;
	});
}

export function removeAccount(id: string): Promise<void> {
	return change(async () => {
		const file = await read();
		const entries = file.entries.filter((entry) => entry.account.id !== id);
		if (entries.length !== file.entries.length) await write({ version: 1, entries });
	});
}
