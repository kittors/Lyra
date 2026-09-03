/**
 * What a phone is allowed to change about the desktop's settings.
 *
 * `settings.save` used to take whatever arrived and write it to disk as the complete settings. That
 * is wrong twice over.
 *
 * The first is safety. `hooks` and `scheduledTasks` are lists of shell commands the desktop runs on
 * its own, and `mcpServers` is a list of processes it launches — so the pairing token, which lives
 * in a phone that can be lost, was enough to run anything on the machine. The allowlist in
 * `sync-rpc.ts` is careful to leave out every method that reaches the shell, and this one method
 * quietly handed back the same reach through the back door.
 *
 * The second is that a partial object replaced a complete one. The phone sends what it has; if the
 * two ends are not the same version, or a field was dropped in transit, the fields it did not send
 * are gone from disk. That is how a light theme with nothing else in it reached the renderer and
 * took the window down with `hex.trim` — a settings object with only `theme` in its `appearance`.
 *
 * Both are answered the same way: start from what the desktop currently has and lay only the
 * permitted fields over it. The result is always complete, and never contains anything a phone had
 * no business setting.
 */

import type { Settings } from "@lyra/core";

/**
 * Fields a phone may write.
 *
 * The test of membership is not "would this be convenient" but "can the phone see what it did, and
 * does setting it hand anyone the machine". Everything here is either about the interface or about
 * which model answers; nothing here starts a process, runs a command, or reaches the filesystem.
 *
 *   appearance         the theme, which is the whole point of syncing it
 *   defaultModelId     which model a new conversation uses
 *   favoriteModelIds   the shortlist in the model menu
 *   thinking           reasoning depth, per the picker in the composer
 *   lastThinking       where that picker was left, so the two ends agree on it
 *   permissionMode     whether a tool call waits for approval — approving from a phone is most of
 *                      why this feature exists, and the mode has to be reachable from there too
 *   alwaysAllow        what was approved for good, which is written by approving on the phone
 *   personalization    how the agent addresses you
 *   disabledPlugins    switching a plugin off, which runs nothing by itself
 *   pinnedSessionIds   pinning a conversation
 *   commitLanguage     the language commit messages are written in
 *   retryAttempts      how many times a failed request is retried
 *   editor             which editor "open in" uses on the *desktop* — harmless, and the setting
 *                      lives on the page the phone can see
 *
 * Deliberately absent, each because setting it runs code or moves the ground under the connection:
 * `hooks`, `scheduledTasks`, `mcpServers`, `formatting`, `worktrees`, `screenshot`, `projects`,
 * `sync`, `pluginRegistries`, `skillRegistries`, `allowedHosts`, `searchProvider`,
 * `searchApiKeys`, `providers`, `version`, `updateCheckIntervalHours`.
 *
 * `providers` is the one that looks like it belongs and does not: it carries API keys, and a phone
 * that could write them could also read back what it wrote. Choosing among the models already
 * configured is `defaultModelId`, which is here.
 */
export const PHONE_WRITABLE = [
	"appearance",
	"defaultModelId",
	"favoriteModelIds",
	"thinking",
	"lastThinking",
	"permissionMode",
	"alwaysAllow",
	"personalization",
	"disabledPlugins",
	"pinnedSessionIds",
	"commitLanguage",
	"retryAttempts",
	"editor",
] as const satisfies readonly (keyof Settings)[];

/**
 * The settings to actually save, given what a phone sent.
 *
 * Anything unrecognised is dropped rather than rejected: an older desktop paired with a newer phone
 * should ignore a field it does not know, not refuse the save and leave the phone unable to change
 * its own theme.
 */
export function settingsFromPhone(current: Settings, incoming: unknown): Settings {
	if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return current;
	const sent = incoming as Partial<Settings>;

	const patch: Partial<Settings> = {};
	for (const key of PHONE_WRITABLE) {
		// `undefined` is not a value to write — it is the field being absent, and writing it would
		// delete what the desktop has.
		if (sent[key] !== undefined) patch[key] = sent[key] as never;
	}

	/*
	 * `appearance` is merged a level deeper, because it is the one writable field that is an object
	 * rather than a value.
	 *
	 * A shallow spread replaces it whole, so a phone sending `{ theme: "light" }` — which is what a
	 * partial or older client sends — would drop the font sizes, the code themes and the content
	 * width along with it. That is the same failure as the one this file exists for, one level in:
	 * the desktop's own text visibly changed size the first time this was tested.
	 */
	if (patch.appearance) patch.appearance = { ...current.appearance, ...patch.appearance };

	return { ...current, ...patch };
}
