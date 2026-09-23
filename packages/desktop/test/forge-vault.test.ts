/**
 * Forge tokens surviving an update, which is the whole point of moving them off the keychain.
 *
 * The failure being fixed: macOS builds are ad-hoc signed, so each release has a different code
 * identity, and a keychain entry is bound to the identity that wrote it. Signing in to GitHub was
 * therefore something you did after every update. See `config/vault.ts` in core.
 *
 * Three shapes can be on disk, and all three have to be handled without asking anyone to sign in
 * again to complete a migration whose purpose is to stop asking:
 *
 *   - sealed by the vault — the ordinary case now
 *   - plaintext — what a machine with no keyring got from the old code
 *   - sealed by the keychain — every macOS install written before this change
 *
 * The first two are covered here. The third needs Electron's `safeStorage`, which does not exist
 * in this process — `legacyKeychain()` returns null, and the token reads as needing a fresh
 * sign-in, which is exactly what it does on a machine whose keychain has stopped answering.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

import { isSealed, resetVault, seal } from "@lyra/core";

import { saveAccount, tokenFor } from "../electron/forge/vault.ts";
import type { ForgeAccount } from "../electron/forge/types.ts";

let home: string;
const made: string[] = [];
const previous = { home: process.env.LYRA_HOME, userProfile: process.env.USERPROFILE };

/**
 * A whole account, because the store validates what it reads.
 *
 * `parseAccounts` drops an entry it cannot make sense of, and drops the token with it — so a
 * half-built fixture reads back as "no such account" and looks exactly like the bug these tests
 * are about. `baseUrl` and `kind` are the two it will not do without.
 */
const account: ForgeAccount = {
	id: "acc-1",
	kind: "github",
	label: "someone · github.com",
	baseUrl: "https://github.com",
	login: "someone",
	avatarUrl: null,
	addedAt: 1,
	enabled: true,
};

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-forge-"));
	made.push(home);
	process.env.LYRA_HOME = home;
	process.env.USERPROFILE = home;
	resetVault();
	// The forge store caches the file it read; the next test's is a different file entirely.
	const module = await import("../electron/forge/vault.ts");
	module.resetForgeStore();
});

