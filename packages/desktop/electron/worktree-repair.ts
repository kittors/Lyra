/**
 * Filing worktree conversations from before `SessionMeta.worktree` under the project they came from.
 *
 * Until that field existed (ADR-0038) a conversation's worktree was made beside its repository — or
 * under `worktrees.rootDir` when one was set — as `<repo>-<id8>` on branch `lyra/session-<id8>`, and
 * nothing recorded where it came from. The sidebar files a conversation by where it runs, so each one
 * opened a group of its own under the project's name again; and the folder was outside every root the
 * window may read, so its file tree came up empty (`worktree-roots.ts` is the other half of the fix).
 * This recognises them by the worktree itself and writes the field.
 *
 * Through `move`, which leaves `updatedAt` alone: filing a conversation is not using it, and a repair
 * that stamped the time would lift every old worktree conversation to the top of the list at once.
 *
 * At every start, in the background, with no marker kept: a candidate is a conversation running
 * outside every registered folder and scratch root with no `worktree` yet — a handful at most, and
 * once filed it is no longer one. One that cannot be recognised is left exactly as it is.
 */

import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { projectIdFor, type SessionMeta, type SessionStorage, type Settings } from "@lyra/core";
import { projectFolders } from "@lyra/core/project-folders";
import { containingRoot } from "./file-ops.ts";
import { git } from "./git-exec.ts";
import { pathKey, samePath } from "./path-key.ts";

/** Every conversation worktree's branch: `lyra/session-<id8>`, in both old layouts and the new one. */
const SESSION_BRANCH = "lyra/session-";

/**
 * `<repo>-<id8>`, the folder name both old layouts used. Eight of `[0-9a-z]` rather than hex: a
 * scheduled run named its worktree from a throwaway base-36 id, not from the conversation's UUID.
 */
const LEGACY_FOLDER = /^(.+)-([0-9a-z]{8})$/;

/** A registered folder, and the name of the project it belongs to. */
export interface RegisteredFolder {
	path: string;
	name: string;
}

/** What an old conversation folder turned out to be. */
export interface LegacyWorktree {
	/** The repository's main checkout — the parent of its common git directory — as git spells it. */
	repoRoot: string;
	/** The git directory every checkout of the repository shares; what "the same repository" means here. */
	commonDir: string;
	branch: string;
}

/** Every folder of every registered project, spelled as registered: the spelling the sidebar files by. */
export function registeredFolders(settings: Pick<Settings, "projects">): RegisteredFolder[] {
	return (settings.projects ?? []).flatMap((project) => projectFolders(project).map((path) => ({ path, name: project.name || basename(path) })));
}

/**
 * The conversations worth asking git about: no `worktree` yet, and running outside every root given.
 *
 * Whatever runs in a registered folder or a scratch directory is already filed where it belongs, and
 * leaving it out keeps the start-up cost to a few git calls however long the history is. `key` makes
 * two spellings of one folder compare equal (`pathKey` in the app; plain `resolve` by default).
 *
 * The plain comparison goes first: nearly every conversation runs in a folder spelled exactly as it
 * was registered, and `pathKey` is a synchronous `realpath` — thousands of them would hold up the main
 * process for nothing.
 */
export function repairCandidates(sessions: readonly SessionMeta[], roots: readonly string[], key: (path: string) => string = resolve): SessionMeta[] {
	const given = roots.filter(Boolean);
	// One argument each: `resolve` would take `map`'s index and array as more segments.
	const keyed = given.map((root) => key(root));
	return sessions.filter(
		(meta) => !meta.worktree && isAbsolute(meta.cwd) && containingRoot(meta.cwd, given) === null && containingRoot(key(meta.cwd), keyed) === null,
	);
}

/**
 * Where a recognised worktree conversation is filed, when the folder it started in does not settle it.
 *
 * The registered folder that is the repository's root; else the only registered folder inside the
 * repository (a project that is one package of it); else the root itself — a group named after the
 * repository, still the right one, where two packages are registered and nothing says which. The
 * registered spelling is kept: the sidebar looks groups up by that exact string, and git's spelling
 * of the same folder (`/private/var/…` for `/var/…`) would open a second group beside the project.
 */
export function pickHome(repoRoot: string, folders: readonly RegisteredFolder[], key: (path: string) => string = resolve): RegisteredFolder {
	const root = key(repoRoot);
	const exact = folders.find((folder) => key(folder.path) === root);
	if (exact) return exact;
	const inside = folders.filter((folder) => containingRoot(key(folder.path), [root]) !== null);
	if (inside.length === 1) return inside[0];
	return { path: repoRoot, name: basename(repoRoot) };
}

/**
 * The worktree a conversation's folder is, when Lyra made it for a conversation; null otherwise.
 *
 * A linked worktree's `.git` is a file pointing into `<repo>/.git/worktrees/<name>`, and it has to be
 * on a `lyra/session-` branch. A submodule's `.git` is a file too, pointing into `.git/modules/` — work
 * in it is the user's own — and a worktree somebody made by hand is on a branch of their own: neither
 * is ours to refile. A folder that is gone is inferred from where it was (`inferRemovedWorktree`).
 */
export async function readLegacyWorktree(cwd: string): Promise<LegacyWorktree | null> {
	const dotGit = await lstat(join(cwd, ".git")).catch(() => null);
	if (!dotGit) {
		const missing = await lstat(cwd).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT");
		return missing ? inferRemovedWorktree(cwd) : null;
	}
	if (!dotGit.isFile()) return null;
	const pointer = await readFile(join(cwd, ".git"), "utf8").catch(() => "");
	if (!/^\s*gitdir:\s*.*[/\\]worktrees[/\\]/m.test(pointer)) return null;
	const [common, head] = await gitLines(cwd, ["rev-parse", "--git-common-dir", "--symbolic-full-name", "HEAD"]);
	// A detached HEAD prints `HEAD`: no branch, nothing to say whose worktree it is.
	if (!common || !head?.startsWith(`refs/heads/${SESSION_BRANCH}`)) return null;
	return mainCheckout(resolve(cwd, common), head.slice("refs/heads/".length));
}

