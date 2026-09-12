/**
 * Plugin registries: a URL that lists installable bundles.
 *
 * Deliberately the plainest thing that works — one JSON document, fetched over HTTPS, listing
 * entries with a name, a description and a git URL. There is no protocol to implement and no
 * server to run: a registry can be a file in a GitHub repo, which is what the existing skill
 * collections already are.
 *
 * Nothing is executed at browse time. An entry is a description of where a bundle lives; it
 * becomes code on disk only when the user installs it, and even then a plugin is data — skills
 * are markdown, MCP servers are declarations the user still has to enable.
 */

import type { Dirent } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { normalisePath, readIndex } from "@lyra/registry-shared";
import type { BundleKind, RegistryEntry } from "@lyra/registry-shared";

import type { McpServerConfig } from "../mcp/client.ts";
import { lyraHome } from "../session/store.ts";
import { fetchBundle } from "./fetch-bundle.ts";
import { forgetInstall, recordInstall } from "./installs.ts";
import { inspectBundle } from "./loader.ts";

/*
 * What an entry is and what an index may say about one now live in `@lyra/registry-shared`.
 *
 * They were defined here, which was right while the app was the only thing that read an index. It
 * stopped being right when the platform started serving them: the worker cannot import from a
 * package that reaches for `node:child_process` on line one, so it would have needed its own copy
 * — and two copies of a contract are two contracts, with the one nobody compiles doing the drifting.
 *
 * Re-exported rather than replaced at every call site: the renderer imports these from `@lyra/core`
 * in a dozen places, and moving a type is not a reason to touch a dozen files.
 */
// `ClientId` too: the desktop package depends on core alone, and a card that shows which agents a
// bundle installs into needs the type. Adding a second dependency to reach one alias would be a
// wider change than re-exporting it beside the entry type it is a field of.
export type { BundleKind, ClientId, RegistryEntry } from "@lyra/registry-shared";

/** How long a registry has to answer before we give up on it. */
const FETCH_TIMEOUT_MS = 10_000;
/** A registry index has no business being larger than this; anything more is a mistake or an attack. */
const MAX_INDEX_BYTES = 2_000_000;

export interface Registry {
	url: string;
	name: string;
	entries: RegistryEntry[];
}

/**
 * Read a registry index.
 *
 * Accepts either `{ name, plugins: [...] }` or a bare array, because the collections in the
 * wild are split roughly evenly between the two and requiring one would rule out half of them
 * for no benefit.
 */
