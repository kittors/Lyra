/**
 * Getting a bundle's files onto disk, by whichever route is available.
 *
 * There are two, and the order matters. A registry that builds its entries publishes an archive
 * with a SHA-256; downloading that is one request, it is verifiable, and it keeps working when the
 * upstream repository has been renamed, made private or deleted. A plain index in a git repo
 * publishes no such thing, so cloning stays — it is the only route that works everywhere, and it is
 * also what happens when a download fails.
 *
 * The archive is *verified* rather than trusted. The hash comes from the index over HTTPS and the
 * bytes come from the platform over HTTPS, so an attacker would need both; checking anyway costs
 * one pass over a few hundred kilobytes and turns "probably the right file" into "this file".
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

import type { RegistryEntry } from "@lyra/registry-shared";

/**
 * Run a console program to completion, without a console window.
 *
 * This runs in the Electron main process, which has no console of its own, so on Windows every
 * console program it starts without `windowsHide` gets one: a black window that flashes up and takes
 * focus, once for the clone and once for the unpack. One helper with the option built in, so the
 * next command added here cannot forget it.
 */
function run(file: string, args: string[], timeout: number): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout, windowsHide: true }, (error) => (error ? reject(error) : resolve()));
	});
}

/** How long a download has before we give up and fall back to git. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** No bundle is this large. The platform refuses to build anything over 20MB. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export interface FetchResult {
	/** Which route actually worked, for the diagnostic the caller shows. */
	via: "tarball" | "git";
	/** Set when the tarball route was tried and failed, so the fallback can be explained. */
	fellBackBecause?: string;
}

/**
 * Put the bundle's files in `staging`, and say how they got there.
 *
 * Throws only when both routes fail. A tarball that cannot be fetched or does not match its hash is
 * not fatal — it becomes a reason recorded on the result, and the clone proceeds.
 */
export async function fetchBundle(entry: RegistryEntry, staging: string): Promise<FetchResult> {
	if (entry.tarball) {
		try {
			await fromTarball(entry, staging);
			return { via: "tarball" };
		} catch (error) {
			const because = error instanceof Error ? error.message : String(error);
			/*
			 * There is not always something to fall back to.
			 *
			 * A bundle uploaded to a registry has no repository — that is what makes it private — so
			 * the archive is not the fast path, it is the only path. Cloning an empty string produces
			 * a git error about a missing URL, which reads as "the download is broken" when what
			 * actually happened is that the download failed and nothing else exists.
			 */
			if (!entry.repository) throw new Error(`取包失败：${because}`, { cause: error });

			/*
			 * Start over before cloning.
			 *
			 * A failed extraction can leave a partial tree, and cloning into a directory that already
			 * has files in it fails with a message about the directory rather than about the download.
			 */
			await rm(staging, { recursive: true, force: true });
			await fromGit(entry, staging);
			return { via: "git", fellBackBecause: because };
		}
	}

	if (!entry.repository) throw new Error("这个条目既没有下载地址也没有仓库地址");
	await fromGit(entry, staging);
	return { via: "git" };
}

async function fromGit(entry: RegistryEntry, staging: string): Promise<void> {
	await run("git", ["clone", "--depth", "1", entry.repository, staging], 60_000);
}

/**
 * Download, verify, unpack.
 *
 * Unpacked with the system `tar` rather than a parser of our own. Every platform this runs on has
 * one — macOS and Linux for decades, Windows since 10 — the main process already shells out to
 * `git` two lines above, and a tar implementation is a surprising amount of code to own for the
 * sake of avoiding a subprocess that is already there.
 */
async function fromTarball(entry: RegistryEntry, staging: string): Promise<void> {
	const url = entry.tarball!;
	if (!/^https:\/\//i.test(url)) throw new Error("下载地址不是 https");

	const response = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		headers: { accept: "application/gzip" },
	});
	if (!response.ok) throw new Error(`下载返回 ${response.status}`);

	/*
	 * The hash from the index, or the one the platform sent with the bytes.
	 *
	 * Preferring the index's is deliberate: it was fetched separately, so matching it proves the
	 * download agrees with what the catalogue advertised. The header is a fallback for a client that
	 * only has a URL, and is worth strictly less — it arrived with the thing it describes.
	 */
	const expected = entry.sha256 ?? response.headers.get("x-lyra-sha256") ?? undefined;
	await unpackVerified(new Uint8Array(await response.arrayBuffer()), expected, staging);
}

/**
 * Check an archive against its hash and unpack it, or throw without having written anything.
 *
 * Separate from the download because it is the half worth being sure about, and it is the half that
 * cannot be exercised through `fetchBundle` without standing up an HTTPS server with a certificate
 * a test process will accept. Refusing a tampered archive is a security property; a security
 * property nothing checks is a comment.
 *
 * Unpacked with the system `tar` rather than a parser of our own. Every platform this runs on has
 * one — macOS and Linux for decades, Windows since 10 — the main process already shells out to
 * `git` two lines above, and a tar implementation is a surprising amount of code to own for the
 * sake of avoiding a subprocess that is already there.
 */
export async function unpackVerified(
	archive: Uint8Array,
	expected: string | undefined,
	staging: string,
): Promise<void> {
	if (archive.length === 0) throw new Error("下载到的是空文件");
	if (archive.length > MAX_ARCHIVE_BYTES) throw new Error("下载的包过大");

	if (expected) {
		const actual = createHash("sha256").update(archive).digest("hex");
		if (actual !== expected.toLowerCase()) {
			throw new Error(`校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`);
		}
	}

	await mkdir(staging, { recursive: true });
	const file = `${staging}.tar.gz`;
	try {
		await writeFile(file, archive);
		/*
		 * `-C staging` so nothing can be written outside it even if the archive says otherwise, and
		 * no `-P`, so tar strips any leading `/` and refuses `..` on every platform's implementation.
		 */
		await run("tar", ["-xzf", file, "-C", staging], 60_000);
	} finally {
		await rm(file, { force: true });
	}
}
