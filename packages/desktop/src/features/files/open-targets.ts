/**
 * 「用什么打开」, as the window sees it.
 *
 * The list itself is the main process's answer — which applications are installed, what this
 * platform calls its file manager, what each one's icon looks like — because none of that is
 * knowable from a page. See `electron/open-targets.ts`.
 *
 * Fetched once for the whole window rather than per component. Four different places offer to open
 * a file (the editor's toolbar, the file tree's menu, the tree's own action, the setting itself)
 * and asking each time would shell out to `mdfind` on each of them.
 */

import { useEffect, useState } from "react";
import type { OpenTarget } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/** Revealing is the one target every platform has, and the one worth falling back to. */
const REVEAL: OpenTarget = { id: "reveal", label: "在文件管理器中显示", aliases: [] };

let pending: Promise<OpenTarget[]> | null = null;
let loaded: OpenTarget[] | null = null;
const waiting = new Set<(targets: OpenTarget[]) => void>();

function load(): Promise<OpenTarget[]> {
	pending ??= bridge.system
		.openTargets()
		.catch(() => [REVEAL])
		.then((targets) => {
			loaded = targets.length > 0 ? targets : [REVEAL];
			for (const listener of waiting) listener(loaded);
			return loaded;
		});
	return pending;
}

export function useOpenTargets(): OpenTarget[] {
	const [targets, setTargets] = useState<OpenTarget[]>(() => loaded ?? [REVEAL]);

	useEffect(() => {
		if (loaded) return;
		waiting.add(setTargets);
		void load();
		return () => {
			waiting.delete(setTargets);
		};
	}, []);

	return targets;
}

/**
 * Which target a stored setting names.
 *
 * By id, then by the names earlier versions stored — `aliases` comes from the main process so the
 * mapping lives in one place. An unrecognised value keeps its own text as a label: it is a choice
 * somebody made on a machine that had that application, and this one may simply not.
 */
export function matchTarget(targets: OpenTarget[], stored: string | undefined): OpenTarget {
	const value = (stored ?? "").trim();
	if (!value) return targets[0] ?? REVEAL;
	const lower = value.toLowerCase();
	return (
		targets.find((target) => target.id === value) ??
		targets.find((target) => target.label === value || target.aliases.includes(lower)) ?? {
			id: value,
			label: value,
			aliases: [],
		}
	);
}

/**
 * What pressing it does, in words: 「在 Zed 中打开」, or 「在访达中显示」.
 *
 * Revealing is not opening-with, and a label built by slotting its name into the same sentence
 * came out as 「在 在访达中显示 中打开」. Its own label is already the whole phrase.
 */
export function openLabel(target: OpenTarget): string {
	return target.id === "reveal" ? target.label : `在 ${target.label} 中打开`;
}

/** The target the settings currently name, ready to be shown and acted on. */
export function useOpenTarget(): OpenTarget {
	const stored = useApp((s) => s.settings?.editor.defaultOpenTarget);
	return matchTarget(useOpenTargets(), stored);
}

/**
 * 「在访达中显示」 — the label for showing a file where it lives, in this platform's own words.
 *
 * The menus that offer this had it written into them in Chinese for macOS, so on Windows they
 * offered to show a file in the Finder.
 */
export function useRevealLabel(): string {
	const targets = useOpenTargets();
	return targets.find((target) => target.id === "reveal")?.label ?? REVEAL.label;
}