export async function fetchRegistry(url: string, signal?: AbortSignal): Promise<Registry> {
	if (!/^https:\/\//i.test(url)) throw new Error("插件市场地址必须是 https");

	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const response = await fetch(url, {
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error(`市场返回 ${response.status}`);

	const size = Number(response.headers.get("content-length") ?? 0);
	if (size > MAX_INDEX_BYTES) throw new Error("市场索引过大");

	const raw: unknown = await response.json();
	const index = readIndex(raw);
	// An index that did not name itself is known by where it was fetched from, which is at least true.
	return { url, name: index.name ?? hostOf(url), entries: index.entries };
}

/** Where each kind of bundle lives once installed. */
export function bundleRoot(kind: BundleKind): string {
	if (kind === "mcp") return join(lyraHome(), "mcp");
	// Skills go where loose skills already are, so nothing has to know they came from a registry.
	if (kind === "skill") return join(lyraHome(), "skills");
	return join(lyraHome(), "plugins");
}

export interface Installed {
	dir: string;
	/** Decided by reading the clone, not by what the index claimed. */
	kind: BundleKind;
	/** For an MCP bundle: what it declares, stamped with where it came from. */
	servers: McpServerConfig[];
	name: string;
}

/**
 * Install an entry, then file it by what it turned out to be.
 *
 * How the files arrive is `fetchBundle`'s problem: a verified archive when the registry publishes
 * one, a shallow clone otherwise or when the download fails. The two differ in one way that
 * matters here — an archive was built for this entry and is already rooted at its sub-path, while
 * a clone is the whole repository and has to be descended into.
 *
 * Everything lands in staging first — including the case with no `path`, which used to clone
 * straight to its destination. It cannot go straight there any more, because where it belongs is
 * a question about its contents: a directory holding nothing but a `.mcp.json` is an MCP server,
 * and putting it among the plugins is how the catalogue ended up advertising seven MCP servers as
 * plugins. `kind` on the entry is only what the index *claims*; this is what it is.
 *
 * `path` is what makes a collection possible. Without it every bundle needs a repository of its
 * own, which is a lot of ceremony for a manifest and one markdown file. The named subdirectory is
 * what gets kept; the rest, including the `.git` that would otherwise make a subdirectory look
 * like a checkout of the whole collection, is thrown away.
 */
export async function installEntry(entry: RegistryEntry, registryName?: string, replace = false): Promise<Installed> {
	// Shared with the platform, so that a path it accepted when building an archive is the same path
	// this refuses to clone into. Two implementations of "cannot climb out" is one too many.
	const inner = normalisePath(entry.path);
	if (inner === null) throw new Error(`插件路径不合法：${entry.path}`);

	/*
	 * `replace` is what an update is, and it is safe for the same reason a first install is.
	 *
	 * Everything lands in staging and is inspected there; the target directory is not touched until
	 * a complete, verified bundle is sitting beside it. So a failed update — a dead network, a
	 * corrupt archive, a repository that has stopped being a plugin — leaves what is installed
	 * exactly as it was. The alternative people usually write, uninstall-then-install, has a window
	 * in the middle where the user has neither version.
	 */
	if (!replace) {
		for (const kind of ["plugin", "mcp"] as const) {
			const root = bundleRoot(kind);
			if ((await readdir(root).catch((): string[] => [])).includes(entry.id)) {
				throw new Error(`已经装过 ${entry.id} 了`);
			}
		}
		/*
		 * And a collection, which has no directory to look for — only its prefix among the loose
		 * skills.
		 *
		 * Without this the same collection could be installed twice: the second run overwrites every
		 * skill it still ships and silently leaves behind the ones it has since dropped, which is a
		 * worse state than either version.
		 */
		if (entry.kind === "skill") {
			const loose = await readdir(bundleRoot("skill")).catch((): string[] => []);
			if (loose.some((name) => name.startsWith(`${entry.id}-`))) throw new Error(`已经装过 ${entry.id} 了`);
		}
	}

	// Beside the eventual target rather than in the OS temp dir: same filesystem, so the move is a
	// rename rather than a copy, and a crash leaves the debris somewhere we already clean up.
	const staging = join(lyraHome(), "plugins", `.${entry.id}.staging`);
	await mkdir(join(lyraHome(), "plugins"), { recursive: true });
	await rm(staging, { recursive: true, force: true });

	try {
		const fetched = await fetchBundle(entry, staging);

		/*
		 * An archive is already the bundle; a clone is the repository it lives in.
		 *
		 * The platform applies `path` when it builds, so descending into it again would look for
		 * `plugins/context7/plugins/context7` and find nothing. Getting this backwards is silent in
		 * one direction and a confusing "no such directory" in the other.
		 */
		const source = fetched.via === "tarball" || !inner ? staging : join(staging, inner);
		if (fetched.via === "git" && inner && !(await stat(source).catch(() => null))?.isDirectory()) {
			throw new Error(`仓库里没有 ${entry.path} 这个目录`);
		}

		/*
		 * A skill collection is checked differently, because it is not a bundle.
		 *
		 * `inspectBundle` looks for a manifest and then for what the manifest points at — the right
		 * question for a plugin, and the wrong one here: a collection is a directory of `SKILL.md`
		 * folders and nothing else. It has no manifest and needs none, which is exactly why it goes
		 * straight into the skills directory rather than being wrapped in one.
		 *
		 * So the check is the honest version of the same question: does this directory actually hold
		 * skills? An index that pointed at the wrong sub-path would otherwise install an empty folder
		 * and report success.
		 */
		if (entry.kind === "skill") {
			const skills = await countSkills(source);
			if (skills === 0) throw new Error("这个目录里没有技能（应当是一层含 SKILL.md 的子目录）");
			const root = bundleRoot("skill");
			/*
			 * Clear the old scatter before laying down the new one.
			 *
			 * `moveInto` overwrites each skill it still ships and cannot know about the ones this
			 * version dropped — those would stay in the skills directory forever, loaded into every
			 * session, belonging to a version of the collection nobody has any more. A plugin does
			 * not have this problem because its whole directory is replaced at once.
			 *
			 * Done here rather than before the download: by this point the new files are staged and
			 * verified, so the window in which the collection is half-removed is one rename wide.
			 */
			if (replace) await removeCollection(entry.id);
			await moveInto(source, root, entry.id);
			await remember(entry, registryName);
			// `dir` is the directory the skills went into; a collection has no directory of its own.
			return { dir: root, kind: "skill", servers: [], name: `${entry.name}（${skills} 个技能）` };
		}

		const found = await inspectBundle(source);
		if (found.kind === "none") {
			throw new Error(found.error ?? "这个仓库里没有可安装的技能或 MCP 服务");
		}

		const root = bundleRoot(found.kind);
		await mkdir(root, { recursive: true });
		const target = join(root, entry.id);
		await rm(target, { recursive: true, force: true });
		/*
		 * The checkout goes; the files stay.
		 *
		 * An entry with a `path` never had this problem — only the named subdirectory is moved, so the
		 * `.git` beside it is left in staging and swept up with everything else. An entry without one
		 * moves the whole clone, and used to move the repository with it: `~/.lyra/plugins/demo` came
		 * out a working tree of somebody else's project. That is a real thing in the user's home
		 * directory, not a tidiness point — anything that walks upward looking for a repository finds
		 * it, `git status` one directory too high reports on it, and a shallow clone's history is
		 * weight nobody asked to keep.
		 *
		 * Unconditional rather than gated on `via === "git"`. An archive should not contain one either,
		 * and if it does, it is even less welcome.
		 */
		await rm(join(source, ".git"), { recursive: true, force: true });
		await rename(source, target);
		await remember(entry, registryName);

		return {
			dir: target,
			kind: found.kind,
			name: found.manifest.interface?.displayName ?? found.manifest.name ?? entry.name,
			servers:
				found.kind === "mcp"
					? found.servers.map((server) => ({
							...server,
							origin: { bundle: entry.id, registry: registryName, version: found.manifest.version },
						}))
					: [],
		};
	} catch (cause) {
		throw new Error(`安装失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/**
 * Note what this was, so a later visit can tell it apart from what the registry now offers.
 *
 * Failing to write the ledger must not fail the install: the files are already in place and the
 * bundle works. What is lost is the update badge, which is worth less than the bundle.
 */
async function remember(entry: RegistryEntry, registryName?: string): Promise<void> {
	await recordInstall({
		id: entry.id,
		version: entry.version,
		commit: entry.commit,
		sha256: entry.sha256,
		from: registryName,
		installedAt: new Date().toISOString(),
	}).catch(() => undefined);
}

/**
 * Drop an installed bundle, whichever of the two directories it lives in.
 *
 * Both are cleared rather than asking the caller which kind it was: an id is unique across the
 * pair (installing checks both), and a bundle that predates the split may still be filed under
 * the other one. Removing what its servers left in settings is the caller's half — see
 * `McpOrigin`.
 */
export async function uninstallEntry(id: string): Promise<void> {
	if (!id || id.includes("/") || id.includes("..")) throw new Error("非法的插件 id");
	await rm(join(bundleRoot("plugin"), id), { recursive: true, force: true });
	await rm(join(bundleRoot("mcp"), id), { recursive: true, force: true });

	// And a collection's skills, which are not under either root. Removing only the two left a
	// collection uninstalled everywhere except in the agent, which went on loading all of them.
	await removeCollection(id);

	// Last, and allowed to fail: a stale ledger entry is harmless because every reader joins it
	// against what the scan actually found, while a bundle whose files are gone is uninstalled.
	await forgetInstall(id).catch(() => undefined);
}

/**
 * Remove the skills a collection scattered, which have no directory of their own.
 *
 * `moveInto` flattened them in among the loose skills with an `<id>-` prefix, so this is the same
 * rename read backwards. Shared with the replace path in `installEntry`, because an update that
 * left the previous version's dropped skills behind would be the same bug in a different place.
 *
 * The prefix has to be followed by something: a skill genuinely named `waza` is not one of Waza's,
 * and removing it would be deleting a directory the user put there themselves.
 */
async function removeCollection(id: string): Promise<void> {
	const skills = bundleRoot("skill");
	for (const entry of await readdir(skills, { withFileTypes: true }).catch((): Dirent[] => [])) {
		if (entry.isDirectory() && entry.name.startsWith(`${id}-`)) {
			await rm(join(skills, entry.name), { recursive: true, force: true });
		}
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** How many `SKILL.md` folders a directory holds, one level down. */
async function countSkills(dir: string): Promise<number> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	let found = 0;
	for (const item of entries) {
		if (!item.isDirectory()) continue;
		const marker = await stat(join(dir, item.name, "SKILL.md")).catch(() => null);
		if (marker?.isFile()) found += 1;
	}
	return found;
}

/**
 * Put each skill directly among the loose skills, prefixed with where it came from.
 *
 * Not nested under a folder named after the collection: `loadSkills` reads one level, so a
 * collection dropped in whole would be invisible. The prefix is what keeps two collections that
 * both ship a `review` from overwriting each other, and it is also the only trace of provenance a
 * flat directory can carry.
 */
async function moveInto(source: string, root: string, collection: string): Promise<void> {
	await mkdir(root, { recursive: true });
	for (const item of await readdir(source, { withFileTypes: true })) {
		if (!item.isDirectory()) continue;
		const marker = await stat(join(source, item.name, "SKILL.md")).catch(() => null);
		if (!marker?.isFile()) continue;
		const target = join(root, `${collection}-${item.name}`);
		await rm(target, { recursive: true, force: true });
		await rename(join(source, item.name), target);
	}
}
