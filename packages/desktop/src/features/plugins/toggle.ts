/**
 * Switching a plugin on or off, as a decision rather than a handler.
 *
 * Two screens do this now — the settings list and the catalogue card — and it is not the one-line
 * set-add-or-delete it looks like, because of the wildcard. Written twice it would be right in one
 * place and subtly wrong in the other, and the wrong one produces a switch that reports a change
 * and makes none: the id is removed, `*` stays, and everything is still off after a reload.
 *
 * A pure function over the settings, so the rule can be tested without a renderer.
 */

import type { Plugin, Settings } from "@lyra/core";

/**
 * The settings after this plugin is switched on or off.
 *
 * `*` in `disabledPlugins` means "none of them", whoever wrote it there — a session that has to be
 * reproducible sets it without knowing what is installed. Turning one plugin back on therefore
 * means naming what the wildcard stood for: everything currently on disk except this one. Leaving
 * the wildcard in place while deleting the id is the bug this function exists to prevent.
 *
 * `installed` is every plugin the scan found, and it is only read on that one path.
 */
export function settingsAfterToggle(
	settings: Settings,
	plugin: Plugin,
	enabled: boolean,
	installed: Plugin[],
): Settings {
	const disabled = new Set(settings.disabledPlugins);
	if (disabled.has("*") && enabled) {
		disabled.delete("*");
		for (const other of installed) if (other.id !== plugin.id) disabled.add(other.id);
	}
	if (enabled) {
		disabled.delete(plugin.id);
		/*
		 * And whatever it used to be called.
		 *
		 * `disabledPlugins` holds whatever `id` meant when the user switched something off, which for
		 * entries written by older versions was the manifest's name rather than the directory. The
		 * loader reads both when deciding `enabled`, so switching on has to clear both or the plugin
		 * comes back off — see the note beside that check in `loader.ts`.
		 */
		if (plugin.manifest.name) disabled.delete(plugin.manifest.name);
	} else {
		disabled.add(plugin.id);
	}
	return { ...settings, disabledPlugins: [...disabled] };
}
