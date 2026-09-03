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

import type { BundleKind, ClientId, InstallRecord, McpBundle, McpServerConfig, Plugin, RegistryEntry, Skill } from "@lyra/core";
// A sub-entry, not the root: importing a value from `@lyra/core` pulls its whole index — and with
// it `node:fs` — into this bundle. See AGENTS.md.
import { isOutdated } from "@lyra/core/install-record";

/** Bundles with nothing to file them under. Not a category anyone chose — see `groupByCategory`. */
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
			category: ui?.category ?? UNFILED,
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
		});
	}

	for (const bundle of bundles) {
		const ui = bundle.manifest.interface;
		byId.set(bundle.id, {
			key: bundle.id,
			id: bundle.id,
			name: ui?.displayName ?? bundle.manifest.name ?? bundle.id,
			description: ui?.shortDescription ?? bundle.manifest.description ?? "",
			logo: ui?.logo,
			brandColor: ui?.brandColor,
			category: ui?.category ?? UNFILED,
			kind: "mcp",
			collected: 0,
			collectedIn: null,
			installed: null,
			bundle,
			// Matched on the directory name, which is what install stamped into every row it wrote.
			servers: configured.filter((server) => server.origin?.bundle === bundle.id),
			entry: null,
			from: null,
			version: bundle.manifest.version,
			author: typeof bundle.manifest.author === "string" ? bundle.manifest.author : bundle.manifest.author?.name,
			// What its `.mcp.json` declares, which is what install read to write the settings rows.
			serverCount: bundle.servers.length,
			origin: bundle.origin,
			outdated: false,
		});
	}

	for (const { from, entry } of remote) {
		const existing = byId.get(entry.id);
		if (existing) {
			existing.entry = entry;
			existing.from = from;
			// Only where the local copy said nothing; the manifest wins wherever it spoke.
			if (!existing.description) existing.description = entry.description ?? "";
			if (!existing.logo) existing.logo = entry.logo;
			if (existing.category === UNFILED && entry.category) existing.category = entry.category;
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
		// Which of the loose skills this collection put there — none, unless it is a collection.
		const mine = entry.kind === "skill" ? loose.filter((skill) => skill.name.startsWith(`${entry.id}-`)) : [];
		byId.set(entry.id, {
			key: `${from}:${entry.id}`,
			id: entry.id,
			name: entry.name,
			description: entry.description ?? "",
			logo: entry.logo,
			brandColor: entry.brandColor,
			category: entry.category ?? UNFILED,
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
			// Nothing is installed, so there is nothing to be behind. A collection whose skills are
			// on disk has no record either — `moveInto` leaves no directory to have written one for.
			outdated: false,
		});
	}

	return [...byId.values()];
}

/**
 * Group into the sections the page draws, in a stable order.
 *
 * Named categories come first, alphabetically — any other order would need a notion of importance
 * that nothing in a registry index provides, and inventing one (a "Featured" row picked by us)
 * would be a claim we cannot back. Whatever declared no category goes last, under a heading the
 * caller supplies, so the common case of a registry with no categories at all is one plain grid
 * rather than a section called 其他 containing everything.
 */
export function groupByCategory(items: CatalogItem[]): { category: string; items: CatalogItem[] }[] {
	const groups = new Map<string, CatalogItem[]>();
	for (const item of items) {
		const list = groups.get(item.category);
		if (list) list.push(item);
		else groups.set(item.category, [item]);
	}

	const named = [...groups.entries()]
		.filter(([category]) => category !== UNFILED)
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([category, items]) => ({ category, items: items.sort(byName) }));

	const unfiled = groups.get(UNFILED);
	return unfiled ? [...named, { category: UNFILED, items: unfiled.sort(byName) }] : named;
}

function byName(a: CatalogItem, b: CatalogItem): number {
	return a.name.localeCompare(b.name);
}
