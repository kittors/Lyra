/**
 * Installing and listing what the catalogue offers.
 *
 * Two kinds of bundle, told apart by their contents rather than by where they sit: a plugin is a
 * directory of skills, and an MCP bundle is a directory whose whole content is a server
 * declaration. Installing the second writes its servers into settings, which is the only place a
 * session reads them from — that is what stops the same server existing twice, once here and once
 * on the MCP settings page, with two switches that could not see each other.
 */

import { ipcMain, shell } from "electron";
import { mkdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { McpBundle, Settings } from "@lyra/core";
import { collectSkills, commandEnv, lyraHome, installEntry, loadPlugins, readInstalls, uninstallEntry } from "@lyra/core";
import { remoteImage } from "../avatars.ts";
import { diskImageStore, type ImageStore } from "../image-cache.ts";
import { readRegistry, withBundle } from "../plugin-index.ts";
import { readmeFor, type ReadmeQuery } from "../plugin-readme.ts";
import { startPluginUpdates } from "../plugin-updates.ts";
import { dropShared } from "../registry-icons.ts";
import { sessions } from "../session-hub.ts";
import { releaseBundle, settingsAfterInstall, settingsAfterReconcile, settingsAfterUninstall } from "./plugin-actions.ts";
import type { RegistryEntry } from "../ipc-types.ts";

export interface PluginsIpcDeps {
	settings(): Settings;
	saveSettings(next: Settings): Promise<unknown>;
}

export function registerPluginsIpc({ settings, saveSettings }: PluginsIpcDeps): void {
	const disabledPlugins = () => settings().disabledPlugins;
	/*
	 * The cache is shared with the background update check — see `plugin-index.ts` — so the page and
	 * the timer never disagree about what the registry currently offers.
	 */
	const updates = startPluginUpdates({ settings, saveSettings });
	/** Coalesces the re-check a 刷新 asks for: the page fetches every registry at once. */
	let recheck: ReturnType<typeof setTimeout> | undefined;
	ipcMain.handle("registry:fetch", async (_event, url: string, force?: boolean, allowStale?: boolean) => {
		const answer = await readRegistry(url, force, undefined, allowStale === true);
		/*
		 * 刷新 means "look again now", and that includes what is installed: with automatic updating on,
		 * a newer version the page has just found is applied now rather than at the next half-hourly
		 * check. The check reads the cache this fetch just filled, so it costs no second request.
		 */
		if (force) {
			clearTimeout(recheck);
			recheck = setTimeout(() => void updates.check().catch(() => undefined), 1500);
		}
		return answer.ok ? { ok: true as const, registry: answer.registry, ...(answer.stale ? { stale: true } : {}) } : answer;
	});

	ipcMain.handle("plugins:updates", async () => updates.state());
	ipcMain.handle("plugins:updateAll", async (_event, ids?: string[]) => updates.update(Array.isArray(ids) ? ids : undefined));
	/*
	 * Names only. The window needs to know whether `GITHUB_TOKEN` is already set in the login shell
	 * — so it does not ask for it again — and has no business knowing what it is set to.
	 */
	ipcMain.handle("plugins:environment", async (_event, names: string[]) => {
		const env = commandEnv(process.env);
		return (Array.isArray(names) ? names : []).filter((name) => typeof name === "string" && !!env[name]);
	});

	/*
	 * Cloning is a write to disk from a URL the user typed, so it says what it did.
	 *
	 * A plugin is inert until the loader picks it up on the next session. An MCP bundle takes one
	 * step more: its servers are merged into settings, where the MCP page can show them, the user
	 * can point Filesystem at the right directory, and the session will actually connect to them.
	 * They arrive switched off — installing is not the same as trusting, and a server is a command
	 * that runs on this machine with this user's permissions.
	 */
	// `replace` is an update: same call, but the "already installed" check is skipped and the old
	// files are replaced only once the new ones are staged and verified. See `installEntry`.
	ipcMain.handle("registry:install", async (_event, entry: RegistryEntry, registryName?: string, replace?: boolean) => {
		try {
			// One install per bundle at a time: the background update may be replacing this very one.
			const installed = await withBundle(entry.id, async () => {
				// Its running servers let go of its files first, once the new version is ready to take their place.
				const done = await installEntry(entry, registryName, replace, { beforeReplace: () => releaseBundle(sessions.values(), entry.id) });
				const next = settingsAfterInstall(settings(), entry.id, done);
				if (next) await saveSettings(next);
				return done;
			});
			void updates.recount(true).catch(() => undefined);
			return { ok: true as const, dir: installed.dir, kind: installed.kind, servers: installed.servers.length };
		} catch (cause) {
			return { ok: false as const, message: cause instanceof Error ? cause.message : String(cause) };
		}
	});

	/*
	 * Removing the directory is only half of it.
	 *
	 * An MCP bundle left rows behind in settings; leaving them there would keep a server the user
	 * just uninstalled in the list, still connectable, pointing at a command that is no longer on
	 * disk. `origin.bundle` is what ties the two together.
	 */
	ipcMain.handle("registry:uninstall", async (_event, id: string) => {
		await withBundle(id, async () => {
			// See `releaseBundle`: on Windows a running server keeps its bundle from being deleted.
			await releaseBundle(sessions.values(), id);
			await uninstallEntry(id);
			const next = settingsAfterUninstall(settings(), id);
			if (next) await saveSettings(next);
		});
		void updates.recount(true).catch(() => undefined);
	});

	/** Bring what is on disk and what is in settings back into agreement — see `settingsAfterReconcile`. */
	const reconcile = async (bundles: McpBundle[]): Promise<void> => {
		const next = settingsAfterReconcile(settings(), bundles);
		if (next) await saveSettings(next);
	};

	/**
	 * Move a bundle to the directory its kind belongs in.
	 *
	 * Cosmetic, deliberately: sorting reads the contents, so a bundle in the wrong place already
	 * works. This only keeps the two directories meaning what their names say, and a failure is
	 * ignored for exactly that reason — there is nothing to recover from.
	 */
	const tidy = async (bundles: McpBundle[]): Promise<void> => {
		const home = join(lyraHome(), "mcp");
		for (const bundle of bundles) {
			if (bundle.source !== "user" || bundle.dir.startsWith(home)) continue;
			await mkdir(home, { recursive: true }).catch(() => {});
			await rename(bundle.dir, join(home, basename(bundle.dir))).catch(() => {});
		}
	};

	ipcMain.handle("plugins:list", async (_event, cwd: string) => {
		/*
		 * Sequential, because skills depend on which plugins loaded.
		 *
		 * These used to run in parallel, with skills read straight from `loadSkills` — so the
		 * settings page and the agent walked different code to answer the same question, and the
		 * page had no way to know that a skill it could not find had in fact been shadowed.
		 */
		const plugins = await loadPlugins(
			[
				...(cwd ? [{ dir: join(cwd, ".lyra", "plugins"), source: "workspace" as const }] : []),
				{ dir: join(lyraHome(), "plugins"), source: "user" as const },
				// Both roots, because a bundle is sorted by what it holds — one installed before
				// the split is still filed under `plugins` and still has to come back as MCP.
				{ dir: join(lyraHome(), "mcp"), source: "user" as const },
			],
			disabledPlugins(),
		);
		/*
		 * Done on the way out of a read, which is not where side effects usually belong.
		 *
		 * The alternative is a migration at startup, and this page is reached before the first
		 * session exists — someone opening 设置 › MCP on a fresh launch would see an empty list
		 * and conclude their servers were gone. Both are idempotent and both no-op once there is
		 * nothing left to fix, so the cost of running them here is a comparison per scan.
		 */
		await reconcile(plugins.mcpBundles);
		void tidy(plugins.mcpBundles);

		const collected = await collectSkills(cwd ?? process.cwd(), plugins.plugins, settings());
		return {
			plugins: plugins.plugins,
			mcpBundles: plugins.mcpBundles,
			pluginDiagnostics: plugins.diagnostics,
			skills: collected.skills,
			skillDiagnostics: collected.diagnostics,
			shadowedSkills: collected.shadowed,
			installs: await readInstalls().catch(() => ({})),
		};
	});

	/*
	 * Icons, fetched here so the page's Content-Security-Policy does not have to open up.
	 *
	 * A registry entry's logo is a URL from a file we did not write. `img-src` is narrow on purpose,
	 * and widening it to the whole web so a 36px tile can render would trade a real boundary for a
	 * decoration. Cached, so a list of twenty entries is twenty requests once and none after.
	 */
	ipcMain.handle("registry:icon", async (_event, url: string) => remoteImage(url, icons()));

	ipcMain.handle("registry:readme", async (_event, query: ReadmeQuery) => {
		const current = settings();
		return readmeFor(query ?? { id: "" }, [...(current.pluginRegistries ?? []), ...(current.skillRegistries ?? [])], lyraHome());
	});

	/*
	 * The catalogue's logos, asked for together because one of the answers depends on the others.
	 *
	 * A picture two entries share identifies neither of them — see `dropShared`. That is a judgement
	 * about the batch, so it cannot be made one card at a time: whichever request happened to land
	 * first would keep the picture and the rest would lose it, and the page would look different
	 * depending on the order the network answered in.
	 *
	 * Order is preserved through the `Map` so the answer lines up with what was asked, and `remoteImage`
	 * still does the caching and the concurrency limiting, so asking for twenty at once is the same
	 * traffic as twenty separate asks and a good deal less IPC.
	 */
	ipcMain.handle("registry:icons", async (_event, urls: string[]) => {
		const wanted = [...new Set(urls ?? [])];
		const resolved = new Map(
			await Promise.all(wanted.map(async (url) => [url, await remoteImage(url, icons())] as const)),
		);
		return Object.fromEntries(dropShared(resolved));
	});

	ipcMain.handle("plugins:revealDir", async (_event, scope: "workspace" | "user", cwd: string) => {
		const dir = pluginsDir(scope, cwd);
		await mkdir(dir, { recursive: true });
		await shell.openPath(dir);
		return dir;
	});

}

/**
 * Where the market's icons are kept between launches — see `image-cache.ts`. Made on first use, so
 * the home it lives under is whichever one this run was started with.
 */
let iconStore: ImageStore | null = null;
function icons(): ImageStore {
	iconStore ??= diskImageStore(join(lyraHome(), "cache", "icons"));
	return iconStore;
}

function pluginsDir(scope: "workspace" | "user", cwd: string): string {
	return scope === "workspace" ? join(cwd, ".lyra", "plugins") : join(lyraHome(), "plugins");
}
