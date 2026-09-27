/**
 * The three things that can be done to a bundle, and what is true while one of them is happening.
 *
 * Extracted from the card because the card is a layout and this is a state machine, and because the
 * detail page runs the same operations against the same entry — two copies of "set busy, call, read
 * the result, say something if the kind turned out different, refresh" is two places for the
 * ordering to drift.
 *
 * Every operation reports rather than throws. A failed install is a sentence the user needs to read,
 * not an exception that unmounts the grid they were reading it from — and a *successful* one that has
 * something to add ("its servers arrive switched off") is a note, not an error: it used to go through
 * the same red banner as a failure, so a working install announced itself as a problem.
 */

import { translate } from "../../i18n/translate.ts";
import { useEffect, useState } from "react";

import { isInstalled, type CatalogItem } from "./catalog.ts";
import { bridge } from "../../services/index.ts";

/** Which operation is in flight, or null. Drives the spinner and disables the controls. */
type Busy = "install" | "update" | "uninstall" | null;

export interface Install {
	busy: Busy;
	install: () => Promise<boolean>;
	update: () => Promise<boolean>;
	uninstall: () => Promise<void>;
}

export interface InstallReports {
	/** Something on disk moved; the catalogue has to be re-read. */
	onChanged: () => void;
	onError: (message: string) => void;
	/** Worth saying, and not a failure. */
	onNote?: (message: string) => void;
}

/**
 * How long a finished install keeps its spinner while the catalogue catches up.
 *
 * The install returns before the scan that shows it: between the two the card has nothing installed
 * to show and went back to 安装 for a moment, as if it had failed. The spinner stays until the item
 * reads as installed — or this long, if the scan never says so.
 */
const SETTLE_MS = 5000;

export function useInstall(item: CatalogItem, { onChanged, onError, onNote }: InstallReports): Install {
	const [busy, setBusy] = useState<Busy>(null);
	const [settling, setSettling] = useState(false);
	const installed = isInstalled(item);

	useEffect(() => {
		if (!settling) return;
		if (installed) {
			setSettling(false);
			setBusy(null);
			return;
		}
		const timer = setTimeout(() => {
			setSettling(false);
			setBusy(null);
		}, SETTLE_MS);
		return () => clearTimeout(timer);
	}, [settling, installed]);

	/**
	 * Install or replace, which is the same call with one flag.
	 *
	 * They differ in exactly one thing the user can see — the word on the button — because the flag
	 * is the whole difference on disk too: the new bundle is staged and verified either way, and
	 * `replace` only says whether an existing directory is a reason to stop.
	 */
	const run = async (replace: boolean): Promise<boolean> => {
		if (!item.entry) return false;
		setBusy(replace ? "update" : "install");
		const result = await bridge.plugins.installFromRegistry(item.entry, item.from ?? undefined, replace);
		if (!result.ok) {
			setBusy(null);
			onError(translate("install.failedWith", { name: item.name, message: result.message }));
			return false;
		}
		/*
		 * Said out loud when the index was wrong about what this is.
		 *
		 * The kind on the card came from the registry, and the registry is guessing; the clone is what
		 * settles it. Only on a first install — an update that reports the same correction every time
		 * is noise about something the user already dealt with once.
		 */
		if (!replace && result.kind && result.kind !== item.kind) {
			onNote?.(
				result.kind === "mcp"
					? translate("install.actuallyMcp", { name: item.name, n: result.servers ?? 0 })
					: translate("install.actuallyPlugin", { name: item.name }),
			);
		}
		if (replace) setBusy(null);
		else setSettling(true);
		onChanged();
		return true;
	};

	return {
		busy,
		install: () => run(false),
		update: () => run(true),
		uninstall: async () => {
			setBusy("uninstall");
			await bridge.plugins.uninstall(item.id);
			setBusy(null);
			onChanged();
		},
	};
}
