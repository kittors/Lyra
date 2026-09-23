/**
 * What installing and uninstalling do to settings, as decisions rather than as handlers.
 *
 * Putting files on disk is only half of installing an MCP bundle. The other half is the rows it
 * writes into the settings file, because that — not the bundle's own `.mcp.json` — is where a
 * session reads its servers from. Get that half wrong and the symptoms are all quiet: a server the
 * user just uninstalled still listed and still connectable, a bundle installed twice with its
 * servers doubled up, or an upgrade that silently disconnects everything somebody had.
 *
 * Separate from `plugins.ts` because that file imports `electron`, which cannot be loaded by a test
 * runner. These are the parts worth being sure about and they need nothing but data, so they live
 * where they can be called directly. `plugins.ts` keeps the wiring and the ordering; this keeps the
 * rules.
 *
 * Every `settingsAfter*` returns the settings to save, or `null` for "nothing changed" — so a caller
 * never writes the settings file to record that it had nothing to record.
 */

import type { Installed, McpBundle, McpServerConfig, Settings } from "@lyra/core";

/**
 * The settings an install leaves behind, or null when it has nothing to say.
 *
 * Only an MCP bundle does: a plugin is inert until the loader picks it up, and a skill collection is
 * a directory of markdown. A bundle's servers arrive switched **off**, always. Installing is not the
 * same as trusting, and a server is a command that runs on this machine with this user's
 * permissions — the moment it becomes live should be one somebody chose.
 *
 * Re-installing replaces that bundle's rows rather than adding to them. Without that, installing
 * something twice leaves two copies of every server it declares, and switching "it" on switches on
 * whichever copy the list happened to hit first.
 *
 * Replacing keeps the one thing that was the user's: whether a server they already had is on. An
 * update rewrote every row as off, so the servers somebody had switched on stopped the moment the
 * bundle updated, with nothing saying why. A server the new version brings for the first time still
 * arrives off — that is the install decision, made again only for what is new.
 */
export function settingsAfterInstall(current: Settings, entryId: string, installed: Installed): Settings | null {
	if (installed.kind !== "mcp" || installed.servers.length === 0) return null;

	const others = current.mcpServers.filter((server) => server.origin?.bundle !== entryId);
	const before = new Map(current.mcpServers.filter((server) => server.origin?.bundle === entryId).map((server) => [server.id, server.enabled]));
	return {
		...current,
		mcpServers: [...others, ...installed.servers.map((server) => ({ ...server, enabled: before.get(server.id) ?? false }))],
	};
}

/**
 * The settings an uninstall leaves behind, or null when the bundle had none.
 *
 * `origin.bundle` is the only thing tying a settings row to the directory it came from, which is
 * why installing stamps it on every row it writes. Leaving the rows would keep a server the user
 * just removed in the list — still switched on if it was, still pointing at a command that is no
 * longer on disk, and failing to connect with a message about the command rather than about the
 * uninstall.
 */
export function settingsAfterUninstall(current: Settings, id: string): Settings | null {
	const remaining = current.mcpServers.filter((server) => server.origin?.bundle !== id);
	return remaining.length === current.mcpServers.length ? null : { ...current, mcpServers: remaining };
}

/**
 * Bring what is on disk and what is in settings back into agreement, or null if they already are.
 *
 * Every MCP bundle installed before the plugin/MCP split went into `~/.lyra/plugins` and was loaded
 * through the plugin's own `mcpServers` list — a path that no longer exists. Left alone, an upgrade
 * would silently disconnect every MCP server anybody had installed: still on disk, still in the
 * catalogue, connected to nothing.
 *
 * So anything on disk without a matching row gets one, keeping the state it had. For a bundle
 * loaded the old way that means "on unless the user switched this plugin off" — a migration that
 * turns working servers off is as wrong as one that turns unknown servers on. Idempotent by
 * construction: the second call finds a row for every bundle and returns null.
 */
export function settingsAfterReconcile(current: Settings, bundles: McpBundle[]): Settings | null {
	const known = new Set(current.mcpServers.map((server) => server.origin?.bundle).filter(Boolean));
	const missing = bundles.filter((bundle) => !known.has(bundle.id));
	if (missing.length === 0) return null;

	const disabled = new Set(current.disabledPlugins);
	const restored: McpServerConfig[] = missing.flatMap((bundle) =>
		bundle.servers.map((server) => ({
			...server,
			/*
			 * Stamped here rather than trusted to arrive stamped, because this function's idempotence
			 * rests on it: the rows it writes are found by `origin.bundle`, and the id it looks them
			 * up by is `bundle.id`. Taking whatever the loader happened to put there makes the two
			 * the same string only as long as nothing upstream changes — and when they drift, this
			 * runs on every scan, appending another copy of every server each time the plugins page
			 * is opened. Writing the id it will later search for closes that over.
			 */
			origin: { ...server.origin, bundle: bundle.id },
			enabled: !disabled.has("*") && !disabled.has(bundle.id),
		})),
	);
	return { ...current, mcpServers: [...current.mcpServers, ...restored] };
}

/**
 * Stop, in every live session, the servers a bundle brought — before its files are replaced or removed.
 *
 * On Windows a running server holds its own executable and loaded modules open, and none of the
 * bundle's directory can be moved or deleted while it does: an update or uninstall with its servers
 * still connected failed partway through (`installEntry` now refuses whole instead, but it still
 * cannot proceed). Matched by `origin.bundle`, the same stamp that ties settings rows to the
 * bundle. One session failing to let go does not keep the others connected.
 */
export async function releaseBundle(
	// What it needs of a live session: `AgentSession.can`, and only that.
	sessions: Iterable<{ can: { disconnectMcp(match: (server: McpServerConfig) => boolean): Promise<number> } }>,
	id: string,
): Promise<void> {
	await Promise.all(
		[...sessions].map((session) => session.can.disconnectMcp((server) => server.origin?.bundle === id).catch(() => 0)),
	);
}
