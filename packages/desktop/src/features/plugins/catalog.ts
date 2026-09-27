/**
 * Everything the catalogue can show, from the three places it comes from.
 *
 * A bundle reaches this window down one of two paths: it was cloned from a registry, or somebody
 * put a directory in `~/.lyra/plugins`. Those are different facts about the same kind of thing,
 * and the page is not a good place to keep them apart — a card wants to say "this is Chrome, it
 * controls the browser, and you have it" without first asking which list it came out of.
 *
 * What it does have to keep apart is *what* the thing is. A plugin is a bundle of skills; an MCP
 * bundle is a server declaration that happened to arrive in a git repository. They install
 * differently (one lands on disk, the other also writes into settings), they are switched on
 * differently (one flag, versus one per server), and the catalogue used to call both of them
 * "插件" — which is how a page of nine entries came to be seven MCP servers wearing the wrong
 * word. `kind` is that distinction, read off the contents rather than taken on trust.
 *
 * The three sources are merged on `id`, once, and what comes out carries every half: `installed`
 * for a plugin on disk, `bundle` + `servers` for an MCP server on disk, `entry` for what a
 * registry says it is.
 */

import type { BundleKind, ClientId, InstallRecord, McpBundle, McpNeed, McpServerConfig, Plugin, RegistryEntry, Skill } from "@lyra/core";
// A sub-entry, not the root: importing a value from `@lyra/core` pulls its whole index — and with
// it `node:fs` — into this bundle. See AGENTS.md.
import { isOutdated } from "@lyra/core/install-record";
import { needsOf } from "@lyra/core/mcp-placeholders";
import { CATEGORY_ORDER, canonicalCategory } from "@lyra/registry-shared";

/** Bundles with nothing to file them under. Not a category anyone chose — see `shelves`. */
export const UNFILED = " unfiled";

export interface CatalogItem {
	/** Unique within the merged list; `id` alone collides between a registry and a local copy. */
	key: string;
	id: string;
	name: string;
	description: string;
	logo?: string;
	brandColor?: string;
	category: string;
	/**
	 * Which of the two things this is.
	 *
	 * For anything on disk it is a fact, read off what the directory holds. For anything still in
	 * a registry it is the index's claim, which installing corrects if the clone disagrees.
	 */
	kind: BundleKind;
	/**
	 * How many of this collection's skills are on disk. Zero for anything that is not a collection.
	 *
	 * A collection has no directory of its own — its skills are flattened in among the loose ones,
	 * which is what makes `loadSkills` see them at all. So there is nothing to point `installed` at,
	 * and the card went on offering 安装 after a successful install, forever. The `<id>-` prefix
	 * each skill was renamed with is the only trace the flat directory keeps, and counting it is
	 * exactly as reliable as the rename that put it there.
	 */
	collected: number;
	/** The directory those skills went into, for "打开目录". Null when there are none. */
	collectedIn: string | null;
	/** On disk as a plugin, with its skills and enabled state. */
	installed: Plugin | null;
	/** On disk as an MCP bundle, with what its `.mcp.json` declares. */
	bundle: McpBundle | null;
	/** The rows this MCP bundle put into settings, which is where its servers actually live. */
	servers: McpServerConfig[];
	/** Offered by a registry, with somewhere to clone it from. */
	entry: RegistryEntry | null;
	/** Which registry offered it, for the rare case of two offering the same name. */
	from: string | null;

	/*
	 * What the card says about a bundle besides its name.
	 *
	 * Every one of these was already being fetched and thrown away: the platform has published
	 * `version`, `author`, `downloads`, `skillCount` and `clients` since it existed, and the site
	 * has shown all of them on its own cards the whole time. The desktop card drew a name and a
	 * description, so the two views of the same catalogue disagreed about how much was known.
	 *
	 * Optional, all of them, because a bundle sitting in `~/.lyra/plugins` came from a directory
	 * rather than an index and genuinely has no author, no download count and no version beyond
	 * what its own manifest claims. A missing field is left out of the line rather than filled.
	 */
	/** A maintainer's short line, preferred over `description` where space is tight. */
	tagline?: string;
	version?: string;
	author?: string;
	downloads?: number;
	/** How many skills it holds: counted on disk once installed, claimed by the index before that. */
	skillCount?: number;
	serverCount?: number;
	/** Which agents can install it, derived by the platform from the archive's contents. */
	clients?: ClientId[];
	/** What the registry said this was when it was installed. Absent for anything not installed. */
	origin?: InstallRecord;
	/** Installed, and what the registry now offers is not what was installed. See `isOutdated`. */
	outdated: boolean;
	/**
	 * What an MCP server asks for from whoever installs it — API keys, tokens, connection strings.
	 *
	 * Once installed, read off its servers (their placeholders, and what the bundle's manifest says
	 * about each); before that, whatever the index says. Empty for everything else.
	 */
	needs: McpNeed[];
	/** Extra words it can be found by. */
	keywords?: string[];
	/** When the platform last saw it change upstream. */
	updatedAt?: string;
}

