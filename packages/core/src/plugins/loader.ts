/**
 * Plugins, and the MCP servers that were being mistaken for them.
 *
 * A plugin is a bundle of *skills*: a manifest plus a `skills/` directory, where each skill may
 * carry its own `scripts/`, `assets/` and sub-agent definitions. That is the whole of it.
 *
 * It used to also carry MCP servers, on the reasoning that a bundle is just packaging and may as
 * well ship both. What that produced, in practice, was a catalogue of nine "plugins" of which
 * seven were a single `.mcp.json` and no skills at all — Context7, Filesystem, Playwright: MCP
 * servers, listed as plugins, installed as plugins, and then invisible on the MCP settings page
 * because that page reads `settings.mcpServers` and these had gone somewhere else entirely. The
 * same server could be configured twice, from two places, with two switches that could not see
 * each other.
 *
 * So the rule is now: **what a directory contains decides what it is.** Skills make it a plugin.
 * Only a `.mcp.json` makes it an MCP server that happens to have arrived in a git repository —
 * `McpBundle` below — and installing one of those writes its servers into settings, where every
 * other MCP server already lives. A directory holding both is loaded as a plugin and says so in
 * a diagnostic; nothing in the wild does this, and the alternative is the ambiguity we just left.
 *
 * Layout:
 *
 *   my-plugin/
 *     .lyra-plugin/plugin.json   (or ./plugin.json)
 *     skills/<name>/SKILL.md
 *     skills/<name>/scripts/…
 *
 *   my-mcp-server/
 *     .lyra-plugin/plugin.json   (for its name, icon and description)
 *     .mcp.json
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative as relativePath, resolve } from "node:path";
import type { McpServerConfig } from "../mcp/client.ts";
import { loadSkills, type Skill } from "../skills/loader.ts";
import { readBundleIcon } from "./bundle-icon.ts";
import { readInstalls, type InstallRecord } from "./installs.ts";

export interface PluginInterface {
	displayName?: string;
	shortDescription?: string;
	longDescription?: string;
	developerName?: string;
	category?: string;
	capabilities?: string[];
	brandColor?: string;
	logo?: string;
	defaultPrompt?: string[];
	websiteURL?: string;
}

export interface PluginManifest {
	name: string;
	version?: string;
	description?: string;
	author?: { name?: string } | string;
	homepage?: string;
	license?: string;
	keywords?: string[];
	/** Directory holding this plugin's skills, relative to the plugin root. */
	skills?: string;
	/** JSON file declaring MCP servers, relative to the plugin root. */
	mcpServers?: string;
	interface?: PluginInterface;
}

export interface Plugin {
	/** Directory name; unique within a source. */
	id: string;
	dir: string;
	manifest: PluginManifest;
	source: "workspace" | "user";
	skills: Skill[];
	enabled: boolean;
	/**
	 * What the registry said this was when it was installed, when it came from one.
	 *
	 * Absent for a directory somebody put here themselves, and for anything installed before the
	 * ledger existed. Both mean "no idea where this came from", which is why nothing may treat its
	 * absence as evidence of anything — see `isOutdated`.
	 */
	origin?: InstallRecord;
	/** Populated when the bundle is present but unusable. */
	error?: string;
}

/**
 * A directory that turned out to be an MCP server rather than a plugin.
 *
 * Same shape on disk, same registry, same install — but no skills, so there is nothing for it to
 * contribute to a session except a server declaration, and a server declaration belongs in
 * settings where the user can point Filesystem at the right directory. This type is what the
 * install path reads to know what to write there; nothing loads it into a session directly.
 */
export interface McpBundle {
	/** Directory name; matches `McpOrigin.bundle` on every server it produced. */
	id: string;
	dir: string;
	manifest: PluginManifest;
	source: "workspace" | "user";
	/** What its `.mcp.json` declares, ready to be merged into settings. */
	servers: McpServerConfig[];
	/** Where it came from, when it came from a registry. See `Plugin.origin`. */
	origin?: InstallRecord;
}

