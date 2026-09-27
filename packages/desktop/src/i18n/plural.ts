/**
 * Which form of a sentence a number takes, in the language the sentence is being said in.
 *
 * A catalogue entry used to be one string with the count pasted in, so the archive said
 * "1 conversations". English wants two forms, French counts 0 with 1, Russian wants three for whole
 * numbers (1 and 21 "разговор", 2–4 "разговора", 5–20 "разговоров"), and Chinese, Japanese and
 * Korean want none. `Intl.PluralRules` already knows which CLDR category a number falls in for each
 * of them, so a catalogue only has to give one sentence per category its language uses — see
 * `PluralForms` next to `MessageCatalog`, and `docs/architecture/i18n.md`.
 *
 * The count is always the variable `{n}`. That is what the 134 counting sentences already called
 * it, and it keeps "which number decides" out of the catalogue: a sentence with two counts in it
 * is two keys.
 */

import type { PluralForms, ResolvedUiLocale } from "./messages/index.ts";

const rules = new Map<ResolvedUiLocale, Intl.PluralRules>();

/** The plural category `count` falls in for `locale`; `other` for anything that is not a finite number. */
export function pluralCategory(locale: ResolvedUiLocale, count: number): Intl.LDMLPluralRule {
	if (!Number.isFinite(count)) return "other";
	let rule = rules.get(locale);
	if (!rule) {
		rule = new Intl.PluralRules(locale);
		rules.set(locale, rule);
	}
	return rule.select(count);
}

/**
 * The sentence `message` says for the count `n`. A plain string is the same sentence for every
 * number — which is every entry in the languages without plural categories.
 *
 * A category the entry leaves out takes `other`. That covers French `many` (1 000 000 and up), which
 * no count in this interface reaches and the check does not ask a translator to fill in.
 */
export function pluralForm(locale: ResolvedUiLocale, message: string | PluralForms, n: unknown): string {
	if (typeof message === "string") return message;
	return message[pluralCategory(locale, countOf(n))] ?? message.other;
}

/**
 * `n` as a number.
 *
 * A few callers format the count before passing it — `toLocaleString()`, a compact "1.2K" — so it
 * arrives as a string. Bare digits still count. Anything else takes `other`, which is right in English
 * and French for every formatted value (their `one` is 0 and 1, which never carry a separator); the
 * Russian sentences given such a count are worded as `сообщений: {n}`, which needs no form at all.
 */
function countOf(n: unknown): number {
	if (typeof n === "number") return n;
	if (typeof n === "string" && /^-?\d+(?:\.\d+)?$/.test(n)) return Number(n);
	return Number.NaN;
}
