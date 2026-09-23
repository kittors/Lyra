/**
 * What has changed in the working tree.
 *
 * Reads the diff itself rather than asking git to format one: the UI needs hunks it can render and
 * count, not a patch to display. Large files are capped — a generated bundle is not something
 * anyone reviews line by line, and holding it in memory helps nobody.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeDiff, type DiffHunk } from "@lyra/core";
import type { WorkspaceDiffFile } from "./ipc-types.ts";
import { readBlobs, type BlobRead } from "./git-blobs.ts";
import { git, gitBuffer, mapLimit, MAX_BLOB_BYTES, MAX_FILES } from "./git-exec.ts";
import { gitBranch, isGitRepo } from "./git.ts";
import { resolveInside } from "./file-ops.ts";

/**
 * Uncommitted changes, as the review panel shows them.
 *
 * `git status --porcelain` gives the file list; the before/after blobs come from `git show`
 * and the working tree, and the hunks are computed locally so the UI gets structured lines
 * rather than a patch it would have to parse.
 */
export async function collectWorkspaceDiff(
	cwd: string,
	base: "head" | "index" = "head",
): Promise<{ files: WorkspaceDiffFile[]; added: number; removed: number; branch: string | null }> {
	if (!(await isGitRepo(cwd))) return { files: [], added: 0, removed: 0, branch: null };

	const branch = await gitBranch(cwd);
	/*
	 * `-uall`, not the default.
	 *
	 * Left to itself, git collapses a wholly-untracked directory into a single entry — `src/`
	 * rather than the forty files under it. The panel could then only say "this directory is
	 * untracked", which is useless for the case that matters most: a new feature's worth of
	 * files that nobody has looked at yet. It also made the change bar disagree with the panel,
	 * since counting walks the real file list.
	 */
	const status = await git(cwd, ["status", "--porcelain=v1", "-uall", "-z"]).catch(() => "");
	const entries = status.split("\0").filter(Boolean);

	const changed: { path: string; beforePath: string; kind: WorkspaceDiffFile["status"] }[] = [];
	for (let i = 0; i < entries.length && changed.length < MAX_FILES; i++) {
		const entry = entries[i];
		const path = entry.slice(3);
		// Porcelain -z puts a rename's source in the next field, not in another status row.
		const renamed = /[RC]/.test(entry.slice(0, 2));
		const source = renamed ? entries[++i] : path;
		if (!path || (base === "index" && entry[1] === " ")) continue;
		changed.push({ path, beforePath: base === "head" ? source : path,
			kind: classify(base === "index" ? entry[1] : entry.slice(0, 2)) });
	}

	/*
	 * Both sides of every file, in two batches rather than two reads per file.
	 *
	 * The committed side used to be a `git show` per file, which on a repository with a couple of
	 * hundred uncommitted files is a couple of hundred process spawns — 1.8 seconds, of which the
	 * reading was a rounding error. One `cat-file --batch` answers for all of them; see
	 * `readBlobs`. The working-tree side is `readFile`, which has no such cost but is still latency
	 * worth overlapping.
	 */
	const heads = await readBlobs(
		cwd,
		changed.map((entry) => (entry.kind === "added" || entry.kind === "untracked" ? "" : `${base === "head" ? "HEAD" : ""}:${entry.beforePath}`)),
	);
	const working = await mapLimit(changed, (entry) =>
		entry.kind === "deleted" ? Promise.resolve(blank) : readWorking(cwd, entry.path),
	);

	const files: WorkspaceDiffFile[] = [];
	let totalAdded = 0;
	let totalRemoved = 0;

	changed.forEach(({ path, kind }, i) => {
		const before = kind === "added" || kind === "untracked" ? blank : sideOfBlob(heads[i]);
		const after = working[i];

		/*
		 * A file that is not text is still a file that changed.
		 *
		 * Both halves of this used to be wrong in opposite directions. The working-tree read
		 * returned null for anything with a NUL byte in it and the loop skipped the whole entry —
		 * so adding or editing an image removed it from the review, which is the one place you
		 * would go to find out that it had changed. Meanwhile nothing checked the *other* side at
		 * all, so deleting an image diffed its bytes as text: five lines of PNG header, counted as
		 * five deletions and added to the totals at the bottom of the composer.
		 *
		 * Listed and marked instead. There are no hunks and the counts stay at zero, because
		 * neither means anything here: a picture has changed or it has not.
		 */
		if (before.binary || after.binary) {
			files.push({
				path,
				status: kind,
				added: 0,
				removed: 0,
				hunks: [],
				binary: true,
				bytes: after.bytes || before.bytes,
			});
			return;
		}

		const diff = computeDiff(asCheckedOut(before.text, after.text), after.text);
		totalAdded += diff.added;
		totalRemoved += diff.removed;
		files.push({ path, status: kind, added: diff.added, removed: diff.removed, hunks: capHunks(diff.hunks) });
	});

	files.sort((a, b) => a.path.localeCompare(b.path));
	return { files, added: totalAdded, removed: totalRemoved, branch };
}

