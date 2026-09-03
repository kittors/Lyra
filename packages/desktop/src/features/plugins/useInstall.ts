/**
 * The three things that can be done to a bundle, and what is true while one of them is happening.
 *
 * Extracted from the card because the card is now a layout and this is a state machine, and because
 * the detail page runs the same three operations against the same entry — two copies of "set busy,
 * call, read the result, say something if the kind turned out different, refresh" is two places for
 * the ordering to drift.
 *
 * Every operation reports through `onError` rather than throwing. A failed install is a sentence
 * the user needs to read, not an exception that unmounts the grid they were reading it from.
 */

import { useState } from "react";

import type { CatalogItem } from "./catalog.ts";
import { bridge } from "../../services/index.ts";

/** Which operation is in flight, or null. Drives the spinner and disables the controls. */
export type Busy = "install" | "update" | "uninstall" | null;

export interface Install {
	busy: Busy;
	/** Whether the uninstall confirmation is showing. See the note on `Confirm`. */
	confirming: boolean;
	setConfirming: (value: boolean) => void;
	install: () => Promise<void>;
	update: () => Promise<void>;
	uninstall: () => Promise<void>;
}

export function useInstall(
	item: CatalogItem,
	/** Something on disk moved; the catalogue has to be re-read. */
	onChanged: () => void,
	onError: (message: string) => void,
): Install {
	const [busy, setBusy] = useState<Busy>(null);
	const [confirming, setConfirming] = useState(false);

	/**
	 * Install or replace, which is the same call with one flag.
	 *
	 * They differ in exactly one thing the user can see — the word on the button — because the flag
	 * is the whole difference on disk too: the new bundle is staged and verified either way, and
	 * `replace` only says whether an existing directory is a reason to stop.
	 */
	const run = async (replace: boolean) => {
		if (!item.entry) return;
		setBusy(replace ? "update" : "install");
		const result = await bridge.plugins.installFromRegistry(item.entry, item.from ?? undefined, replace);
		setBusy(null);
		if (!result.ok) {
			onError(`${item.name}：${result.message}`);
			return;
		}
		/*
		 * Said out loud when the index was wrong about what this is.
		 *
		 * The kind on the card came from the registry, and the registry is guessing; the clone is
		 * what settles it. Landing an MCP server in the plugins tab without a word would leave
		 * someone looking for it under the wrong heading, and its servers arrive switched off, so
		 * there is a second thing to do that nothing else would mention.
		 *
		 * Only on a first install. An update that reports the same correction every time is noise
		 * about something the user already dealt with once.
		 */
		// `kind` is absent when the main process predates the split — say nothing rather than
		// claim it turned out to be something else.
		if (!replace && result.kind && result.kind !== item.kind) {
			onError(
				result.kind === "mcp"
					? `${item.name} 其实是一个 MCP 服务，已装到「MCP 服务」下；它的 ${result.servers} 个服务默认关着，去设置 › MCP 里开。`
					: `${item.name} 其实是一个插件，已装到「插件」下。`,
			);
		} else if (!replace && result.kind === "mcp") {
			onError(`${item.name} 已安装，${result.servers} 个服务默认关着——去设置 › MCP 里开。`);
		}
		onChanged();
	};

	return {
		busy,
		confirming,
		setConfirming,
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