after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	if (previous.userProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = previous.userProfile;
	await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The stored file, as a test that wants to inspect the format reads it. */
async function stored(): Promise<{ entries: { account: ForgeAccount; token: string; encrypted: boolean }[] }> {
	return JSON.parse(await readFile(join(home, "forges.json"), "utf8"));
}

test("a saved token comes back, and is not written down in the clear", async () => {
	await saveAccount(account, "ghp_not_a_real_token");

	const file = await stored();
	assert.equal(file.entries.length, 1);
	assert.ok(isSealed(file.entries[0].token), "the token was not sealed");
	assert.ok(!file.entries[0].token.includes("ghp_not_a_real_token"), "the plaintext is in the file");

	assert.equal(await tokenFor("acc-1"), "ghp_not_a_real_token");
});

test("the file stays 0600", async () => {
	// Windows NTFS does not support POSIX file mode bits (reports 0666)
	if (process.platform === "win32") return;
	await saveAccount(account, "ghp_not_a_real_token");
	const mode = (await stat(join(home, "forges.json"))).mode & 0o777;
	assert.equal(mode, 0o600, `forges.json is ${mode.toString(8)}`);
});

test("a plaintext token from a machine with no keyring is read, then sealed in place", async () => {
	// What the old code wrote when `safeStorage` reported no encryption available.
	await writeFile(
		join(home, "forges.json"),
		JSON.stringify({ version: 1, entries: [{ account, token: "ghp_written_in_the_clear", encrypted: false }] }),
		"utf8",
	);

	// Read once: the value has to survive, or the migration costs someone their sign-in.
	assert.equal(await tokenFor("acc-1"), "ghp_written_in_the_clear");

	// And it is no longer in the clear afterwards, without anyone having saved anything.
	const file = await stored();
	assert.ok(isSealed(file.entries[0].token), "the plaintext token was left as it was found");
	assert.equal(await tokenFor("acc-1"), "ghp_written_in_the_clear", "and it still reads back");
});

test("a token this key cannot open reads as needing a fresh sign-in, not as a crash", async () => {
	// Stands in for a keychain-sealed entry after an update: present, well-formed, unopenable.
	await writeFile(
		join(home, "forges.json"),
		JSON.stringify({ version: 1, entries: [{ account, token: "bm90IG1pbmUgdG8gb3Blbg==", encrypted: true }] }),
		"utf8",
	);

	assert.equal(await tokenFor("acc-1"), null);
});

test("a sealed token written under a different key is null rather than wrong", async () => {
	const sealed = await seal("ghp_sealed_elsewhere");
	await writeFile(
		join(home, "forges.json"),
		JSON.stringify({ version: 1, entries: [{ account, token: sealed, encrypted: true }] }),
		"utf8",
	);

	// A new key file, as if the profile had been restored without it.
	await rm(join(home, "vault.key"), { force: true });
	resetVault();
	const module = await import("../electron/forge/vault.ts");
	module.resetForgeStore();

	assert.equal(await tokenFor("acc-1"), null);
});

/*
 * What happens to accounts this build cannot read.
 *
 * Written against a real loss: `forges.json` was found holding 35 bytes —
 * `{"version":1,"entries":[]}` — where an account had been. A read that came up empty was
 * followed by an ordinary write, and the write believed it. Nothing warned, and there was nothing
 * left to recover from.
 *
 * Dropping an entry that cannot be validated is right. Writing the shortened list back over the
 * file is what turns a parse failure into a deletion, and that is what these hold.
 */

test("a file that cannot be parsed is moved aside, not overwritten", async () => {
	await writeFile(join(home, "forges.json"), "{ this is not json", "utf8");

	// Signing a new account in must not be the thing that deletes whatever was there.
	await saveAccount(account, "ghp_new_token");

	const kept = (await readdir(home)).filter((name) => name.startsWith("forges.json.unreadable-"));
	assert.equal(kept.length, 1, "the unreadable file was not preserved");
	assert.equal(await readFile(join(home, kept[0]), "utf8"), "{ this is not json");

	// And the new account is saved normally.
	assert.equal(await tokenFor("acc-1"), "ghp_new_token");
});

test("an entry this build refuses does not take the rest of the file with it", async () => {
	await writeFile(
		join(home, "forges.json"),
		JSON.stringify({
			version: 1,
			entries: [
				{ account: { ...account, id: "acc-keep" }, token: await seal("ghp_keep"), encrypted: true },
				// A shape this build cannot validate: a newer version's, or a hand edit.
				{ account: { id: "acc-strange", kind: "github" }, token: "whatever", encrypted: true },
			],
		}),
		"utf8",
	);

	// Reading is enough to notice; the write is what could have destroyed it.
	assert.equal(await tokenFor("acc-keep"), "ghp_keep");
	await saveAccount({ ...account, id: "acc-new" }, "ghp_new");

	const aside = (await readdir(home)).filter((name) => name.startsWith("forges.json.unreadable-"));
	assert.equal(aside.length, 1, "the file holding the unparseable entry was overwritten");

	const preserved = JSON.parse(await readFile(join(home, aside[0]), "utf8")) as { entries: unknown[] };
	assert.equal(preserved.entries.length, 2, "the preserved copy should still hold both entries");
});

test("an ordinary file is not moved aside — the guard only fires on damage", async () => {
	await saveAccount(account, "ghp_one");
	await saveAccount({ ...account, id: "acc-2" }, "ghp_two");

	const aside = (await readdir(home)).filter((name) => name.includes("unreadable"));
	assert.deepEqual(aside, [], "a healthy file was treated as damaged");
	assert.equal(await tokenFor("acc-1"), "ghp_one");
	assert.equal(await tokenFor("acc-2"), "ghp_two");
});

test("accounts saved at the same moment are all kept", async () => {
	/*
	 * Signing in to two hosts from two windows, or a token being resealed while another account is
	 * saved: each change read the file, sealed its token, and wrote the file back through one shared
	 * temporary name. The second write failed with ENOENT, or wrote a list that did not have the
	 * first change in it — an account that had signed in successfully and was gone on next launch.
	 */
	const ids = ["acc-1", "acc-2", "acc-3", "acc-4"];
	const results = await Promise.allSettled(ids.map((id) => saveAccount({ ...account, id }, `token-${id}`)));
	assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason)), []);

	const { resetForgeStore } = await import("../electron/forge/vault.ts");
	resetForgeStore();
	assert.deepEqual((await stored()).entries.map((entry) => entry.account.id).sort(), ids);
	for (const id of ids) assert.equal(await tokenFor(id), `token-${id}`);
	assert.deepEqual((await readdir(home)).filter((name) => name.endsWith(".tmp")), []);
});
