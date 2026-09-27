/**
 * What an index is allowed to say about an installable thing.
 *
 * This type crosses three boundaries — the app that installs from it, the worker that serves it,
 * and the site that browses it — so it lives here rather than in any one of them. It used to live
 * in `@lyra/core`, where the worker could not reach it; two copies of a contract are two contracts,
 * and the one nobody compiles is the one that drifts.
 *
 * The shape is deliberately additive over what the file-based registry already published. Every
 * field the platform introduces is optional, because an index sitting in somebody's GitHub repo is
 * still a valid registry and always will be — the platform is a better source for the same thing,
 * not a replacement format.
 */

import { isClientId, type ClientId } from "./clients.ts";

/**
 * The three things a registry can offer, distinguished by where they land and what starts them.
 *
 * A plugin is a directory of skills the app loads. An MCP bundle is a server declaration that also
 * has to be written into settings and launched. A skill collection is a directory of `SKILL.md`
 * folders and nothing else — no manifest, no process, so it goes straight into the skills directory
 * where loose skills already live.
 */
export type BundleKind = "plugin" | "mcp" | "skill";

/** Every kind, in the order the UI lists them. Exported so nothing has to re-type the union. */
export const BUNDLE_KINDS: readonly BundleKind[] = ["plugin", "mcp", "skill"];

export function isBundleKind(value: unknown): value is BundleKind {
	return value === "plugin" || value === "mcp" || value === "skill";
}

/**
 * Where an entry stands with the platform.
 *
 * `pending` is the queue an author's submission lands in. `delisted` is not `rejected`: a rejected
 * entry never shipped, a delisted one did and is still installed on people's machines, so it keeps
 * answering downloads while disappearing from the catalogue.
 */
export type EntryStatus = "pending" | "approved" | "rejected" | "delisted";

export function isEntryStatus(value: unknown): value is EntryStatus {
	return value === "pending" || value === "approved" || value === "rejected" || value === "delisted";
}

/**
 * A value an MCP server needs from whoever installs it — an API key, a token, a connection string.
 *
 * The same shape a bundle's manifest declares under `env` (see `mcp/placeholders.ts` in core). An
 * index repeats it so a catalogue can say "needs an API key" before anything is installed; the
 * bundle's own copy is what counts once it is.
 */
export interface EntryNeed {
	name: string;
	description?: string;
	/** Where to get one. */
	url?: string;
	optional?: boolean;
}

export interface RegistryEntry {
	/** Directory name it installs as; also its identity within a registry. */
	id: string;
	name: string;
	description?: string;
	/**
	 * Git URL the bundle is cloned from — still the fallback when a tarball cannot be had.
	 *
	 * Empty for a bundle that was uploaded rather than built from a repository. Those exist only on a
	 * platform that serves a tarball, so there is nothing to fall back *to*, and inventing a URL to
	 * satisfy the field would produce a clone that 404s.
	 */
	repository: string;
	/** Sub-path within the repository, for registries that ship many bundles in one repo. */
	path?: string;
	author?: string;
	homepage?: string;
	/** Absolute URL; the browser renders it directly, so it must be http(s) or a data URL. */
	logo?: string;
	brandColor?: string;
	category?: string;
	/**
	 * What the index says this is; corrected against the clone at install time.
	 *
	 * Inferred where it is absent, because no existing index declares it: an entry naming an npm
	 * `package` is how an MCP server is distributed, and nothing else in the format implies one.
	 */
	kind: BundleKind;
	/** The npm package an MCP server is published as, when the bundle wraps one. */
	package?: string;
	version?: string;
	license?: string;

	/*
	 * Everything below this line only a platform can answer, and every one of them is optional.
	 *
	 * A plain index in a git repo knows where a bundle lives and nothing else — it has no download
	 * to count, no build to hash, no moment it was last looked at. An app reading one of those must
	 * work exactly as before, so none of this may ever be required to install something.
	 */