/**
 * A conversation worktree whose folder is gone, from where it was: `<parent>/<repo>-<id8>` beside a
 * checkout `<parent>/<repo>` that still has the branch `lyra/session-<id8>`. Only the sibling layout
 * can be read back this way; under a `rootDir` there is no `<repo>` beside it and nothing is filed.
 */
async function inferRemovedWorktree(cwd: string): Promise<LegacyWorktree | null> {
	const named = LEGACY_FOLDER.exec(basename(cwd));
	if (!named) return null;
	const checkout = join(dirname(cwd), named[1]);
	const branch = `${SESSION_BRANCH}${named[2]}`;
	const [top, common] = await gitLines(checkout, ["rev-parse", "--show-toplevel", "--git-common-dir"]);
	// The top of a checkout, not a folder somewhere inside one: the worktree was made beside the top.
	if (!top || !common || !samePath(top, checkout)) return null;
	const known = await git(checkout, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
	return known ? mainCheckout(resolve(checkout, common), branch) : null;
}

/**
 * The checkout a common git directory belongs to — its parent — once git agrees that the parent is
 * the top of a working tree. A repository keeping its `.git` elsewhere (`--separate-git-dir`) has no
 * such parent, and is left alone rather than filed under a folder that is not a checkout.
 */
async function mainCheckout(commonDir: string, branch: string): Promise<LegacyWorktree | null> {
	if (basename(commonDir) !== ".git") return null;
	const repoRoot = dirname(commonDir);
	const [top] = await gitLines(repoRoot, ["rev-parse", "--show-toplevel"]);
	return top && samePath(top, repoRoot) ? { repoRoot, commonDir, branch } : null;
}

/** Git's answer as trimmed lines; none when git fails, the folder is gone or it is not a repository. */
async function gitLines(cwd: string, args: string[]): Promise<string[]> {
	const out = await git(cwd, args).catch(() => "");
	return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * The registered folder the conversation was started in, when it is still registered and is a checkout
 * of the same repository.
 *
 * A conversation's `projectId` is the hash of the folder it was created in (`projectIdFor`), and its
 * worktree was cut from there. That settles what the root-first rules of `pickHome` cannot: a
 * repository registered both whole and by package, or a project that is itself a worktree of the
 * repository. A scheduled run's id was hashed from the worktree, matches no folder, and falls through.
 */
async function startedIn(meta: SessionMeta, found: LegacyWorktree, folders: readonly RegisteredFolder[]): Promise<RegisteredFolder | null> {
	const folder = folders.find((one) => projectIdFor(one.path) === meta.projectId);
	if (!folder) return null;
	const [common] = await gitLines(folder.path, ["rev-parse", "--git-common-dir"]);
	return common && samePath(resolve(folder.path, common), found.commonDir) ? folder : null;
}

export interface RepairDeps {
	store: SessionStorage;
	settings: Pick<Settings, "projects">;
	/** Directories holding project-less conversations (`scratchRoots`). */
	scratch: readonly string[];
	/**
	 * Open right now. A live session keeps its meta in memory and writes it back whole with its next
	 * meta record, which would put the old name back; it is filed at the next start instead.
	 */
	busy?: (sessionId: string) => boolean;
}

/** One conversation filed, or null when it is not an old worktree conversation. */
async function repairOne(meta: SessionMeta, folders: readonly RegisteredFolder[], deps: RepairDeps): Promise<SessionMeta | null> {
	const found = await readLegacyWorktree(meta.cwd);
	if (!found) return null;
	const home = (await startedIn(meta, found, folders)) ?? pickHome(found.repoRoot, folders, pathKey);
	if (deps.busy?.(meta.id)) return null;
	/*
	 * Read again just before writing. `move` takes the folder as given, and git took a moment to ask:
	 * a conversation moved to another project meanwhile would be put back in its old worktree, and one
	 * deleted or filed meanwhile has nothing left to repair.
	 */
	const current = deps.store.get ? await deps.store.get(meta.id) : meta;
	if (!current || current.cwd !== meta.cwd || current.worktree) return null;
	// The `cwd` stays: that is where its files are. Without `base` — not known — merging back uses the repository's default branch.
	return deps.store.move(meta.projectId, meta.id, meta.cwd, home.name, { project: home.path, branch: found.branch });
}

/**
 * File every recognisable old worktree conversation; returns the ones filed. A conversation that
 * cannot be read or written is skipped and said in the log — never the reason the others are not done.
 *
 * `sessions` is the list the caller already read, when it has one; otherwise it is read here.
 */
export async function repairLegacyWorktrees(deps: RepairDeps, sessions?: readonly SessionMeta[]): Promise<SessionMeta[]> {
	const folders = registeredFolders(deps.settings);
	const roots = [...folders.map((folder) => folder.path), ...deps.scratch];
	const filed: SessionMeta[] = [];
	for (const meta of repairCandidates(sessions ?? (await deps.store.listSessions()), roots, pathKey)) {
		if (deps.busy?.(meta.id)) continue;
		try {
			const next = await repairOne(meta, folders, deps);
			if (next) filed.push(next);
		} catch (error) {
			console.warn(`[worktrees] 没能把会话 ${meta.id}（${meta.cwd}）归到原项目下：`, error);
		}
	}
	return filed;
}
