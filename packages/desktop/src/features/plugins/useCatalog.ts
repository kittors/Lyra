/**
 * Reading the catalogue: the three sources, fetched and kept fresh.
 *
 * The shape of what comes out, and the rules for merging it, are in `catalog.ts` — separated
 * because those are decisions about data and these are decisions about when to ask for it. The
 * split is also what makes the merge testable without a renderer.
 */

import type { InstallRecord, Plugin, PluginDiagnostic, RegistryEntry, Skill } from "@lyra/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useApp } from "../../store/index.ts";
import { merge, type CatalogItem } from "./catalog.ts";
import { useLocalScan } from "./useLocalScan.ts";
import { bridge } from "../../services/index.ts";

/*
 * How often an open catalogue re-reads its registries on its own.
 *
 * The main process caches an index for ten minutes, so asking more often than that only returns the
 * same copy. Coming back to the window after a while counts too — see the focus listener below.
 */
const REVALIDATE_MS = 10 * 60 * 1000;

export interface Catalog {
	items: CatalogItem[];
	/** Every plugin on disk, for the switch that has to name them all when it clears `*`. */
	plugins: Plugin[];
	skills: Skill[];
	/** Registries that answered with something other than a list. */
	errors: { url: string; message: string }[];
	diagnostics: PluginDiagnostic[];
	loading: boolean;
	localLoading: boolean;
	/** Configured registry URLs, so an empty page can tell the difference from an empty registry. */
	sources: string[];
	/** When the registries last answered, for 「刚刚更新」 beside the refresh button. */
	fetchedAt: number | null;
	refresh: () => void;
}

/**
 * The last answer per set of sources, for the lifetime of this window.
 *
 * Module-level rather than in a store because nothing else needs it and nothing else may write it:
 * it is not state anyone acts on, it is the reply we already got.
 */
const seen = new Map<string, { remote: { from: string; entry: RegistryEntry }[]; errors: { url: string; message: string }[]; at: number }>();

/** Each source's entries as last read successfully, by URL — what it keeps showing while a read fails. */
const lastGood = new Map<string, { from: string; entry: RegistryEntry }[]>();

/** The sources, as one string — the identity a cached answer belongs to. */
function urlsKeyOf(settings: { pluginRegistries?: string[]; skillRegistries?: string[] } | null | undefined): string {
	return [...(settings?.pluginRegistries ?? []), ...(settings?.skillRegistries ?? [])].join("|");
}