/** On disk, in whichever way this kind arrives — the question every "do I have this" check asks. */
export function isInstalled(item: CatalogItem): boolean {
	return item.installed !== null || item.bundle !== null || item.collected > 0;
}

/**
 * Switched on, in whichever sense applies.
 *
 * A plugin has one flag. An MCP bundle has one per server it brought, and the honest summary is
 * "any of them": a bundle with two servers and one of them on is doing something.
 */
export function isEnabled(item: CatalogItem): boolean {
	if (item.installed) return item.installed.enabled;
	if (item.bundle) return item.servers.some((server) => server.enabled);
	return false;
}

/**
 * One list, with each bundle appearing once.
 *
 * Installed first, so that what you have keeps its own name and description — the manifest on disk
 * is the thing actually running, and a registry index that has drifted since it was cloned should
 * not rename it under you. The registry half is attached anyway, because it carries the homepage
 * and the repository, which the local copy has no idea about.
 *
 * `kind` follows the same rule and for the same reason: on disk it is known, so the index cannot
 * overrule it. That is the whole correction — an entry listed as a plugin whose directory holds
 * one `.mcp.json` comes back from here as what it is.
 */
export function merge(
	plugins: Plugin[],
	bundles: McpBundle[],
	configured: McpServerConfig[],
	remote: { from: string; entry: RegistryEntry }[],
	skills: Skill[] = [],
	/** The install ledger — the only record of which skills a collection put down. */
	installs: Record<string, InstallRecord> = {},
): CatalogItem[] {
	/*
	 * Every list is defaulted, because three of the four crossed a process boundary to get here.
	 *
	 * The main process does not hot-reload: change what it imports and it goes on answering with
	 * the previous build while the renderer already has the new code. `mcpBundles` did not exist
	 * in that build, and iterating it threw before a single element was rendered — React unmounts
	 * the tree on an uncaught error, so the window went grey with nothing on it to read. A missing
	 * field should cost the rows it would have produced, not the page.
	 */
	plugins = plugins ?? [];
	bundles = bundles ?? [];
	configured = configured ?? [];
	remote = remote ?? [];
	skills = skills ?? [];
	installs = installs ?? {};

	/*
	 * Loose skills only — a plugin's skills are the plugin's, and are already accounted for.
	 *
	 * Without this a collection named `waza` would count the eight skills the Waza *plugin* brought,
	 * and claim to be installed on the strength of a different thing having been.
	 */
	/*
	 * The directory name, not the skill's own name.
	 *
	 * `moveInto` renames the *directory* to `<collection>-<skill>`; the name inside the frontmatter
	 * is untouched and still reads `agent-browser`. Matching on the name found nothing, so a
	 * collection with 29 skills on disk went on offering 安装 — which is precisely the state this
	 * count exists to rule out.
	 */
	const loose = skills
		.filter((skill) => !skill.pluginId)
		.map((skill) => ({ dir: skill.dir, name: skill.dir.split(/[/\\]/).pop() ?? "" }));

	const byId = new Map<string, CatalogItem>();

	for (const plugin of plugins) {
		const ui = plugin.manifest.interface;
		byId.set(plugin.id, {
			key: plugin.id,
			id: plugin.id,
			name: ui?.displayName ?? plugin.manifest.name ?? plugin.id,
			description: ui?.shortDescription ?? plugin.manifest.description ?? "",
			logo: ui?.logo,
			brandColor: ui?.brandColor,
			category: canonicalCategory(ui?.category) ?? UNFILED,
			kind: "plugin",
			collected: 0,
			collectedIn: null,
			installed: plugin,
			bundle: null,
			servers: [],
			entry: null,
			from: null,
			/*
			 * The version on disk, and the author who wrote the manifest.
			 *
			 * The registry's copy of both is attached below and deliberately does not overwrite
			 * these: what is installed is what is running, and a registry that has moved on since
			 * should not relabel it. That is the same rule the name and description follow.
			 */
			version: plugin.manifest.version,
			author: typeof plugin.manifest.author === "string" ? plugin.manifest.author : plugin.manifest.author?.name,
			// Counted, not claimed — the loader already read the directory.
			skillCount: plugin.skills.length,
			origin: plugin.origin,
			outdated: false,
			needs: [],
		});
	}

	for (const bundle of bundles) {
		const ui = bundle.manifest.interface;
		const rows = configured.filter((server) => server.origin?.bundle === bundle.id);
		byId.set(bundle.id, {
			key: bundle.id,
			id: bundle.id,
			name: ui?.displayName ?? bundle.manifest.name ?? bundle.id,
			description: ui?.shortDescription ?? bundle.manifest.description ?? "",
			logo: ui?.logo,
			brandColor: ui?.brandColor,
			category: canonicalCategory(ui?.category) ?? UNFILED,
			kind: "mcp",
			collected: 0,
			collectedIn: null,
			installed: null,
			bundle,
			// Matched on the directory name, which is what install stamped into every row it wrote.
			servers: rows,
			entry: null,
			from: null,
			version: bundle.manifest.version,
			author: typeof bundle.manifest.author === "string" ? bundle.manifest.author : bundle.manifest.author?.name,
			// What its `.mcp.json` declares, which is what install read to write the settings rows.
			serverCount: bundle.servers.length,
			origin: bundle.origin,
			outdated: false,
			needs: bundleNeeds(bundle, rows),
		});
	}

	for (const { from, entry } of remote) {
		const existing = byId.get(entry.id);
		if (existing) {
			existing.entry = entry;
			existing.from = from;
			/*
			 * The market's name and line, unless the bundle chose display text of its own.
			 *
			 * A manifest's `name` is usually an identifier — `superpowers`, `brave-search` — and its
			 * `description` is whatever the upstream wrote, in whatever language. The card said
			 * "Superpowers" and a Chinese sentence until the moment it was installed, and then
			 * "superpowers" and an English paragraph: the same thing, renamed by installing it. A
			 * bundle that set `interface.displayName` / `shortDescription` meant those for exactly
			 * this place, and keeps them.
			 */
			/*
			 * A skill collection is installed as a bundle of skills — which on disk is a plugin, and
			 * the scan says so. It is still what the market listed it as: filed under 技能 before it
			 * was installed and after, rather than moving tabs the moment it arrived.
			 */
			if (entry.kind === "skill" && existing.kind === "plugin") existing.kind = "skill";
			const ui = existing.installed?.manifest.interface ?? existing.bundle?.manifest.interface;
			/*
			 * Except where a maintainer wrote the index's wording by hand (`curated`): that is a decision
			 * about how this market presents the thing, where a manifest's `displayName` is the author's
			 * default — and for the market's own entries it is the Chinese name and line the card showed
			 * before installing, which the card should go on showing after.
			 */
			const curated = new Set(entry.curated ?? []);
			if ((curated.has("name") || !ui?.displayName) && entry.name) existing.name = entry.name;
			if ((curated.has("description") || !ui?.shortDescription) && entry.description) existing.description = entry.description;
			// Only where the local copy said nothing; the manifest wins wherever it spoke.
			if (!existing.description) existing.description = entry.description ?? "";
			if (!existing.logo) existing.logo = entry.logo;
			if (existing.category === UNFILED && entry.category) existing.category = canonicalCategory(entry.category) ?? UNFILED;
			/*
			 * The same rule for everything the index also knows: fill the gaps, overwrite nothing.
			 *
			 * A manifest that named its author speaks for the bundle running on this machine; the
			 * index's copy may be months stale. The exceptions below are the three the index is the
			 * only possible source for — nothing on disk counts downloads, records who else can
			 * install it, or knows what a maintainer wrote in a console.
			 */
			existing.tagline ??= entry.tagline;
			existing.version ??= entry.version;
			existing.author ??= entry.author;
			existing.skillCount ??= entry.skillCount;
			existing.serverCount ??= entry.serverCount;
			existing.downloads = entry.downloads;
			existing.clients = entry.clients;
			existing.keywords = entry.keywords;
			existing.updatedAt = entry.updatedAt;
			if (existing.needs.length === 0 && existing.kind === "mcp" && entry.needs) existing.needs = entry.needs;
			/*
			 * Whether what is on offer differs from what was installed.
			 *
			 * Only answerable here, which is why it is computed here rather than in either process:
			 * the record comes from the main process's scan of the disk and the entry comes from a
			 * registry this window fetched, and this is the first place both are in scope.
			 */
			existing.outdated = isOutdated(existing.origin, entry);
			continue;
		}
		/*
		 * Which of the loose skills this collection put there — none, unless it is a collection.
		 *
		 * The ledger names them when it can. The `<id>-` prefix is the fallback for collections
		 * installed before it did, and is wrong in one way the ledger is not: a skill somebody wrote
		 * and happened to call `waza-notes` would count as one of Waza's.
		 */
		const record = entry.kind === "skill" ? installs[entry.id] : undefined;
		const recorded = record?.skills;
		const mine =
			entry.kind !== "skill"
				? []
				: recorded
					? loose.filter((skill) => recorded.includes(skill.name))
					: loose.filter((skill) => skill.name.startsWith(`${entry.id}-`));
		byId.set(entry.id, {
			key: `${from}:${entry.id}`,
			id: entry.id,
			name: entry.name,
			description: entry.description ?? "",
			logo: entry.logo,
			brandColor: entry.brandColor,
			category: canonicalCategory(entry.category) ?? UNFILED,
			kind: entry.kind,
			collected: mine.length,
			collectedIn: mine[0] ? mine[0].dir.slice(0, mine[0].dir.length - mine[0].name.length - 1) : null,
			installed: null,
			bundle: null,
			servers: [],
			entry,
			from,
			tagline: entry.tagline,
			version: entry.version,
			author: entry.author,
			downloads: entry.downloads,
			skillCount: entry.skillCount,
			serverCount: entry.serverCount,
			clients: entry.clients,
			keywords: entry.keywords,
			updatedAt: entry.updatedAt,
			/*
			 * A collection is the one entry here that can be installed: its skills are among the loose
			 * ones, and the ledger remembers which version put them there.
			 */
			origin: mine.length > 0 ? record : undefined,
			outdated: mine.length > 0 && isOutdated(record, entry),
			needs: entry.kind === "mcp" ? (entry.needs ?? []) : [],
		});
	}

	return [...byId.values()];
}

