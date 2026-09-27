/**
 * What was installed, and how to tell whether it has since been superseded.
 *
 * Split from `installs.ts`, which reads and writes the ledger, because this half has to run in the
 * renderer. The two facts being compared meet there and nowhere else: what is on disk comes from
 * the main process's scan, what is on offer comes from a registry the window fetched itself. A
 * renderer that imported the reading half would pull `node:fs` into a browser bundle and blank the
 * window on the first import — see the note in AGENTS.md about sub-entries.
 *
 * So: no imports, no bindings, nothing but a type and a comparison.
 */

/** What was installed, as it was described at the moment it was installed. */
export interface InstallRecord {
	/** The registry entry's id, which is also the directory name it was installed as. */
	id: string;
	/** The version the registry advertised. Often absent or meaningless — see `isOutdated`. */
	version?: string;
	/** The upstream commit the archive was built from. The reliable one. */
	commit?: string;
	/** Hash of the archive that was downloaded, when it arrived as one rather than as a clone. */
	sha256?: string;
	/** Which registry it came from, for the rare case of two offering the same id. */
	from?: string;
	/**
	 * For a skill collection: the directories it put among the loose skills, by name. Removing the
	 * collection removes these and nothing else — see `collectionDirs` in `registry.ts`.
	 */
	skills?: string[];
	installedAt: string;
}

/**
 * Whether what is installed is behind what the registry now offers.
 *
 * Three comparisons, in descending order of how much they can be trusted, and **silence when none
 * of them applies**. Claiming an update that is not there is worse than missing one: it puts a
 * badge on a card that pressing the button beside it cannot clear, because there was nothing to
 * install and the next scan will say the same thing again.
 *
 *   - `commit` — resolved by the platform against the upstream ref at build time. If both sides
 *     have one and they differ, something upstream genuinely moved.
 *   - `sha256` — of the built archive. It identifies a build rather than a content, since gzip
 *     output is runtime-dependent, so it can say "not the same build" and never "same content".
 *   - `version` — last, because most of this catalogue has no real one. `waza` publishes
 *     `0.0.0-30bf9a1`, derived from a commit, and `anthropic-skills` publishes `0.0.0`: the first
 *     differs whenever the commit moves and the second never differs at all.
 *
 * Compared for inequality only, never for order. `2026.7.4` and `0.3.7` are both live in this
 * catalogue and there is no ordering that reads both correctly — and "different" is the whole
 * question anyway, since a registry serving an older build is still serving what it now offers.
 */
export function isOutdated(
	record: InstallRecord | undefined | null,
	offered: { commit?: string; sha256?: string; version?: string; path?: string } | null | undefined,
): boolean {
	if (!record || !offered) return false;
	/*
	 * One directory of a repository that holds many: its commit is the whole repository's.
	 *
	 * The default registry's MCP wrappers all live in one repository, so a commit that touches one of
	 * them moves the commit of every one — and each installed wrapper then read as "has an update",
	 * which (updates being automatic) restarted every MCP server somebody had, for nothing. What does
	 * say whether *this* directory changed is the version it publishes, when it publishes a real one:
	 * a wrapper's is its upstream package's. A derived `0.0.0-<sha>` is the commit again, and `0.0.0`
	 * is nothing at all, so those fall through to the commit as before.
	 */
	const released = (version: string | undefined) => !!version && version !== "0.0.0" && !version.startsWith("0.0.0-");
	if (offered.path && released(offered.version) && record.version === offered.version) return false;
	if (record.commit && offered.commit) return record.commit !== offered.commit;
	if (record.sha256 && offered.sha256) return record.sha256 !== offered.sha256;
	if (record.version && offered.version) return record.version !== offered.version;
	/*
	 * Nothing comparable on both sides, so nothing is claimed.
	 *
	 * Two populations land here and both must stay quiet: bundles installed before the ledger
	 * existed, which have no record at all, and registries that publish none of the three fields.
	 */
	return false;
}
