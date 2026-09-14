import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

export function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

export async function fontDirectory(path: string): Promise<void> {
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || relative(resolve(path), await realpath(path)) !== "") {
		throw new Error("Unsafe font directory: symbolic links and non-directories are not allowed");
	}
}

/** The picker grants one regular file, not a symlink or a path through a linked directory. */
export async function fontSource(path: string): Promise<void> {
	if (!isAbsolute(path) || path.includes("\0")) throw new Error("Invalid font source path");
	const root = parse(path).root;
	let current = root;
	for (const part of path.slice(root.length).split(sep)) {
		if (!part || part === "." || part === "..") throw new Error("Invalid font source path");
		current = resolve(current, part);
		if ((await lstat(current)).isSymbolicLink()) throw new Error("Unsafe font source: symbolic links are not allowed");
	}
}

/** Bound allocation before reading and recheck identity to reject swapped or growing files. */
export async function readFontFile(path: string, maximum: number): Promise<Buffer> {
	await fontDirectory(dirname(path));
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("Unsafe font file: expected a single-link regular file");
	if (before.size === 0 || before.size > maximum) throw new Error(`Font file size must be between 1 and ${maximum} bytes`);
	// O_NONBLOCK avoids hanging if a regular file is replaced by a FIFO before open.
	const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const opened = await file.stat();
		if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
			throw new Error("Font file changed while opening");
		}
		const bytes = Buffer.alloc(before.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const result = await file.read(bytes, length, bytes.length - length, length);
			if (result.bytesRead === 0) break;
			length += result.bytesRead;
		}
		const after = await file.stat();
		const visible = await lstat(path);
		await fontDirectory(dirname(path));
		if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
			|| visible.isSymbolicLink() || visible.dev !== before.dev || visible.ino !== before.ino || after.nlink !== 1) {
			throw new Error("Font file changed while reading");
		}
		return bytes.subarray(0, length);
	} finally {
		await file.close();
	}
}

export async function writeFontFile(path: string, bytes: Buffer | string): Promise<void> {
	await fontDirectory(dirname(path));
	const file = await open(path, "wx", 0o600);
	try {
		await file.writeFile(bytes);
		await file.sync();
	} finally {
		await file.close();
	}
	await fontDirectory(dirname(path));
}
