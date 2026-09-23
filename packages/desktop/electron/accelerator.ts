/**
 * The screenshot shortcut: which accelerator to register, and what became of registering it.
 *
 * `globalShortcut.register` has two ways to fail and neither reached the user. It returns false
 * when another application already holds the combination — the default Alt+A is WeChat's
 * screenshot key on Windows — and throws on one it cannot parse. Both were a `console.warn`, so the
 * settings page went on showing a shortcut that did nothing. The outcome is now a value the caller
 * can report.
 *
 * No Electron here: `register` is passed in, so both failures can be produced in a test.
 */

export type ShortcutOutcome =
	| { state: "off" }
	| { state: "registered"; shortcut: string }
	/** `register` said no: something else on the system has this combination. */
	| { state: "taken"; shortcut: string }
	/** `register` threw: this is not an accelerator Electron understands. */
	| { state: "invalid"; shortcut: string; reason: string };

/**
 * The accelerator to register for what the settings say.
 *
 * Settings sync between machines, and one recorded — or typed — on a Mac can say `Cmd` or
 * `Command`. On Windows and Linux Electron reads those as the Windows/Super key, not Ctrl, so the
 * shortcut never registers there (Win+Shift+S is the system's own snipping key). `CommandOrControl`
 * is the same key on a Mac and Ctrl everywhere else, which is what was meant. `Option` is macOS's
 * name for Alt, which Electron does not accept at all.
 */
export function normalizeShortcut(raw: string): string {
	return raw
		.trim()
		.split("+")
		.map((token) => {
			const name = token.trim();
			if (/^(cmd|command)$/i.test(name)) return "CommandOrControl";
			if (/^option$/i.test(name)) return "Alt";
			return name;
		})
		.join("+");
}

export function registerShortcut(options: {
	raw: string | undefined;
	enabled: boolean;
	register: (accelerator: string) => boolean;
}): ShortcutOutcome {
	const shortcut = normalizeShortcut(options.raw ?? "");
	if (!options.enabled || !shortcut) return { state: "off" };
	try {
		return options.register(shortcut) ? { state: "registered", shortcut } : { state: "taken", shortcut };
	} catch (error) {
		return { state: "invalid", shortcut, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * What identifies a failure worth announcing, or null for an outcome that is not one.
 *
 * The shortcut is re-registered after every settings change — any setting, not only this one — so
 * without this a taken Alt+A would be announced again each time the theme was switched. The caller
 * announces only when this differs from the last one it announced.
 */
export function shortcutFailureKey(outcome: ShortcutOutcome): string | null {
	return outcome.state === "taken" || outcome.state === "invalid" ? `${outcome.state}:${outcome.shortcut}` : null;
}
