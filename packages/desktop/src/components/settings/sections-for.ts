/**
 * Which settings pages this device has any business showing.
 *
 * The phone displays the desktop's settings, and most of them belong there — which model to use,
 * what the app looks like, what an agent may do without asking. A few do not: they describe the
 * machine sitting in front of the desktop, and from a phone they are a page of controls that
 * either do nothing or do something whose result you cannot see.
 *
 * Kept out of the component because the interesting part is the rule, not the rendering, and
 * because "the settings page went blank" is a bug worth a test rather than a bug report.
 */

import type { SettingsSection } from "../../store.ts";

/**
 * Pages about hardware or a filesystem the phone is not holding.
 *
 *   screenshot   captures the desktop's own display
 *   browser      an Electron window over there
 *   worktrees    directories on its disk
 *   index        rebuilds an index of files this device cannot read
 *   formatting   runs formatters installed on that machine
 *   commands     shells out on that machine
 *   hooks        scripts that fire on that machine
 *   sync         where the phone is configured *from*; configuring it here is a loop
 *
 * Hidden rather than disabled: a page of greyed-out controls is a page you have to read before you
 * can ignore it. This is presentation only — what the phone may actually do is the allowlist in
 * `sync-rpc.ts`, which does not trust the interface to enforce anything.
 */
export const HIDDEN_ON_MOBILE: ReadonlySet<SettingsSection> = new Set<SettingsSection>([
	"screenshot",
	"browser",
	"worktrees",
	"index",
	"formatting",
	"commands",
	"hooks",
	"sync",
]);

export interface SettingsGroup<T> {
	label: string;
	items: T[];
}

/**
 * The groups this host should show, with empty ones dropped.
 *
 * A group whose every item was hidden would otherwise render as a heading with nothing under it,
 * which reads as a section that failed to load rather than one that does not apply.
 */
export function groupsFor<T extends { id: SettingsSection }>(
	groups: readonly SettingsGroup<T>[],
	onPhone: boolean,
): SettingsGroup<T>[] {
	if (!onPhone) return groups.map((group) => ({ ...group, items: [...group.items] }));
	return groups
		.map((group) => ({ ...group, items: group.items.filter((item) => !HIDDEN_ON_MOBILE.has(item.id)) }))
		.filter((group) => group.items.length > 0);
}

/**
 * The page to show, given the one that was asked for.
 *
 * Someone can arrive at a hidden section without choosing it: the desktop remembers where it was,
 * and that memory is shared. Left alone, the phone would render a heading and an empty page with
 * no row selected and no way to tell what went wrong. Falling back to the first available section
 * is the difference between that and simply landing somewhere sensible.
 */
export function sectionFor<T extends { id: SettingsSection }>(
	groups: readonly SettingsGroup<T>[],
	wanted: SettingsSection,
	onPhone: boolean,
): SettingsSection {
	const available = groupsFor(groups, onPhone).flatMap((group) => group.items);
	if (available.some((item) => item.id === wanted)) return wanted;
	return available[0]?.id ?? wanted;
}
