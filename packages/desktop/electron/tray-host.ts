/**
 * Whether a status bar icon can be seen on this Linux desktop.
 *
 * `new Tray()` succeeds on stock GNOME and draws nothing. Electron registers the icon with the
 * session bus's `org.kde.StatusNotifierWatcher` when there is one; when there is not, it falls
 * back to an XEmbed GtkStatusIcon, which GNOME Shell stopped showing in 3.26 and which a Wayland
 * session cannot show at all (XEmbed is an X11 protocol). The app took "a Tray object exists" as
 * "there is a way back", so closing the window hid it with nothing left on screen to click.
 *
 * So on Linux the watcher is asked about: `dbus-send` or `gdbus`, with a timeout, answering "yes",
 * "no" or — when neither tool is there or neither replies — nothing, in which case the old
 * assumption stands. No watcher only means no icon where XEmbed cannot help: a Wayland session, or
 * GNOME. An X11 desktop like i3 or an older Xfce may still have an XEmbed tray, and there nothing
 * changes. No Electron here; the caller runs the commands.
 */

const WATCHER = "org.kde.StatusNotifierWatcher";

/** The two ways to ask the bus `NameHasOwner`, in the order they are tried. */
const PROBES: { file: string; args: string[] }[] = [
	{
		file: "dbus-send",
		args: ["--session", "--print-reply", "--reply-timeout=1000", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", `string:${WATCHER}`],
	},
	{
		file: "gdbus",
		args: ["call", "--session", "--timeout", "1", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", WATCHER],
	},
];

/** `boolean true` from dbus-send, `(true,)` from gdbus; null for anything else. */
export function parseNameHasOwner(stdout: string): boolean | null {
	const match = /\bboolean\s+(true|false)\b/.exec(stdout) ?? /^\((true|false),\)/m.exec(stdout.trim());
	return match ? match[1] === "true" : null;
}

/** `run` resolves null when the command is missing, fails or times out. */
export async function probeStatusNotifierHost(
	run: (file: string, args: string[]) => Promise<{ stdout: string } | null>,
): Promise<boolean | null> {
	for (const probe of PROBES) {
		const result = await run(probe.file, probe.args);
		const answer = result ? parseNameHasOwner(result.stdout) : null;
		if (answer !== null) return answer;
	}
	return null;
}

export function trayVisible(state: {
	platform: string;
	/** Whether a Tray was created at all — `createTray` skips it when the icon files are missing. */
	created: boolean;
	env: NodeJS.ProcessEnv;
	/** Whether the session bus has a StatusNotifierWatcher; null when it could not be asked. */
	watcher: boolean | null;
}): boolean {
	if (!state.created) return false;
	if (state.platform !== "linux" || state.watcher !== false) return true;
	const wayland = state.env.XDG_SESSION_TYPE === "wayland" || Boolean(state.env.WAYLAND_DISPLAY);
	const gnome = (state.env.XDG_CURRENT_DESKTOP ?? "").split(":").some((desktop) => desktop.trim().toUpperCase() === "GNOME");
	return !(wayland || gnome);
}