export function useCatalog(): Catalog {
	const settings = useApp((s) => s.settings);
	/*
	 * The shared "something was installed" signal.
	 *
	 * This view is not the only one showing these directories — 设置 › 插件 and the tab counts
	 * read them too — and any of them can be the one that changed them. Listening to the same
	 * counter is what stops the other pages from showing a moment ago.
	 */
	const bumpExtensions = useApp((s) => s.bumpExtensions);
	/*
	 * The disk, through the one scan every page shares — see `useLocalScan`. Fields defaulted, because
	 * the main process does not hot-reload: during a dev session where the renderer has new code and
	 * the main process has old, a field it does not send yet must cost its rows, not the page.
	 */
	const { scan, fresh } = useLocalScan();
	const local = useMemo(
		() => ({
			plugins: scan?.plugins ?? [],
			mcpBundles: scan?.mcpBundles ?? [],
			skills: scan?.skills ?? [],
			diagnostics: scan?.pluginDiagnostics ?? [],
			installs: (scan?.installs ?? {}) as Record<string, InstallRecord>,
		}),
		[scan],
	);
	/*
	 * Seeded from the last answer for the same sources, so leaving and coming back shows the shop
	 * rather than rebuilding it.
	 *
	 * The main process caches the fetch, which stops the network traffic but not the flicker: the
	 * reply still arrives a tick later, and for that tick the view has nothing and renders its
	 * loading state. What the eye reads is the catalogue emptying and refilling every visit. This
	 * is the same data, held where the first render can already see it.
	 *
	 * Deliberately not persisted. It lives as long as the window does, which is exactly as long as
	 * "I was just looking at this" is true.
	 */
	const [remote, setRemote] = useState<{ from: string; entry: RegistryEntry }[]>(() => seen.get(urlsKeyOf(settings))?.remote ?? []);
	const [errors, setErrors] = useState<{ url: string; message: string }[]>(() => seen.get(urlsKeyOf(settings))?.errors ?? []);
	const [loading, setLoading] = useState(() => !seen.has(urlsKeyOf(settings)));
	const [fetchedAt, setFetchedAt] = useState<number | null>(() => seen.get(urlsKeyOf(settings))?.at ?? null);
	/*
	 * Bumped by 刷新, and the only thing that makes the fetch ignore the cache.
	 *
	 * Kept separate from `nonce` because they mean different things: mounting the view again is not
	 * a request for fresh data, and treating it as one is what made the shop reload every time you
	 * looked at it.
	 */
	const [forced, setForced] = useState(0);
	const [nonce, setNonce] = useState(0);

	/*
	 * The configured list is a fresh array on every render and its contents almost never change.
	 * Keying the effect on the joined string and rebuilding from that is what stops every registry
	 * being re-fetched whenever an unrelated piece of state moves, and it keeps the dependency
	 * honest: the value the effect reads is the value it depends on.
	 */
	/*
	 * Both indexes, fetched as one list.
	 *
	 * They are configured separately because they answer separate questions, but by the time an
	 * entry is here it carries its own `kind` and the catalogue files it accordingly — a skill
	 * collection from the skill index and a plugin from the plugin index arrive as the same shape.
	 * Keeping two parallel fetches, two loading flags and two error lists would be two of everything
	 * to express one difference that is already in the data.
	 */
	const urlsKey = urlsKeyOf(settings);
	const urls = useMemo(() => (urlsKey ? urlsKey.split("|") : []), [urlsKey]);

	const localLoading = !fresh;

	useEffect(() => {
		let cancelled = false;
		if (urls.length === 0) {
			setRemote([]);
			setErrors([]);
			setLoading(false);
			return;
		}
		/*
		 * Only when there is nothing to show. A revalidation behind a full catalogue is not a wait,
		 * and dressing it as one replaces what you were reading with a loading state.
		 */
		const first = !seen.has(urlsKey);
		if (first) setLoading(true);
		const read = (allowStale: boolean) => Promise.all(urls.map((url) => bridge.plugins.fetchRegistry(url, forced > 0, allowStale)));
		const apply = (results: Awaited<ReturnType<typeof read>>, stale: boolean) => {
			const entries = results.flatMap((result, i) => {
				const url = urls[i] ?? "";
				if (result.ok) {
					const these = result.registry.entries.map((entry) => ({ from: result.registry.name, entry }));
					lastGood.set(url, these);
					return these;
				}
				// A source that could not be read this time keeps what it showed last; the error still says so.
				return lastGood.get(url) ?? [];
			});
			setRemote(entries);
			const failures = results.flatMap((result, i) => (result.ok ? [] : [{ url: urls[i], message: result.message }]));
			setErrors(failures);
			setLoading(false);
			const at = stale ? 0 : Date.now();
			if (!stale) setFetchedAt(at);
			seen.set(urlsKey, { remote: entries, errors: failures, at });
		};
		void (async () => {
			/*
			 * The first look this launch draws the catalogue kept from the last one straight away, and
			 * then reads the real one behind it — a market that opens on its cards and quietly corrects
			 * itself, rather than on a skeleton for the seconds a fetch takes. A kept copy is marked
			 * `stale`, and only when one was used is the second read needed.
			 */
			if (first && forced === 0) {
				const kept = await read(true);
				if (cancelled) return;
				const stale = kept.some((result) => result.ok && result.stale);
				apply(kept, stale);
				if (!stale) return;
			}
			const results = await read(false);
			if (cancelled) return;
			apply(results, false);
		})();
		return () => {
			cancelled = true;
		};
	}, [urls, urlsKey, nonce, forced]);

	/*
	 * Kept current while it is open, and when it is looked at again after a while.
	 *
	 * A registry is rebuilt from its upstreams on a schedule; a window left on this page all afternoon
	 * went on showing the morning's catalogue until somebody pressed 刷新. Re-reading goes through the
	 * main process's cache, so this costs nothing when nothing has changed.
	 */
	useEffect(() => {
		const again = () => setNonce((n) => n + 1);
		const timer = setInterval(again, REVALIDATE_MS);
		const onFocus = () => {
			const last = seen.get(urlsKey)?.at ?? 0;
			if (Date.now() - last > REVALIDATE_MS / 2) again();
		};
		window.addEventListener("focus", onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [urlsKey]);

	/*
	 * Settings is where an MCP bundle's servers live, so the merge has to read it.
	 *
	 * Not the bundle's own `.mcp.json`: what the user has is whatever they edited on the MCP page
	 * — a Filesystem pointed at their own directory, a server they switched off. The declaration
	 * on disk is only the starting point it was installed from.
	 */
	const merged = useMemo(
		() =>
			merge(
				localLoading ? [] : local.plugins,
				localLoading ? [] : local.mcpBundles,
				settings?.mcpServers ?? [],
				remote,
				localLoading ? [] : local.skills,
				localLoading ? {} : local.installs,
			),
		// `settings` rather than `settings.mcpServers`: the list is a fresh array on every render,
		// the object it hangs off is not — it is only replaced when something is actually saved.
		[local, settings, remote, localLoading],
	);

	/*
	 * Logos somebody picked for their entry on purpose — a maintainer's upload, or the bundle's own
	 * file, as the registry reports it (`iconSource`). These are left as their URL and each card
	 * fetches its own (see `useResolved` in `PluginIcon`): they never need the batch below, and waiting
	 * for the batch meant a market of seventy entries showed seventy placeholders for twenty seconds,
	 * until the slowest picture had arrived. Card by card, the first screenful is drawn in a second or
	 * two, top to bottom, the order the cards mount in.
	 */
	const chosen = (item: CatalogItem) => item.entry?.iconSource === "uploaded" || item.entry?.iconSource === "bundled";

	/*
	 * Everything else goes through one batch, because whether such a picture belongs to its entry is a
	 * question about the whole list: a registry that fills `logo` with the repository owner's GitHub
	 * avatar gives seven servers from one monorepo seven copies of the same face, and `dropShared` in
	 * the main process throws those out where it can see all of them at once — asked one card at a
	 * time the judgement is not even well-defined. What comes back is already drawable: a data URL, or
	 * nothing.
	 *
	 * Keyed on the joined string, like the registry URLs above: the list is a fresh array on every
	 * render and its contents almost never change, so depending on the array would re-fetch every logo
	 * whenever an unrelated piece of state moved.
	 */
	const logosKey = useMemo(
		() => [...new Set(merged.filter((item) => !chosen(item)).map((item) => item.logo).filter((logo) => logo?.startsWith("https://")))].join("|"),
		[merged],
	);
	const [logos, setLogos] = useState<Record<string, string | null>>({});

	useEffect(() => {
		if (!logosKey) return;
		let cancelled = false;
		void bridge.plugins
			// Optional, because the main process does not hot-reload: during a dev session where the
			// renderer has this code and the main process does not, the logos simply stay unresolved
			// and every card draws its own mark — which is what an unfetchable logo does anyway.
			.icons?.(logosKey.split("|"))
			.then((resolved) => !cancelled && setLogos((previous) => ({ ...previous, ...resolved })))
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [logosKey]);

	/*
	 * The same list, with each batched logo replaced by what it resolved to. A chosen one keeps its URL:
	 * by the time an item reaches a card, `logo` is either a picture or the address of one that the
	 * card resolves itself.
	 */
	const items = useMemo(
		() =>
			merged.map((item) =>
				item.logo?.startsWith("https://") && !chosen(item) ? { ...item, logo: logos[item.logo] ?? undefined } : item,
			),
		[merged, logos],
	);

	const refresh = useCallback(() => {
		setForced((n) => n + 1);
		setNonce((n) => n + 1);
		bumpExtensions();
	}, [bumpExtensions]);

	return {
		items,
		plugins: localLoading ? [] : local.plugins,
		skills: localLoading ? [] : local.skills,
		errors,
		diagnostics: local.diagnostics,
		loading: loading || localLoading,
		localLoading,
		sources: urls,
		fetchedAt,
		refresh,
	};
}

/*
 * Re-exported: every caller wants the hook and the model together, and having them reach into two
 * files to get one page's worth of types is a split showing through where it should not.
 */
export { byPopularity, matches, shelves, UNFILED, type CatalogItem } from "./catalog.ts";
