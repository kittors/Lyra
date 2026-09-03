/**
 * Taking a path apart, in the renderer.
 *
 * `node:path` is not available here and must not become available: importing it would pull a Node
 * builtin into the browser bundle, which is the failure mode that leaves the window blank. These
 * are the four questions the tree actually asks — what is this called, what is it in, is this
 * inside that, and where does the extension start — and nothing more.
 *
 * Both separators are accepted when splitting, because the paths come from the main process and on
 * Windows they arrive with backslashes. Joining reuses whichever one the parent already uses, so a
 * path never ends up with one of each.
 */

const TRAILING = /[/\\]+$/;

/** The index of the last separator, whichever kind it is; -1 when there is none. */
function lastCut(path: string): number {
	return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

function separatorOf(path: string): string {
	return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/** The last segment: the file's or the folder's own name. */
export function baseName(path: string): string {
	const trimmed = path.replace(TRAILING, "");
	const cut = lastCut(trimmed);
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/** The folder a path is in. The root's parent is the root; the tree never goes above it anyway. */
export function dirName(path: string): string {
	const trimmed = path.replace(TRAILING, "");
	const cut = lastCut(trimmed);
	if (cut === -1) return trimmed;
	// A cut at 0 means the parent is the filesystem root, which is the separator itself.
	return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut);
}

export function joinPath(dir: string, name: string): string {
	const separator = separatorOf(dir);
	return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${separator}${name}`;
}

/**
 * A path as written from the project root — what "复制相对路径" copies.
 *
 * The root itself comes back as its own name rather than as an empty string: a label has to say
 * something, and "" would read as a bug.
 */
export function relativeTo(root: string, path: string): string {
	if (path === root) return baseName(root);
	const prefix = root.endsWith("/") || root.endsWith("\\") ? root : root + separatorOf(root);
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Whether `child` sits below `parent`. Strict — a path is not its own descendant.
 *
 * What stops a folder being dragged into itself. The separator is load-bearing: without it
 * `/a/bc` reads as being inside `/a/b`.
 */
export function isDescendantPath(parent: string, child: string): boolean {
	if (child === parent) return false;
	const prefix = parent.endsWith("/") || parent.endsWith("\\") ? parent : parent + separatorOf(parent);
	return child.startsWith(prefix);
}

/**
 * Split a name into the part you would retype and the part you would keep.
 *
 * The last dot, not the first: `archive.tar.gz` is a `.gz`. A leading dot is not a separator —
 * `.env` is entirely a name — which is what a rename box has to pre-select correctly.
 *
 * Deliberately a copy of the one in `electron/file-ops.ts`. Sharing it would mean the renderer
 * importing a module that imports `node:path`; five lines is the cheaper of the two prices, and
 * both sides are tested against the same cases.
 */
export function splitExtension(name: string): [stem: string, extension: string] {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * What is obviously wrong with a name being typed, or null.
 *
 * Deliberately a subset. The full rules live in the main process — Windows reserved words, the
 * 255-*byte* limit — and it is the authority: it refuses with `code: "invalid"` and says why. What
 * is checked here is only what can be judged without knowing the platform, and it is checked here
 * so that typing a slash is refused on the keystroke rather than on the return trip.
 *
 * Copying the rest down would be two lists of rules with one chance each to be updated.
 */
export function nameProblem(name: string): string | null {
	if (name.trim() === "") return "名字不能为空";
	if (name === "." || name === "..") return "不能用 . 或 .. 作为名字";
	if (name.includes("/") || name.includes("\\")) return "名字里不能有 / 或 \\";
	if (name !== name.trim()) return "名字前后不能有空格";
	return null;
}