/**
 * What an installed MCP bundle asks for, across its servers.
 *
 * The settings rows are what will be started, so their placeholders count; the bundle's own copy of
 * each server carries the manifest's notes about them, which rows written before those notes existed
 * do not have. One entry per name, the first description found.
 */
function bundleNeeds(bundle: McpBundle, rows: McpServerConfig[]): McpNeed[] {
	const byName = new Map<string, McpNeed>();
	const declared = new Map(bundle.servers.map((server) => [server.id, server]));
	for (const server of rows.length > 0 ? rows : bundle.servers) {
		const notes = server.needs ?? declared.get(server.id)?.needs;
		for (const need of needsOf(notes ? { ...server, needs: notes } : server)) {
			if (!byName.has(need.name)) byName.set(need.name, need);
		}
	}
	return [...byName.values()];
}

/**
 * Whether a bundle answers to what was typed: its name, id, the two descriptions, who made it, its
 * category and the words it can be found by. Every word typed has to match somewhere, so 「浏览器
 * 截图」 narrows rather than widens.
 */
export function matches(item: CatalogItem, query: string): boolean {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = [item.name, item.id, item.tagline, item.description, item.author, item.category === UNFILED ? "" : item.category, ...(item.keywords ?? [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return words.every((word) => haystack.includes(word));
}

/**
 * The order the shelves come in — the market's own list, shared with everything else that shows
 * categories; see `CATEGORY_ORDER`. Categories not on it follow, by how much is in them.
 */
const SHELF_ORDER: readonly string[] = CATEGORY_ORDER;

/**
 * Group into the sections the page draws, in a stable order: known categories first in the order
 * above, then the rest by size, then whatever declared none. Within a shelf, the most installed first
 * — the one number every entry has that says anything about which of two similar ones to try.
 */
export function shelves(items: CatalogItem[]): { category: string; items: CatalogItem[] }[] {
	const groups = new Map<string, CatalogItem[]>();
	for (const item of items) {
		const list = groups.get(item.category);
		if (list) list.push(item);
		else groups.set(item.category, [item]);
	}
	const rank = (category: string) => {
		const index = SHELF_ORDER.indexOf(category);
		return index === -1 ? SHELF_ORDER.length : index;
	};
	return [...groups.entries()]
		.sort(([a, left], [b, right]) => {
			if (a === UNFILED || b === UNFILED) return a === UNFILED ? 1 : -1;
			return rank(a) - rank(b) || right.length - left.length || a.localeCompare(b);
		})
		.map(([category, list]) => ({ category, items: list.sort(byPopularity) }));
}

/** Most installed first; the name settles ties so the order does not shuffle between visits. */
export function byPopularity(a: CatalogItem, b: CatalogItem): number {
	return (b.downloads ?? 0) - (a.downloads ?? 0) || a.name.localeCompare(b.name);
}
