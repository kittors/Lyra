/**
 * Where a picture in a Markdown file actually lives.
 *
 * A README says `<img src="assets/lyra.png">` and means "next to me". Nothing in the renderer knows
 * where "me" is — the component is handed a string of text, not a file — so the pane that opened the
 * file passes its directory down and this turns the pair into an absolute path.
 *
 * Plain `.ts`, and no `node:path`: the renderer has neither, and this is exactly the kind of code
 * that is wrong on Windows in a way nobody notices until someone opens a README there. Tested.
 */

/** Which separator this path is written with. A Windows path keeps its backslashes. */
function separatorOf(dir: string): string {
	return dir.includes("\\") && !dir.startsWith("/") ? "\\" : "/";
}

/** An absolute path, on either platform: `/a/b`, `C:\a\b`, `C:/a/b`, or a UNC share. */
export function isAbsolutePath(target: string): boolean {
	return target.startsWith("/") || target.startsWith("\\\\") || /^[a-zA-Z]:[/\\]/.test(target);
}

/**
 * The directory a file is in.
 *
 * `node:path` is not available in the renderer and this is the one thing the panes need from it —
 * a file's own folder, to hand to `resolveAsset` as the base its pictures are relative to.
 */
export function directoryOf(path: string): string {
	const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (cut < 0) return "";
	// The root itself: `/README.md` lives in `/`, not in the empty string.
	return cut === 0 ? path.slice(0, 1) : path.slice(0, cut);
}

/**
 * What `src` refers to, given the directory of the file it was written in.
 *
 * Returns null for anything that is not a path into the filesystem — a URL, a data URI, a bare
 * fragment — because those have their own handling and guessing at a file for them would produce a
 * path that happens to exist about as often as it does not.
 */
export function resolveAsset(dir: string | undefined, src: string): string | null {
	if (!dir) return null;

	const raw = src.trim();
	/*
	 * A scheme, a protocol-relative URL, or a fragment: not this file's business.
	 *
	 * The absolute check comes first because `C:\pictures\a.png` matches the scheme pattern — one
	 * letter, then a colon — and a Windows drive read as a protocol is a picture that never draws
	 * on the one platform nobody here is testing on by hand.
	 */
	if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;
	if (!isAbsolutePath(raw) && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;

	/*
	 * `?raw=true` and `#gh-dark-mode-only` are addressed to GitHub, not to the disk.
	 *
	 * Both are ordinary in a README — the second is how a project ships a light and a dark logo —
	 * and left on the end they become part of the filename, which then does not exist.
	 */
	const path = decodeURI(raw.split("#")[0].split("?")[0]).trim();
	if (!path) return null;

	const separator = separatorOf(dir);
	if (isAbsolutePath(path)) return normalise(path, separatorOf(path));

	const base = dir.endsWith(separator) ? dir.slice(0, -1) : dir;
	return normalise(`${base}${separator}${path}`, separator);
}

/**
 * `.` and `..` resolved by hand.
 *
 * The media protocol's own check resolves the path again before serving it, so this is not the
 * boundary — but a `..` left in the string would be a path that reads differently here and there,
 * and two readings of one path is how a check gets walked around.
 */
function normalise(path: string, separator: string): string {
	const parts = path.split(/[/\\]/);
	// A leading empty part is the root (`/a`), and on a UNC path there are two. Both are kept.
	const lead = /^([/\\]*)/.exec(path)?.[1] ?? "";
	const out: string[] = [];

	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") {
			out.pop();
			continue;
		}
		out.push(part);
	}

	return lead.replace(/[/\\]/g, separator) + out.join(separator);
}
