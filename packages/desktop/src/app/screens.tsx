/**
 * The screens that are not a conversation, fetched when they are first wanted — or a little before.
 *
 * All five are reachable from the rail and none of them is where the window opens. Settings is the
 * largest by a distance — the appearance page alone carries the code themes and every font preview —
 * and until it was split out all of it was in the bundle before the first message rendered. The phone
 * is why splitting is worth doing at all: it loads the same bundle over the network, through a relay
 * that crosses the public internet twice.
 *
 * Pointed at the component files, not at the domains' `index.ts`. Going through the front door is the
 * rule everywhere else, and here it silently undoes the split: the index is also imported statically
 * from elsewhere, so Rollup sees the whole domain reachable from the entry and merges it back into the
 * main chunk — measured, 2.32MB through the index against 1.69MB through the component file.
 * `e2e/lazy-views.test.ts` opens each of these; whether they are still apart shows only in the chunk
 * names under `out/renderer/assets`, since a merge back changes no behaviour at all.
 *
 * Fetched ahead as well, which `lazy` alone cannot make use of. Its payload starts uninitialised and
 * only a render initialises it, so the first render suspends even with the chunk already here — and
 * React 19 holds a fallback it has revealed for 300ms before content may replace it. The first visit
 * to 创作 showed its skeleton from 55ms to 355ms, for a 54KB chunk that had arrived in a few. So a
 * screen whose chunk is here renders the component itself, and `lazy` keeps the case it is good at:
 * holding the tree still while a chunk is genuinely on its way.
 */

import { lazy, useEffect, useState } from "react";
import { onPhone } from "../services/index.ts";
import { useApp } from "../store/index.ts";
import { hearScreenReach } from "./screen-reach.ts";

interface Screen {
	/** The view: the component itself once its chunk is here, `lazy` until then. */
	View: React.ComponentType;
	/** Ask for the chunk now. One request however often it is called; a failed one may be asked again. */
	preload: () => Promise<void>;
}

export function preloadableScreen(load: () => Promise<React.ComponentType>): Screen {
	let ready: React.ComponentType | null = null;
	let fetching: Promise<void> | null = null;
	const preload = () =>
		(fetching ??= load().then(
			(component) => {
				ready = component;
			},
			(error: unknown) => {
				fetching = null;
				throw error;
			},
		));
	const Lazy = lazy(async () => {
		await preload();
		return { default: ready as React.ComponentType };
	});
	function View() {
		// Chosen once per mount: trading the lazy wrapper for the component under it would remount the page.
		const [Kind] = useState<React.ComponentType>(() => ready ?? Lazy);
		return <Kind />;
	}
	return { View, preload };
}

export const screens = {
	plugins: preloadableScreen(() => import("../features/plugins/PluginsView.tsx").then((m) => m.PluginsView)),
	"pull-requests": preloadableScreen(() => import("../features/pull-requests/PullRequestsView.tsx").then((m) => m.PullRequestsView)),
	scheduled: preloadableScreen(() => import("../features/scheduled/ScheduledView.tsx").then((m) => m.ScheduledView)),
	gallery: preloadableScreen(() => import("../features/gallery/GalleryView.tsx").then((m) => m.GalleryView)),
	settings: preloadableScreen(() => import("../features/settings/SettingsShell.tsx").then((m) => m.SettingsShell)),
};

type ScreenName = keyof typeof screens;

/**
 * What reaching for a screen starts besides its code: 创作's list, read in 25–50ms, which is otherwise
 * read only once the page is up. Not done on idle — the first read loads every conversation that has a
 * picture in it, which is the main process's time and nobody has asked yet.
 */
const WARM: Partial<Record<ScreenName, () => Promise<unknown>>> = {
	gallery: () => import("../features/gallery/GalleryView.tsx").then((m) => m.warmGallery()),
};

/** Fetch a screen ahead of the click — what the rail's buttons ask for when the pointer reaches them (`screen-reach.ts`). */
function preloadScreen(name: string): void {
	if (!(name in screens)) return;
	void screens[name as ScreenName].preload().catch(() => {});
	void WARM[name as ScreenName]?.().catch(() => {});
}

/**
 * Fetched while the window is idle: the four small ones, 14–130KB each.
 *
 * Not settings, at 3MB: parsing it is a long task, and one landing under a click is the very stall
 * this is here to remove. Its rail button fetches it on hover instead. And not on the phone, where the
 * bundle crosses a relay and four screens nobody asked for would queue in front of what was.
 */
const IDLE: readonly ScreenName[] = ["gallery", "plugins", "pull-requests", "scheduled"];

export function usePreloadScreens(): void {
	const ready = useApp((s) => s.ready);
	useEffect(() => hearScreenReach(preloadScreen), []);
	useEffect(() => {
		if (!ready || onPhone()) return;
		let next = 0;
		let handle = 0;
		let stopped = false;
		// Asked rather than assumed: the DOM the unit tests run in has no idle callbacks.
		const idle = typeof window.requestIdleCallback === "function";
		// One per idle period, so each chunk's parse is a slice of spare time rather than one long task.
		const step = () => {
			const name = IDLE[next++];
			if (name) void screens[name].preload().catch(() => {}).finally(schedule);
		};
		const schedule = () => {
			if (stopped) return;
			handle = idle ? window.requestIdleCallback(step, { timeout: 4000 }) : window.setTimeout(step, 600);
		};
		schedule();
		return () => {
			stopped = true;
			if (idle) window.cancelIdleCallback(handle);
			else window.clearTimeout(handle);
		};
	}, [ready]);
}