export interface PluginDiagnostic {
	path: string;
	message: string;
	/**
	 * Set when the plugin loaded and this is advice about it, not a reason it did not.
	 *
	 * Carried through from the skill loader, where a description too short for the model to pick
	 * the skill is a warning. Without this the settings page counted it among the plugins that
	 * failed to load — an error it was not.
	 */
	severity?: "warning";
}

const MANIFEST_LOCATIONS = [
	join(".lyra-plugin", "plugin.json"),
	join(".codex-plugin", "plugin.json"),
	"plugin.json",
];

/**
 * Read every bundle under the given roots and sort it by what it actually contains.
 *
 * Both kinds are returned from one pass because they live in the same directories and are told
 * apart by their contents, not their location — a bundle that was installed before the split, or
 * dropped in by hand, lands in the right list without anything having to move first.
 */
export async function loadPlugins(
	sources: { dir: string; source: Plugin["source"] }[],
	disabled: string[] = [],
): Promise<{ plugins: Plugin[]; mcpBundles: McpBundle[]; diagnostics: PluginDiagnostic[] }> {
	const plugins: Plugin[] = [];
	const mcpBundles: McpBundle[] = [];
	const diagnostics: PluginDiagnostic[] = [];
	const seen = new Set<string>();
	/*
	 * Read once for the whole scan, and joined on rather than trusted.
	 *
	 * The ledger says what was installed; this loop says what is there. A bundle whose directory was
	 * deleted by hand never reaches the join, so a stale record is invisible rather than wrong — and
	 * a bundle the user dropped in themselves has no record at all, which is the honest answer to
	 * "where did this come from" and the reason nothing may be inferred from its absence.
	 */
	const installs = await readInstalls();

	for (const { dir, source } of sources) {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) continue;

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const pluginDir = join(dir, entry.name);
			if (!(await stat(pluginDir).then((s) => s.isDirectory()).catch(() => false))) continue;

			const found = await readManifest(pluginDir);
			if (!found) continue;
			if (!found.manifest) {
				diagnostics.push({ path: pluginDir, message: found.error });
				continue;
			}

			const manifest = found.manifest;
			/*
			 * The directory is the identity; the manifest is the label.
			 *
			 * This used to be `manifest.name || entry.name`, which is the same string almost always
			 * and silently wrong when it is not. `inferManifest` deliberately prefers the name inside
			 * a `.claude-plugin/marketplace.json` — a bundle installed as `agentic-note-taking` comes
			 * back calling itself `Agentic Note Taking` — and every part of installing and removing a
			 * bundle works on the directory: install creates `<root>/<entry.id>`, uninstall removes
			 * `<root>/<id>`, and the servers are stamped with the same id so the settings rows can be
			 * found again.
			 *
			 * With the two disagreeing, all three broke at once and none of them said so. Uninstalling
			 * removed a directory that did not exist and reported success; the settings rows were
			 * matched on a name nothing had been stamped with, so the server stayed in the list; and
			 * the next scan found a bundle with no row and appended its servers again — once per scan,
			 * which is once per visit to the plugins page.
			 *
			 * What the manifest called it is not lost: it is `manifest.name`, and every list that shows
			 * a bundle reads `interface.displayName ?? manifest.name ?? id` for exactly this reason.
			 */
			const id = entry.name;
			// Workspace plugins are loaded first, so a user-level plugin of the same name loses.
			if (seen.has(id)) {
				diagnostics.push({ path: pluginDir, message: `插件 "${id}" 已由更高优先级的来源提供` });
				continue;
			}
			seen.add(id);

			/*
			 * `*` turns everything off.
			 *
			 * A session that must be reproducible — one running in CI, or one being used to
			 * reproduce a report — cannot have its capabilities decided by whatever happens to be
			 * installed on the machine. Naming every plugin to disable it is not an option there,
			 * because the point is precisely not knowing what is installed.
			 */
			const read = await readContents(pluginDir, manifest, id, source);
			diagnostics.push(...read.diagnostics);
			await attachIcon(pluginDir, manifest);

			/*
			 * No skills and a server declaration: this is an MCP server, whatever the directory it
			 * sits in is called. It contributes nothing to a session on its own — its servers are
			 * merged into settings at install time, and settings is what the session reads.
			 */
			if (read.kind === "mcp") {
				mcpBundles.push({
					id,
					dir: pluginDir,
					manifest,
					source,
					origin: installs[id],
					// `id`, so that what stamps a row and what looks the row up are the same string.
					servers: read.servers.map((server) => ({
						...server,
						origin: { bundle: id, version: manifest.version },
					})),
				});
				continue;
			}

			plugins.push({
				id,
				dir: pluginDir,
				manifest,
				source,
				origin: installs[id],
				// Tag skills so the UI can show which plugin brought them in.
				skills: read.skills.map((skill) => ({ ...skill, pluginId: id })),
				/*
				 * Both names, because this list was written by earlier versions.
				 *
				 * `disabledPlugins` holds whatever `id` meant when the user switched something off, and
				 * until this file changed that was the manifest's name. Reading only the directory
				 * would quietly re-enable every renamed bundle anybody had disabled — and a migration
				 * that turns things *on* is the one direction that cannot be undone by noticing.
				 *
				 * Costs a comparison and never expires: a bundle disabled under either name stays that
				 * way, and new entries are written under the directory like everything else now is.
				 */
				enabled:
					!disabled.includes("*") && !disabled.includes(id) && !(!!manifest.name && disabled.includes(manifest.name)),
			});
		}
	}

	return { plugins, mcpBundles, diagnostics };
}

