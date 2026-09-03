/**
 * Proving the bytes we downloaded are the bytes that were released.
 *
 * Until now the only checks on an update were that its URL began with `https://github.com/` and
 * that the file came out the length the release said. Both are worth having and neither says
 * anything about *content*: the first trusts the origin, the second catches a truncated download.
 *
 * What neither catches is a file that arrives complete, from the right host, and is not what was
 * built — a proxy that rewrites payloads, a cache poisoned somewhere along the way, a mirror
 * someone stood up. And this is the one download in the application that ends in code being run:
 * the package is unpacked and launched.
 *
 * So the release publishes `SHA256SUMS` alongside its artifacts, and this reads it back. The digest
 * comes from the same release as the file, over the same TLS connection, which is not a chain of
 * trust that survives a compromised GitHub account — it is not meant to. It closes everything
 * between there and here.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** The name `sha256sum` writes, and what the release workflow uploads. */
export const CHECKSUM_ASSET = "SHA256SUMS";

/**
 * Parse the output of `sha256sum *`.
 *
 * Each line is a digest, whitespace, then the name — with a `*` before the name when the file was
 * read in binary mode, which is what the workflow's runner produces. Both spellings are accepted
 * because which one appears depends on the coreutils on the runner, and a release that fails to
 * verify over an asterisk would be a very annoying way to find that out.
 *
 * Unparseable lines are skipped rather than fatal: a future release adding a comment or a blank
 * line to this file should not make the update unverifiable.
 */
export function parseChecksums(text: string): Map<string, string> {
	const digests = new Map<string, string>();
	for (const line of text.split("\n")) {
		const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
		if (match) digests.set(match[2] as string, (match[1] as string).toLowerCase());
	}
	return digests;
}

/** The SHA-256 of a file on disk, streamed so a large package does not go through memory. */
export async function sha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

export type Verdict =
	| { ok: true }
	| { ok: false; reason: "no-checksums" | "not-listed" | "mismatch"; message: string };

/**
 * Whether this file is the one the release published.
 *
 * Split from the download so the decision can be read on its own, and so the three ways it can go
 * wrong stay distinguishable. They are not the same event:
 *
 *   `no-checksums`  the release predates this feature, or the upload failed
 *   `not-listed`    the file is not one of the artifacts — a name mismatch, most likely ours
 *   `mismatch`      the bytes are wrong, and this is the one that means something
 */
export function verify(digests: Map<string, string>, name: string, actual: string): Verdict {
	if (digests.size === 0) {
		return {
			ok: false,
			reason: "no-checksums",
			message: "这个版本没有发布校验文件（SHA256SUMS），无法确认安装包是否完整。",
		};
	}
	const expected = digests.get(name);
	if (!expected) {
		return { ok: false, reason: "not-listed", message: `校验文件里没有 ${name} 这一项。` };
	}
	if (expected !== actual.toLowerCase()) {
		return {
			ok: false,
			reason: "mismatch",
			message: `安装包的校验和与发布的不一致（应为 ${expected.slice(0, 12)}…，实为 ${actual.slice(0, 12)}…）。已删除下载的文件。`,
		};
	}
	return { ok: true };
}
