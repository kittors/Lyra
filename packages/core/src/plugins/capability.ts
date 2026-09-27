/**
 * Capability plugins found on disk.
 *
 * A bundle in `.lyra/plugins` already contributes skills and MCP servers. This is the third
 * thing it may contribute and the most powerful: a Cordis plugin, which can provide or replace any
 * of the seams — the model registry, the sandbox, the loop, the scheduler.
 *
 * Without this, "everything is a plugin" is true only of code the host compiled in, which is a
 * weaker claim than it sounds. With it, dropping a directory into a project changes what the agent
 * is made of.
 *
 * Loaded with `import()` at boot, which is the only honest way to run code the user placed there.
 * The trust boundary is the same as for a skill or an MCP server: files inside the user's own
 * project, put there deliberately. A bundle that throws while loading is reported and skipped —
 * a broken plugin must not be able to stop the app from starting.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import type { Plugin as CapabilityPlugin } from "../kernel/context.ts";
import type { Plugin, PluginDiagnostic } from "./loader.ts";

/**
 * What a bundle's `capability.js` is expected to export.
 *
 * Named apart from the `plugin.json` manifest so the two cannot be confused: one describes the
 * bundle, the other is code that runs.
 */
interface CapabilityModule {
	default?: CapabilityPlugin | CapabilityPlugin[];
	plugins?: CapabilityPlugin[];
}

/**
 * How long one bundle's `capability.js` may take to load.
 *
 * A module with a top-level `await` that never settles held the app's start up for good: this runs
 * before the window exists, so what the person saw was an app that never opened.
 */
const LOAD_TIMEOUT_MS = 10_000;

export interface LoadedCapabilityPlugins {
	plugins: CapabilityPlugin[];
	diagnostics: PluginDiagnostic[];
}

/**
 * Read the capability plugins out of already-discovered bundles.
 *
 * Takes bundles rather than directories so that enabling, disabling and diagnostics stay in one
 * place: this only answers "and does it also bring capabilities?".
 */
export async function loadCapabilityPlugins(bundles: Plugin[]): Promise<LoadedCapabilityPlugins> {
	const plugins: CapabilityPlugin[] = [];
	const diagnostics: PluginDiagnostic[] = [];

	for (const bundle of bundles) {
		if (!bundle.enabled) continue;
		const entry = join(bundle.dir, "capability.js");
		if (!(await stat(entry).then((s) => s.isFile()).catch(() => false))) continue;

		try {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const module = (await Promise.race([
				import(pathToFileURL(entry).href),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error(`加载超过 ${LOAD_TIMEOUT_MS / 1000} 秒，已跳过`)), LOAD_TIMEOUT_MS);
				}),
			]).finally(() => clearTimeout(timer))) as CapabilityModule;
			const exported = module.plugins ?? module.default;
			const list = Array.isArray(exported) ? exported : exported ? [exported] : [];

			for (const plugin of list) {
				if (!plugin || typeof plugin.apply !== "function" || typeof plugin.name !== "string") {
					diagnostics.push({ path: entry, message: "导出的不是一个插件（需要 name 与 apply）" });
					continue;
				}
				plugins.push(plugin);
			}
			if (list.length === 0) diagnostics.push({ path: entry, message: "没有导出任何插件" });
		} catch (cause) {
			diagnostics.push({ path: entry, message: cause instanceof Error ? cause.message : String(cause) });
		}
	}

	return { plugins, diagnostics };
}