/**
 * What one directory holds, and therefore what it is.
 *
 * Shared with the install path, which has to answer the same question about a fresh clone before
 * it knows where to put it — and answering it from the contents is what makes the answer right
 * even when the registry that listed it said something else.
 */
export async function inspectBundle(
	dir: string,
	source: Plugin["source"] = "user",
): Promise<
	| { kind: "plugin" | "mcp"; manifest: PluginManifest; skills: Skill[]; servers: McpServerConfig[] }
	| { kind: "none"; error?: string }
> {
	const found = await readManifest(dir);
	if (!found) return { kind: "none" };
	if (!found.manifest) return { kind: "none", error: found.error };

	const manifest = found.manifest;
	const read = await readContents(dir, manifest, manifest.name || basename(dir), source);
	await attachIcon(dir, manifest);
	return { kind: read.kind, manifest, skills: read.skills, servers: read.servers };
}

/**
 * Give a manifest the picture its bundle shipped.
 *
 * Written into `interface.logo` rather than into a field of its own, because every list that draws
 * a bundle already reads that field and a second one would mean nine call sites choosing between
 * them.
 *
 * A file inside the bundle beats a `logo` URL even when the manifest declares one, which is not the
 * obvious rule and is the one the platform follows: its icon route serves an uploaded icon first,
 * then the bundle's own, and a remote URL last, because that one depends on somebody else's server
 * still being there. The app has to agree — an entry whose mark differs before and after installing
 * is the same defect as a catalogue that mislabels what a bundle is. `iconCandidates` is where the
 * two ends share that ordering.
 *
 * Mutates, deliberately: the manifest was parsed one line ago and belongs to this scan alone.
 */
async function attachIcon(dir: string, manifest: PluginManifest): Promise<void> {
	const declared = manifest.interface?.logo;
	// Already an inlined picture — from a previous scan, or written by hand into the manifest.
	if (declared?.startsWith("data:")) return;
	const icon = await readBundleIcon(dir, declared);
	if (icon) manifest.interface = { ...manifest.interface, logo: icon };
}

