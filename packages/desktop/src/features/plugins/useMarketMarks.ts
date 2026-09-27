import { useMemo } from "react";

import { useCatalog } from "./useCatalog.ts";

export type MarketMark = {
	logo?: string;
	brandColor?: string;
	/** The name and one line the market lists it under, when it came from one — curated, and in the market's language. */
	name?: string;
	description?: string;
};

/**
 * The picture the market shows for a thing, for pages that list what is installed.
 *
 * An installed bundle's own manifest rarely names a logo — the market's icon comes from the
 * platform, not from inside the archive — so 设置 › 插件 drew every row as the grey mark for its
 * kind while the market, one click away, showed the real logo for the same thing. Looked up here by
 * the bundle's id first, then by name, so a server added by hand as "Context7" still gets Context7's
 * mark; the name has to match exactly (case aside), never "looks like".
 */
export function useMarketMarks(): (id?: string, name?: string) => MarketMark | undefined {
	const catalog = useCatalog();
	return useMemo(() => {
		const byId = new Map<string, MarketMark>();
		const byName = new Map<string, MarketMark>();
		for (const item of catalog.items) {
			if (!item.logo && !item.brandColor && !item.entry) continue;
			const mark: MarketMark = {
				logo: item.logo,
				brandColor: item.brandColor,
				...(item.entry ? { name: item.name, description: item.tagline || item.description || undefined } : {}),
			};
			byId.set(item.id.toLowerCase(), mark);
			byName.set(item.name.toLowerCase(), mark);
		}
		return (id, name) => {
			const wanted = [id, name].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
			for (const key of wanted) {
				const mark = byId.get(key) ?? byName.get(key);
				if (mark) return mark;
			}
			return undefined;
		};
	}, [catalog.items]);
}