export function classify(code: string): WorkspaceDiffFile["status"] {
	if (code.includes("?")) return "untracked";
	if (code.includes("A")) return "added";
	if (code.includes("D")) return "deleted";
	if (code.includes("R")) return "renamed";
	return "modified";
}

/**
 * One side of a comparison: its text, or the fact that it has none.
 *
 * `binary` is not an error and not an absence — it is an answer, and the reason this is a record
 * rather than `string | null`. Null meant both "there is nothing here" and "there is something
 * here that is not text", and the caller could not tell a deleted file from an image.
 */
interface Side {
	text: string;
	binary: boolean;
	bytes: number;
}

const blank: Side = { text: "", binary: false, bytes: 0 };

/**
 * What git has committed for this path, from a batch read.
 *
 * Bytes, not a string, because `HEAD:logo.png` is a PNG. Decoded as UTF-8 it becomes mojibake that
 * `computeDiff` will happily count lines in — which is what put five deletions on the composer's
 * change bar for every image anybody removed.
 *
 * A blob the batch declined to read is one over the cap, which is the same answer as binary: list
 * it, say how big it is, do not diff it.
 */
function sideOfBlob(read: BlobRead | null): Side {
	if (!read) return blank;
	if (!read.content) return { text: "", binary: true, bytes: read.bytes };
	return sideOf(read.content);
}

async function readWorking(cwd: string, path: string): Promise<Side> {
	const buffer = await readFile(join(cwd, path)).catch(() => null);
	if (!buffer) return blank;
	return sideOf(buffer);
}

/**
 * Text, or not.
 *
 * A NUL byte is the same test git itself uses, and it is right for the same reason: no text
 * encoding this app will meet puts one in the middle of a document. Oversized files are treated as
 * binary too — not because they are, but because the answer downstream is identical: list it, do
 * not diff it, do not hold a megabyte of it in memory for a panel nobody reads line by line.
 */
function sideOf(buffer: Buffer): Side {
	const binary = buffer.length > MAX_BLOB_BYTES || buffer.includes(0);
	return { text: binary ? "" : buffer.toString("utf8"), binary, bytes: buffer.length };
}

/**
 * The committed text as a checkout writes it, when the file on disk shows that is what happened.
 *
 * A blob is stored normalized — LF — and Git for Windows checks out with CRLF by default
 * (`core.autocrlf`, or `eol=crlf` in `.gitattributes`). Compared as stored, every line of every
 * changed file differed, and a one-line edit was shown as the whole file rewritten. `cat-file
 * --filters` would do the conversion, but not in batch mode: there its header gives the stored size
 * while the body is the converted text, and the stream cannot be framed. So the one conversion that
 * matters is done here — only when the working file is CRLF throughout and the committed one has no
 * `\r` at all, which leaves a real change of line endings visible as the change it is.
 */
function asCheckedOut(committed: string, working: string): string {
	if (committed.includes("\r") || !working.includes("\r\n")) return committed;
	if (/\r(?!\n)|(?<!\r)\n/.test(working)) return committed;
	return committed.replaceAll("\n", "\r\n");
}

/** Keep the payload sane for files with hundreds of hunks. */
export function capHunks(hunks: DiffHunk[]): DiffHunk[] {
	return hunks.slice(0, 40);
}

/**
 * How large a binary file may be before the panel stops offering to show it.
 *
 * A data URL is base64, so it costs a third more than the file and lands in the renderer's memory
 * whole. Eight megabytes covers every screenshot, icon and diagram anybody commits; a video does
 * not need previewing in a diff panel, and a machine-learning checkpoint certainly does not.
 */
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

/** What an image or other blob needs in order to be drawn. */
export interface DiffBlob {
	dataUrl: string;
	bytes: number;
}

/**
 * Extensions the panel will draw, and what to call them on the wire.
 *
 * A closed list rather than a sniff: this produces a `data:` URL, and the mime type is what decides
 * how the renderer treats it. Guessing `image/svg+xml` for something that is not one would be
 * handing arbitrary markup to an `<img>`.
 */
const PREVIEW_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
	ico: "image/x-icon",
	icns: "image/x-icns",
	svg: "image/svg+xml",
};

export function previewType(path: string): string | null {
	const dot = path.lastIndexOf(".");
	return dot > 0 ? (PREVIEW_TYPES[path.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/**
 * One side of a binary file, as a data URL, or null.
 *
 * Null for anything this panel would not draw — the wrong kind of file, one too large to be worth
 * moving, a side that does not exist. The caller shows a mark and the file's size instead, which
 * is the honest answer for a `.zip`.
 */
export async function readDiffBlob(cwd: string, path: string, side: "head" | "work"): Promise<DiffBlob | null> {
	const type = previewType(path);
	if (!type) return null;
	const inside = resolveInside(join(cwd, path), [cwd]);
	if (!inside) return null;

	const buffer =
		side === "head"
			? await gitBuffer(cwd, ["show", `HEAD:${path}`]).catch(() => null)
			: await readFile(inside).catch(() => null);
	if (!buffer || buffer.length === 0 || buffer.length > MAX_PREVIEW_BYTES) return null;
	return { dataUrl: `data:${type};base64,${buffer.toString("base64")}`, bytes: buffer.length };
}