/** The skills and servers a manifest points at, and the verdict that follows from having them. */
async function readContents(
	dir: string,
	manifest: PluginManifest,
	id: string,
	source: Plugin["source"],
): Promise<{ kind: "plugin" | "mcp"; skills: Skill[]; servers: McpServerConfig[]; diagnostics: PluginDiagnostic[] }> {
	const diagnostics: PluginDiagnostic[] = [];

	const skillsDir = resolveInside(dir, manifest.skills ?? "./skills/");
	const loaded = skillsDir ? await loadSkills([{ dir: skillsDir, source }]) : { skills: [], diagnostics: [] };
	for (const diagnostic of loaded.diagnostics) {
		diagnostics.push(
			diagnostic.severity
				? { path: diagnostic.path, message: diagnostic.message, severity: diagnostic.severity }
				: { path: diagnostic.path, message: diagnostic.message },
		);
	}

	const mcp = manifest.mcpServers
		? await readMcpServers(dir, manifest.mcpServers, id)
		: { servers: [], error: undefined };
	if (mcp.error) diagnostics.push({ path: dir, message: mcp.error });

	if (loaded.skills.length === 0 && mcp.servers.length > 0) {
		return { kind: "mcp", skills: [], servers: mcp.servers, diagnostics };
	}

	// Both, which nothing in the wild actually does. Kept as a plugin, and said out loud: dropping
	// the servers in silence would be exactly the ambiguity this split exists to remove.
	if (mcp.servers.length > 0) {
		diagnostics.push({
			path: dir,
			message: `插件不再捆绑 MCP 服务，"${id}" 声明的 ${mcp.servers.length} 个服务未加载——请在设置 › MCP 里单独添加`,
		});
	}

	return { kind: "plugin", skills: loaded.skills, servers: mcp.servers, diagnostics };
}

type ManifestResult = { manifest: PluginManifest; error?: undefined } | { manifest?: undefined; error: string };

