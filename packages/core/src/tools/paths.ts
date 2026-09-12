import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { scratchHome } from "../runtime/previews.ts";
import { lyraHome } from "../session/store.ts";
import { home } from "../platform.ts";

function contains(root: string, absolute: string): boolean {
	const rel = relative(resolve(root), absolute);
	return rel === "" || !(rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel));
}

/**
 * Resolve a model-supplied path against the session cwd and refuse anything that escapes it.
 *
 * The model is not trusted to stay inside the workspace: `../../.ssh/id_rsa` is a normal-looking
 * argument. Every filesystem tool routes through here so the containment check exists once.
 *
 * The scratch directory is the one exception, because the system prompt sends the model there
 * for anything that should not end up in the user's repository. Refusing it would be telling the
 * model to write somewhere and then stopping it — which is exactly what happened before this,
 * and what it worked around by reaching for an MCP filesystem server instead. Only the scratch
 * subtree is opened up: `~/.lyra` itself still holds settings and transcripts, and stays shut.
 */
export function resolveWorkspacePath(cwd: string, input: string): string {
	if (!input || typeof input !== "string") throw new Error("A path is required.");
	const expanded = input.startsWith("~/") ? input.replace("~", home()) : input;
	const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
	if (contains(cwd, absolute) || contains(scratchHome(lyraHome()), absolute)) return absolute;
	throw new Error(`Path escapes the workspace root (${cwd}): ${input}`);
}

export function displayPath(cwd: string, absolute: string): string {
	const rel = relative(cwd, absolute);
	return rel === "" ? "." : rel.startsWith("..") ? absolute : rel;
}

export async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

export function imageMimeType(path: string): string | null {
	const dot = path.lastIndexOf(".");
	if (dot === -1) return null;
	return IMAGE_EXTENSIONS[path.slice(dot).toLowerCase()] ?? null;
}

/** Heuristic: a NUL byte in the first 8 KiB means the file is not text. */
export function looksBinary(buffer: Buffer): boolean {
	const limit = Math.min(buffer.length, 8192);
	for (let i = 0; i < limit; i++) if (buffer[i] === 0) return true;
	return false;
}