	/** A built, normalised archive of exactly this bundle. Absent for entries nobody has built. */
	tarball?: string;
	/** Hex SHA-256 of the tarball. Downloading without one of these is trusting the transport. */
	sha256?: string;
	/** Bytes, so a client can show progress and refuse something implausible before fetching it. */
	size?: number;
	/** ISO date the platform last saw a change upstream. */
	updatedAt?: string;
	/** Cumulative installs. A popularity signal, not a fact about the bundle. */
	downloads?: number;
	/** How many skills the archive actually holds, counted at build time rather than claimed. */
	skillCount?: number;
	/** How many MCP servers its `.mcp.json` declares, likewise counted. */
	serverCount?: number;
	/** The upstream commit this version was built from, so a build can be reproduced. */
	commit?: string;
	/**
	 * Which agents can install this, derived from the archive's contents.
	 *
	 * Absent on a plain file-based index, which has no way to know — the field only means something
	 * when something has read the bundle.
	 */
	clients?: ClientId[];
	/**
	 * A short line for a card, where the description is too long to be read.
	 *
	 * Written by a maintainer rather than derived: nothing in a manifest is short enough to be one,
	 * and a truncated description is not a tagline — it is a description with the end cut off. A
	 * client with room for a sentence should still show `description`; this is for the places that
	 * have room for five words.
	 */
	tagline?: string;
	/** What an MCP server will ask for once installed. See `EntryNeed`. */
	needs?: EntryNeed[];
	/** Extra words to find it by — what it works with, what it is for — beyond its name and description. */
	keywords?: string[];
	/**
	 * Where the picture behind `logo` came from, when the index says: a maintainer's upload, the
	 * bundle's own file, a URL from its manifest, or nothing. A picture somebody chose for this entry
	 * — the first two — is its mark even when another entry of the same brand wears the same one.
	 */
	iconSource?: "uploaded" | "bundled" | "remote" | "none";
	/**
	 * The presented fields a maintainer set by hand on the platform — `name`, `description` and so on.
	 * Installed, a bundle's own manifest also says what it is called; where the index marks a field
	 * curated, the index's wording is a decision and the manifest's is only a default.
	 */
	curated?: string[];
}

/**
 * One entry of an index, or null if it is not one.
 *
 * Exported for the tests: what an index is allowed to say is a contract with people who do not have
 * this codebase, and a contract that is only exercised over the network is a contract nobody checks
 * until it is already broken in production.
 *
 * Every alias accepted here exists because some index in the wild uses it. Being liberal costs a
 * line each; being strict costs the entries of everyone who guessed a reasonable synonym.
 */
export function normalise(item: unknown): RegistryEntry | null {
	if (!item || typeof item !== "object") return null;
	const raw = item as Record<string, unknown>;

	const repository = pick(raw, "repository", "repo", "url", "git");
	const name = pick(raw, "name", "title", "displayName");
	const tarball = pick(raw, "tarball", "dist");
	if (!name) return null;

	/*
	 * A bundle needs somewhere to come from — a repository or a built archive.
	 *
	 * It used to need a repository, full stop, which was true of every entry a file-based index could
	 * hold. A platform that builds and stores archives can also serve something that was uploaded and
	 * has no repository at all; requiring one dropped those entries on the floor, silently, in
	 * `readIndex` — the catalogue listed them and the client acted as though they did not exist.
	 */
	if (!repository && !tarball) return null;
	// Only ever cloned from, never opened in a browser, but a non-git scheme has no business here.
	if (repository && !/^(https:\/\/|git@)/i.test(repository)) return null;

	const id = pick(raw, "id", "slug") ?? slugOf(name);
	if (!/^[a-z0-9._-]+$/i.test(id)) return null;

	const logo = pick(raw, "logo", "icon", "iconUrl");
	const declared = pick(raw, "kind", "type");
	const packageName = pick(raw, "package", "npm");
	return {
		id,
		name,
		repository: repository ?? "",
		description: pick(raw, "description", "summary", "shortDescription"),
		path: pick(raw, "path", "subpath"),
		author: pick(raw, "author", "developerName", "owner"),
		homepage: pick(raw, "homepage", "websiteURL", "website"),
		// A logo is rendered as an <img src>; anything but http(s) could be a `javascript:` URL.
		logo: logo && /^https?:\/\//i.test(logo) ? logo : undefined,
		brandColor: pick(raw, "brandColor", "color"),
		category: pick(raw, "category"),
		/*
		 * Taken from the index when it says, inferred only when it does not.
		 *
		 * The inference is a fallback for indexes written before `kind` existed: naming an npm
		 * `package` is how an MCP server is distributed, and nothing else in the format implies one.
		 * A skill collection is never inferred — it has no distinguishing field, so an index that
		 * wants one has to say so.
		 */
		kind: isBundleKind(declared) ? declared : packageName ? "mcp" : "plugin",
		package: packageName,
		version: pick(raw, "version"),
		license: pick(raw, "license"),
		// Same rule as the logo, and a stronger reason: this one gets downloaded and unpacked.
		tarball: tarball && /^https:\/\//i.test(tarball) ? tarball : undefined,
		sha256: hex64(pick(raw, "sha256", "integrity", "shasum")),
		size: positive(raw.size),
		updatedAt: pick(raw, "updatedAt", "updated_at", "modified"),
		downloads: positive(raw.downloads),
		skillCount: positive(raw.skillCount ?? raw.skill_count),
		serverCount: positive(raw.serverCount ?? raw.server_count),
		commit: pick(raw, "commit", "sha", "commitSha"),
		clients: Array.isArray(raw.clients) ? raw.clients.filter(isClientId) : undefined,
		// Only this one key. `summary` and `shortDescription` are already aliases for `description`
		// above, so accepting them here would make an index that uses one of them produce a card
		// showing the same sentence twice.
		tagline: pick(raw, "tagline"),
		needs: needsOf(raw.needs ?? raw.env),
		keywords: Array.isArray(raw.keywords)
			? raw.keywords.filter((word): word is string => typeof word === "string" && word.trim() !== "").slice(0, 24)
			: undefined,
		iconSource: ICON_SOURCES.find((source) => source === raw.iconSource),
		curated: Array.isArray(raw.curated) ? raw.curated.filter((field): field is string => typeof field === "string") : undefined,
	};
}