async function readManifest(pluginDir: string): Promise<ManifestResult | null> {
	for (const location of MANIFEST_LOCATIONS) {
		const raw = await readFile(join(pluginDir, location), "utf8").catch(() => null);
		if (raw === null) continue;
		try {
			const parsed = JSON.parse(raw) as PluginManifest;
			if (!parsed.name || typeof parsed.name !== "string") {
				return { error: `${location} 缺少 name 字段` };
			}
			return { manifest: parsed };
		} catch (error) {
			return { error: `${location} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
		}
	}
	return inferManifest(pluginDir);
}

/**
 * A bundle that never declared itself one.
 *
 * The manifest is our format, and almost nothing in the wild ships it. What the good skill
 * collections do ship is `skills/<name>/SKILL.md` — the same layout, arrived at independently,
 * because it is the obvious one. Requiring the file anyway meant a repository full of perfectly
 * loadable skills cloned into a directory that did nothing, and the only way to fix it was for
 * us to fork it or for them to adopt us.
 *
 * So the shape is the declaration: a directory holding `skills/` or a `.mcp.json` is a plugin,
 * whatever it calls itself. Anything else is still skipped — a directory has to contain
 * something we can actually load before it earns a row in the list.
 *
 * `.claude-plugin/marketplace.json` is read for what it says, not for permission. Collections
 * published for Claude Code carry their name, description, version and author there, and taking
 * them means an inferred bundle arrives with a real label instead of its directory name.
 */
async function inferManifest(pluginDir: string): Promise<ManifestResult | null> {
	const hasSkills = await stat(join(pluginDir, "skills"))
		.then((s) => s.isDirectory())
		.catch(() => false);
	const hasMcp = await stat(join(pluginDir, ".mcp.json"))
		.then((s) => s.isFile())
		.catch(() => false);
	if (!hasSkills && !hasMcp) return null;

	const manifest: PluginManifest = { name: basename(pluginDir) };
	if (hasMcp) manifest.mcpServers = ".mcp.json";

	const raw = await readFile(join(pluginDir, ".claude-plugin", "marketplace.json"), "utf8").catch(() => null);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as {
				name?: string;
				description?: string;
				owner?: { name?: string };
				plugins?: { name?: string; description?: string; version?: string; category?: string; homepage?: string }[];
			};
			// The collection's own entry is the one whose source is the root; in practice, the first.
			const head = parsed.plugins?.[0];
			/*
			 * The plugin's own name, not the file's.
			 *
			 * The top level of a `marketplace.json` describes the *marketplace* — which for a
			 * repository that publishes one thing is usually the owner's handle or `<x>-marketplace`.
			 * Taking it named a plugin "agenticnotetaking" in the installed list, which is the account
			 * that publishes it and not a thing anyone can recognise. The entry inside is what the
			 * plugin calls itself.
			 */
			const named = [head?.name, parsed.name].find((value) => typeof value === "string" && value);
			if (named) manifest.name = named;
			const described = [head?.description, parsed.description].find((value) => typeof value === "string" && value);
			if (described) manifest.description = described;
			if (typeof parsed.owner?.name === "string") manifest.author = { name: parsed.owner.name };
			if (head) {
				if (typeof head.version === "string") manifest.version = head.version;
				if (typeof head.homepage === "string") manifest.homepage = head.homepage;
				manifest.interface = {
					displayName: manifest.name,
					shortDescription: manifest.description,
					category: typeof head.category === "string" ? head.category : undefined,
				};
			}
		} catch {
			// A malformed marketplace file costs the labels, not the plugin.
		}
	}

	return { manifest };
}

async function readMcpServers(
	pluginDir: string,
	relative: string,
	pluginId: string,
): Promise<{ servers: McpServerConfig[]; error?: string }> {
	const path = resolveInside(pluginDir, relative);
	if (!path) return { servers: [], error: `mcpServers 路径逃出了插件目录：${relative}` };

	const raw = await readFile(path, "utf8").catch(() => null);
	if (raw === null) return { servers: [], error: `找不到 MCP 配置文件：${relative}` };

	let parsed: { mcpServers?: Record<string, Record<string, unknown>> };
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return { servers: [], error: `MCP 配置不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
	}

	const servers: McpServerConfig[] = [];
	for (const [name, config] of Object.entries(parsed.mcpServers ?? {})) {
		const normalized = normalizeServer(`${pluginId}__${name}`, name, config, pluginDir);
		if (normalized) servers.push(normalized);
	}
	return { servers };
}

/**
 * Translate one entry of a `.mcp.json` into our config shape.
 *
 * `type` is optional in the wild — a `command` implies stdio and a `url` implies HTTP.
 * `bearer_token_env_var` is resolved from the environment rather than stored, so a bundle
 * can be shared without embedding a token.
 */
function normalizeServer(
	id: string,
	name: string,
	config: Record<string, unknown>,
	pluginDir: string,
): McpServerConfig | null {
	const type = typeof config.type === "string" ? config.type : undefined;
	const command = typeof config.command === "string" ? config.command : undefined;
	const url = typeof config.url === "string" ? config.url : undefined;

	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries((config.env as Record<string, unknown>) ?? {})) {
		if (typeof value === "string") env[key] = value;
	}

	if (command || type === "stdio") {
		if (!command) return null;
		return {
			id,
			name,
			transport: "stdio",
			// A relative command is resolved against the plugin so bundled binaries work.
			command: command.startsWith(".") ? join(pluginDir, command) : command,
			args: Array.isArray(config.args) ? config.args.filter((a): a is string => typeof a === "string") : [],
			env,
			enabled: true,
		};
	}

	if (url) {
		const headers: Record<string, string> = {};
		const tokenVar = config.bearer_token_env_var;
		if (typeof tokenVar === "string" && process.env[tokenVar]) {
			headers.authorization = `Bearer ${process.env[tokenVar]}`;
		}
		for (const [key, value] of Object.entries((config.headers as Record<string, unknown>) ?? {})) {
			if (typeof value === "string") headers[key] = value;
		}
		return {
			id,
			name,
			transport: type === "sse" ? "sse" : "http",
			url,
			headers,
			enabled: true,
		};
	}

	return null;
}

/**
 * Resolve a manifest-supplied relative path, refusing anything that escapes the plugin.
 *
 * Containment is asked of `path`, not spelled out with a separator. Comparing against
 * `` `${root}/` `` is right on POSIX and silently wrong on Windows, where the separator is a
 * backslash — so every containment check answered "escaped", every `.mcp.json` was refused, and
 * every MCP bundle was misfiled as a plugin. The failure is only visible on Windows, which is
 * exactly the kind of thing a `/` in a path check hides.
 */
function resolveInside(pluginDir: string, relative: string): string | null {
	if (isAbsolute(relative)) return null;
	const resolved = resolve(pluginDir, relative);
	const root = resolve(pluginDir);
	const step = relativePath(root, resolved);
	return step === "" || (!step.startsWith("..") && !isAbsolute(step)) ? resolved : null;
}

/** One-line summary for the plugin list. */
export function pluginSummary(plugin: Plugin): string {
	return (
		plugin.manifest.interface?.shortDescription ??
		plugin.manifest.description ??
		`${plugin.skills.length} 个技能`
	);
}
