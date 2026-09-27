/**
 * A registry's logos, with the ones that identify nothing thrown away.
 *
 * A logo is supposed to be the entry's mark. What the default catalogue actually serves for most of
 * its entries is the GitHub avatar of whoever owns the repository they were built from — and since
 * the official MCP servers all live in one monorepo, seven different products came back wearing the
 * same person's face. A page of nine cards showed one photograph nine times, which is worse than no
 * picture at all: a mark that cannot tell two things apart is not a mark, it is noise in the one
 * place the eye goes first.
 *
 * The rule is the definition read literally. If the same bytes arrive for two different entries,
 * that picture is not either entry's identity, so neither entry gets to wear it. Nothing here knows
 * about GitHub, avatars, or which registry it is talking to — an index that gives every entry its
 * own icon passes through untouched, and one that gives them all the same placeholder loses all of
 * them, which is the same judgement in both directions.
 *
 * Deliberately not "is this the owner's avatar?", which was the first version. That question can be
 * answered exactly — fetch `github.com/<owner>.png` and compare — and it is the wrong question: it
 * also throws away Anthropic's logo, which is a real mark that happens to be an org's avatar too.
 * Being shared is what makes a picture useless here, not where it came from.
 */

/** How many entries have to share a picture before it stops counting as anybody's. */
const SHARED_AT = 2;

/**
 * Drop every picture that more than one entry claims.
 *
 * Takes what was resolved, keyed by the URL it was asked for, and gives back the same keys — a
 * dropped logo comes back as `null`, which is the same answer as "could not fetch it" and wants the
 * same treatment from the page: draw the mark for something with no icon.
 *
 * Judged on the whole batch at once, which is why this is one call rather than one per card. Asked
 * card by card, the first entry would be drawn with the avatar and the rest without it, and which
 * one won would depend on which request came back first.
 *
 * Only logos the registry did not vouch for reach this: one whose `iconSource` says a maintainer
 * uploaded it or the bundle shipped it was chosen for that entry on purpose, and the renderer
 * resolves it on its own — Supabase's server and Supabase's skills both wearing Supabase's logo is
 * two entries of one brand, not one person's face pasted onto everything they published.
 */
export function dropShared(resolved: Map<string, string | null>): Map<string, string | null> {
	const owners = new Map<string, number>();
	for (const image of resolved.values()) {
		if (image === null) continue;
		owners.set(image, (owners.get(image) ?? 0) + 1);
	}

	const kept = new Map<string, string | null>();
	for (const [url, image] of resolved) {
		const shared = image !== null && (owners.get(image) ?? 0) >= SHARED_AT;
		kept.set(url, shared ? null : image);
	}
	return kept;
}
