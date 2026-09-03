/**
 * Reading the catalogue: the three sources, fetched and kept fresh.
 *
 * The shape of what comes out, and the rules for merging it, are in `catalog.ts` — separated
 * because those are decisions about data and these are decisions about when to ask for it. The
 * split is also what makes the merge testable without a renderer.
 */

import type { McpBundle, Plugin, RegistryEntry, Skill } from "@lyra/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useApp } from "../../store.ts";
import { merge, type CatalogItem } from "./catalog.ts";
import { bridge } from "../../services/index.ts";

export interface Catalog {
	items: CatalogItem[];
	skills: Skill[];
	/** Registries that answered with something other than a list. */
	errors: { url: string; message: string }[];
	diagnostics: { path: string; message: string }[];
	loading: boolean;
	/** Configured registry URLs, so an empty page can tell the difference from an empty registry. */
	sources: string[];
	refresh: () => void;
}

/**
 * The last answer per set of sources, for the lifetime of this window.
 *
 * Module-level rather than in a store because nothing else needs it and nothing else may write it:
 * it is not state anyone acts on, it is the reply we already got.
 */
const seen = new Map<string, { remote: { from: string; entry: RegistryEntry }[]; errors: { url: string; message: string }[] }>();

/** The sources, as one string — the identity a cached answer belongs to. */
function urlsKeyOf(settings: { pluginRegistries?: string[]; skillRegistries?: string[] } | null | undefined): string {
	return [...(settings?.pluginRegistries ?? []), ...(settings?.skillRegistries ?? [])].join("|");
}

export function useCatalog(): Catalog {
	const workspace = useApp((s) => s.workspace);
	const settings = useApp((s) => s.settings);
	/*
	 * The shared "something was installed" signal.
	 *
	 * This view is not the only one showing these directories — 设置 › 插件 and the tab counts
	 * read them too — and any of them can be the one that changed them. Listening to the same
	 * counter is what stops the other pages from showing a moment ago.
	 */
	const extensionsNonce = useApp((s) => s.extensionsNonce);
	const bumpExtensions = useApp((s) => s.bumpExtensions);

	const [local, setLocal] = useState<{
		plugins: Plugin[];
		mcpBundles: McpBundle[];
		skills: Skill[];
		diagnostics: { path: string; message: string }[];
	}>({ plugins: [], mcpBundles: [], skills: [], diagnostics: [] });
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

	const cwd = workspace?.path ?? "";
	/** Re-scan when a plugin is switched on or off, which rewrites this list and nothing else. */
	const disabledKey = (settings?.disabledPlugins ?? []).join("|");

	// Both halves land independently; a slow registry must not hold back what is already on disk.
	useEffect(() => {
		let cancelled = false;
		void bridge.plugins.list(cwd).then((scan) => {
			if (cancelled) return;
			setLocal({
				plugins: scan.plugins ?? [],
				/*
				 * Defaulted, because the two processes can disagree about the shape.
				 *
				 * The main process does not hot-reload — change anything it imports and it keeps
				 * serving the previous build until the app is restarted, while the renderer already
				 * has the new code. During that window this field does not exist, and reading it as
				 * an array threw before anything was rendered: the whole view went grey, with no
				 * indication that the answer was "restart the dev server".
				 */
				mcpBundles: scan.mcpBundles ?? [],
				skills: scan.skills ?? [],
				diagnostics: scan.pluginDiagnostics ?? [],
			});
		});
		return () => {
			cancelled = true;
		};
	}, [cwd, disabledKey, nonce, extensionsNonce]);

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
		if (!seen.has(urlsKey)) setLoading(true);
		void Promise.all(urls.map((url) => bridge.plugins.fetchRegistry(url, forced > 0))).then((results) => {
			if (cancelled) return;
			const entries = results.flatMap((result) =>
				result.ok ? result.registry.entries.map((entry) => ({ from: result.registry.name, entry })) : [],
			);
			setRemote(entries);
			const failures = results.flatMap((result, i) => (result.ok ? [] : [{ url: urls[i], message: result.message }]));
			setErrors(failures);
			setLoading(false);
			seen.set(urlsKey, { remote: entries, errors: failures });
		});
		return () => {
			cancelled = true;
		};
	}, [urls, urlsKey, nonce, forced]);

	/*
	 * Settings is where an MCP bundle's servers live, so the merge has to read it.
	 *
	 * Not the bundle's own `.mcp.json`: what the user has is whatever they edited on the MCP page
	 * — a Filesystem pointed at their own directory, a server they switched off. The declaration
	 * on disk is only the starting point it was installed from.
	 */
	const merged = useMemo(
		() => merge(local.plugins, local.mcpBundles, settings?.mcpServers ?? [], remote, local.skills),
		// `settings` rather than `settings.mcpServers`: the list is a fresh array on every render,
		// the object it hangs off is not — it is only replaced when something is actually saved.
		[local.plugins, local.mcpBundles, settings, remote, local.skills],
	);

	/*
	 * Every remote logo, fetched as one batch, because one of the answers depends on the others.
	 *
	 * A registry entry's `logo` is an https URL, which the page may not put in a `src` — the main
	 * process fetches it and hands back a data URL. That much was already true and used to happen per
	 * card, inside `PluginIcon`.
	 *
	 * It moved here because the interesting question is not "what is this URL" but "does this picture
	 * belong to this entry", and that is only answerable across the whole list: the default catalogue
	 * serves the repository owner's GitHub avatar for entries that shipped no icon, so seven MCP
	 * servers from one monorepo came back as seven copies of the same person's face. `dropShared`
	 * throws those out, in the main process, where it can see all of them at once — see
	 * `registry-icons.ts`. Asked one card at a time the judgement is not even well-defined.
	 *
	 * What lands here is therefore already drawable: a data URL, or nothing at all.
	 */
	/*
	 * Keyed on the joined string for the same reason the registry URLs above are: the list itself is
	 * a fresh array on every render and its contents almost never change, so depending on the array
	 * would re-fetch every logo whenever an unrelated piece of state moved.
	 */
	const logosKey = useMemo(
		() => [...new Set(merged.map((item) => item.logo).filter((logo) => logo?.startsWith("https://")))].join("|"),
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

	/**
	 * The same list, with each remote logo replaced by what it resolved to.
	 *
	 * Replaced rather than carried alongside: by the time an item reaches a card, `logo` means "the
	 * picture to draw", and a card has no business knowing that some logos are URLs that have to be
	 * laundered through the main process first. An entry whose logo was dropped or never arrived
	 * comes out with no logo, which is the state `PluginIcon` already draws a mark for.
	 */
	const items = useMemo(
		() =>
			merged.map((item) =>
				item.logo?.startsWith("https://") ? { ...item, logo: logos[item.logo] ?? undefined } : item,
			),
		[merged, logos],
	);

	/** Re-read here, and tell every other list that reads the same directories to do the same. */
	const refresh = useCallback(() => {
		setForced((n) => n + 1);
		setNonce((n) => n + 1);
		bumpExtensions();
	}, [bumpExtensions]);

	return {
		items,
		skills: local.skills,
		errors,
		diagnostics: local.diagnostics,
		loading,
		sources: urls,
		refresh,
	};
}

/*
 * Re-exported: every caller wants the hook and the model together, and having them reach into two
 * files to get one page's worth of types is a split showing through where it should not.
 */
export { groupByCategory, isEnabled, isInstalled, UNFILED, type CatalogItem } from "./catalog.ts";
