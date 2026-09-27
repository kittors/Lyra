/**
 * A list of things, punctuated the way the interface language punctuates one.
 *
 * Lists used to be joined with a hardcoded 「、」, so the English interface summed up a run of tool
 * calls as "Read files merge.ts、Created files merge.test.ts". The separator belongs to the language,
 * not to the sentence it sits in, which is why it is looked up here instead of written at each call.
 *
 * It comes from `Intl.ListFormat`, but not from `format()`: every conjunction style closes a list with
 * "and" in some language this app ships — 「和」 in Traditional Chinese even at `narrow`, 「및」 in
 * Korean, "and" in English at `long` — and a summary line is a tally, not a sentence. `type: "unit"`
 * has no conjunction, but CLDR joins Chinese units with nothing at all (the pattern behind
 * 「3小时20分钟」), which would run the parts together. What is left is the literal between two middle
 * items: the language's own list comma, which never carries a conjunction — 「、」 in Chinese and
 * Japanese, ", " in English, French, Russian and Korean.
 *
 * For items of one kind. Fields or clauses — a name and its description — take `common.comma`
 * instead, because Chinese separates those with 「，」 rather than 「、」.
 */

import type { ResolvedUiLocale } from "./messages/index.ts";
import { activeLocale } from "./translate.ts";

const separators = new Map<ResolvedUiLocale, string>();

/** `items`, joined for the language the window is set to — or for `locale`, when a caller has one. */
export function formatList(items: readonly string[], locale: ResolvedUiLocale = activeLocale()): string {
	return items.join(separatorFor(locale));
}

function separatorFor(locale: ResolvedUiLocale): string {
	let separator = separators.get(locale);
	if (separator === undefined) {
		separator = middleLiteral(new Intl.ListFormat(locale, { type: "conjunction", style: "narrow" }));
		separators.set(locale, separator);
	}
	return separator;
}

/**
 * What the format puts between the second and third of four items.
 *
 * Only the middle pattern decides that one. The first literal comes from the start pattern and the
 * last from the end pattern, and the end pattern is where the conjunction lives.
 */
function middleLiteral(format: Intl.ListFormat): string {
	let elements = 0;
	for (const part of format.formatToParts(["1", "2", "3", "4"])) {
		if (part.type === "element") elements += 1;
		else if (elements === 2) return part.value;
	}
	return ", ";
}