const ICON_SOURCES = ["uploaded", "bundled", "remote", "none"] as const;

/** An index's `needs` (or `env`, the manifest's word for it), keeping only well-formed names. */
function needsOf(raw: unknown): EntryNeed[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const needs = raw.flatMap((item): EntryNeed[] => {
		if (!item || typeof item !== "object") return [];
		const need = item as Record<string, unknown>;
		if (typeof need.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(need.name)) return [];
		const url = typeof need.url === "string" && /^https:\/\//i.test(need.url) ? need.url : undefined;
		return [
			{
				name: need.name,
				...(typeof need.description === "string" && need.description.trim() ? { description: need.description.trim() } : {}),
				...(url ? { url } : {}),
				...(need.optional === true ? { optional: true } : {}),
			},
		];
	});
	return needs.length > 0 ? needs : undefined;
}

/** The index document itself, in either of the two shapes found in the wild. */
export interface RegistryIndex {
	name?: string;
	updatedAt?: string;
	entries: RegistryEntry[];
}

/**
 * Read an index document into entries, dropping the ones that are not entries.
 *
 * Accepts `{ plugins: [...] }`, `{ collections: [...] }`, `{ entries: [...] }` or a bare array. A
 * skill index lists collections and a plugin index lists plugins; the two deserve different words
 * in the file and are identical from here, so accepting all of them keeps one reader rather than
 * several that drift.
 */
export function readIndex(raw: unknown): RegistryIndex {
	const container = raw as { plugins?: unknown; collections?: unknown; entries?: unknown } | null;
	const list = Array.isArray(raw) ? raw : (container?.plugins ?? container?.collections ?? container?.entries);
	if (!Array.isArray(list)) throw new Error("市场索引格式不对：应为数组或 { plugins: [] } / { collections: [] }");

	const meta = (Array.isArray(raw) ? {} : raw) as Record<string, unknown>;
	return {
		name: typeof meta.name === "string" ? meta.name : undefined,
		updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
		entries: list.flatMap((item) => {
			const entry = normalise(item);
			return entry ? [entry] : [];
		}),
	};
}

/** A name turned into something usable as a directory and a URL segment. */
export function slugOf(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Whether a string may be an entry id.
 *
 * It becomes a directory name on someone's disk and a path segment in a URL, so the answer is
 * narrower than "any slug": no dots leading anywhere (`..` climbs out of the plugins directory),
 * no separators, and short enough to survive every filesystem.
 */
export function isValidId(id: string): boolean {
	if (!id || id.length > 64) return false;
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return false;
	return !id.includes("..");
}

function pick(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = raw[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A SHA-256 or nothing — a hash that is not one would fail the comparison anyway, later and worse. */
function hex64(value: string | undefined): string | undefined {
	return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}
