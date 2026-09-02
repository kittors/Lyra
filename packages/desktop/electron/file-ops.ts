/**
 * The rules a file operation has to obey, with none of the operations in them.
 *
 * Everything here is a pure function of strings, which is the point: these are the parts that can
 * be wrong in a way no manual click-through would catch — a boundary check that a `..` walks
 * straight through, a name the filesystem will not take, a directory dragged into its own child.
 * Kept out of the IPC file so `node --test` can import them without an Electron process.
 */

import { isAbsolute, relative, resolve } from "node:path";

/**
 * The deepest root containing `target`, with both sides resolved — or null.
 *
 * Returning the deepest match matters when one open project lives inside another: configuration
 * searches belong to the inner project and must stop at its boundary. Containment is answered by
 * `path.relative()`, not a string prefix, because Windows paths use backslashes and compare drive
 * letters case-insensitively.
 */
export function containingRoot(target: string, roots: readonly string[]): string | null {
	if (typeof target !== "string" || target === "" || !isAbsolute(target)) return null;
	if (target.includes("\0")) return null;

	const full = resolve(target);
	let deepest: string | null = null;
	for (const root of roots) {
		if (!root || !isAbsolute(root) || root.includes("\0")) continue;
		const base = resolve(root);
		const rel = relative(base, full);
		if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) continue;
		if (deepest === null || base.length > deepest.length) deepest = base;
	}
	return deepest;
}

/**
 * The path, normalised, if it lies inside one of the roots — otherwise null.
 *
 * Normalising *before* comparing is the whole job. The check this replaces compared the raw
 * string, and `/work/app/../../etc/passwd` starts with `/work/app/` — so every handler guarded by
 * it could be walked out of the project with three characters. Reading a file that way is a leak;
 * with rename and delete on the same doorway it is considerably worse.
 *
 * Absolute only. A relative path would be resolved against whatever the main process happens to
 * have as its cwd, which is not a location the renderer should be able to name at all.
 *
 * Checks containment via `path.relative()`: on Windows, raw prefix matching fails because
 * separators (`\` vs `/`) and drive letter casing (`C:` vs `c:`) differ.
 */
export function resolveInside(target: string, roots: readonly string[]): string | null {
	if (containingRoot(target, roots) === null) return null;
	return resolve(target);
}

/**
 * Whether `child` lies below `parent`. Strict: a path is not its own descendant.
 *
 * What stops a directory being dropped into itself. `relative` aware so `/a/bc` must not count as being under `/a/b`.
 */
export function isDescendant(parent: string, child: string): boolean {
	const from = resolve(parent);
	const to = resolve(child);
	const rel = relative(from, to);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Names Windows refuses whatever extension follows them; a file called `con.txt` cannot exist. */
const RESERVED = new Set([
	"con",
	"prn",
	"aux",
	"nul",
	...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
	...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Illegal in a Windows filename; legal, if unwise, everywhere else. */
const WINDOWS_ILLEGAL = /["*:<>?|]/;

/**
 * Why this name cannot be used, or null if it can.
 *
 * Checked here rather than by letting the filesystem refuse, because the message matters: `EINVAL`
 * tells the person renaming a file nothing, and the rename dialog is where they can still fix it.
 *
 * The Windows rules are applied on Windows only, but they are applied — a project synced between
 * machines does not stop being one because the name was typed on a Mac.
 */
export function validateName(name: string, platform: string = process.platform): string | null {
	if (name === "") return "名字不能为空";
	if (name !== name.trim()) return "名字前后不能有空格";
	if (name === "." || name === "..") return "不能用 . 或 .. 作为名字";
	if (name.includes("\0")) return "名字里有不允许的字符";
	if (name.includes("/")) return "名字里不能有 /";
	// Rejected on every platform: it is a separator on Windows, and a name carrying one would mean
	// two different paths depending on where the project is opened.
	if (name.includes("\\")) return "名字里不能有 \\";
	// The limit is per component on every filesystem worth naming, and it is counted in bytes —
	// which is four per character for an emoji and three for most Chinese.
	if (Buffer.byteLength(name, "utf8") > 255) return "名字太长";

	if (platform === "win32") {
		if (WINDOWS_ILLEGAL.test(name)) return '名字里不能有 " * : < > ? |';
		if (name.endsWith(".")) return "名字不能以点结尾";
		const stem = name.split(".")[0]?.toLowerCase() ?? "";
		if (RESERVED.has(stem)) return `${name} 是系统保留名`;
	}
	return null;
}

/**
 * Split a filename into the part you would rename and the part you would keep.
 *
 * The last dot, not the first: `archive.tar.gz` is a `.gz`, and someone renaming it means to
 * retype `archive.tar`. A leading dot is not a separator — `.env` is entirely a name — which is
 * the case that a naive `split(".")` gets wrong and then silently produces `" copy.env"`.
 */
export function splitExtension(name: string): [stem: string, extension: string] {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * A name like `name` that nothing in `taken` already uses.
 *
 * `report.md` → `report copy.md` → `report copy 2.md`, which is what the Finder and VS Code both
 * do. Pasting into the folder you copied from is the ordinary case, not an error to refuse.
 */
export function uniqueName(taken: Iterable<string>, name: string): string {
	const used = new Set(taken);
	if (!used.has(name)) return name;

	const [stem, extension] = splitExtension(name);
	const first = `${stem} copy${extension}`;
	if (!used.has(first)) return first;

	// From 2, so the sequence reads copy, copy 2, copy 3 — there is no "copy 1".
	for (let n = 2; ; n++) {
		const candidate = `${stem} copy ${n}${extension}`;
		if (!used.has(candidate)) return candidate;
	}
}
