/**
 * 「开机时启动」 on Linux: an XDG autostart entry, because Electron has no implementation there.
 *
 * `app.setLoginItemSettings` is macOS and Windows only. On Linux it does nothing and
 * `getLoginItemSettings().openAtLogin` is always false, so the tray's checkbox never stayed ticked
 * and nothing started at login. Every Linux desktop that autostarts anything reads
 * `$XDG_CONFIG_HOME/autostart/*.desktop` (the XDG Autostart spec), so that file is the setting:
 * present and not disabled means on, absent means off.
 *
 * No Electron here; the caller supplies what it knows about how this copy was launched.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/**
 * The same name as the installed launcher — `desktopName` in package.json, which a test holds to
 * this. A desktop that shows autostart entries in its settings then lists the familiar one.
 */
export const DESKTOP_FILE = "Lyra.desktop";

export function autostartFile(env: NodeJS.ProcessEnv, home: string): string {
	// The Base Directory spec: a relative XDG_CONFIG_HOME is invalid and must be ignored.
	const configured = env.XDG_CONFIG_HOME?.trim();
	const config = configured && isAbsolute(configured) ? configured : join(home, ".config");
	return join(config, "autostart", DESKTOP_FILE);
}

/**
 * What to run at login.
 *
 * An AppImage runs from a temporary mount that is gone after it exits — `execPath` there is
 * `/tmp/.mount_Lyra…/lyra` — so the entry names the AppImage file itself (`$APPIMAGE`). A package
 * runs the binary where it was installed; a development run is Electron plus the source directory.
 */
export function autostartArgv(from: { appImage?: string; packaged: boolean; execPath: string; appPath: string }): string[] {
	if (from.appImage) return [from.appImage];
	return from.packaged ? [from.execPath] : [from.execPath, from.appPath];
}

/** Characters that force an Exec argument into quotes (Desktop Entry spec, "The Exec key"). */
const RESERVED = /[\s"'\\><~|&;$*?#()`]/;

/**
 * One Exec argument.
 *
 * Three layers, in the spec's order: a literal `%` is written `%%` so it is not a field code;
 * an argument with a reserved character is quoted, with `"`, `` ` ``, `$` and `\` escaped inside;
 * and then the whole value is a *string*, whose own escaping doubles every backslash again — which
 * is why a literal backslash ends up as four and a `$` as `\\$`, exactly as the spec's examples say.
 */
function execArgument(argument: string): string {
	if (/[\r\n]/.test(argument)) throw new Error("an autostart command cannot contain a line break");
	const percent = argument.replaceAll("%", "%%");
	return RESERVED.test(percent) ? `"${percent.replace(/(["`$\\])/g, "\\$1")}"` : percent;
}

export function autostartEntry(argv: string[]): string {
	const exec = argv.map(execArgument).join(" ").replaceAll("\\", "\\\\");
	return ["[Desktop Entry]", "Type=Application", "Name=Lyra", `Exec=${exec}`, "Icon=Lyra", "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

/**
 * Whether an entry will actually start anything.
 *
 * A file can be present and off: `Hidden=true` is the spec's way of disabling an entry, and GNOME's
 * own settings write `X-GNOME-Autostart-enabled=false`. Only the `[Desktop Entry]` group counts.
 */
export function autostartEnabled(content: string): boolean {
	let main = false;
	for (const raw of content.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[")) {
			main = line === "[Desktop Entry]";
			continue;
		}
		if (!main) continue;
		if (/^Hidden\s*=\s*true$/i.test(line)) return false;
		if (/^X-GNOME-Autostart-enabled\s*=\s*false$/i.test(line)) return false;
	}
	return true;
}

export function readAutostart(file: string): boolean {
	try {
		return autostartEnabled(readFileSync(file, "utf8"));
	} catch {
		return false;
	}
}

/** On writes a fresh entry — replacing one someone disabled by hand; off removes the file. */
export function writeAutostart(file: string, enabled: boolean, argv: string[]): void {
	if (!enabled) {
		rmSync(file, { force: true });
		return;
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, autostartEntry(argv), { mode: 0o644 });
}
