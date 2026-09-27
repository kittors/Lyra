import { useEffect, useState } from "react";

import { bridge } from "../../services/index.ts";
import type { CatalogItem } from "./catalog.ts";

interface ReadmeText {
	markdown: string;
	repo?: string;
	dir?: string;
}

/** `undefined` while it is being looked for, `null` when there is none, the text once it arrives. */
export type ReadmeResult = ReadmeText | null | undefined;

/** What each bundle's page already found this session, so opening it again draws at once. */
const KNOWN = new Map<string, ReadmeText | null>();

/**
 * A bundle's README, for its page — from the platform it was listed on, its installed directory, or
 * its repository; see `plugin-readme.ts` in the main process for which is asked first and why.
 */
export function useReadme(item: CatalogItem): ReadmeResult {
	const query = {
		id: item.entry?.id ?? item.id,
		repository: item.entry?.repository ?? item.installed?.manifest.homepage ?? item.bundle?.manifest.homepage,
		path: item.entry?.path,
		dir: item.installed?.dir ?? item.bundle?.dir,
	};
	const key = JSON.stringify(query);
	const [result, setResult] = useState<{ key: string; value: ReadmeResult }>(() => ({ key, value: KNOWN.get(key) }));

	useEffect(() => {
		const known = KNOWN.get(key);
		if (known !== undefined) return setResult({ key, value: known });
		setResult({ key, value: undefined });
		let alive = true;
		// Optional: a main process from before this existed simply has no README to give.
		const asked = bridge.plugins.readme?.(JSON.parse(key) as typeof query) ?? Promise.resolve(null);
		void asked
			.then((answer) => {
				const value = answer && answer.markdown.trim() ? answer : null;
				KNOWN.set(key, value);
				if (alive) setResult({ key, value });
			})
			.catch(() => alive && setResult({ key, value: null }));
		return () => {
			alive = false;
		};
		// `key` is the whole query, serialised; the object itself is new on every render.
		// oxlint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	return result.key === key ? result.value : KNOWN.get(key);
}
