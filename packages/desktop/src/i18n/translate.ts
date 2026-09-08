/**
 * Translating outside a component, for the code that has no hook to reach for.
 *
 * `useI18n` covers everything that renders. It does not cover the rest of what a person reads: the
 * notices the store raises when a send fails, the sentence `hiccup.ts` builds for a dropped
 * connection, the labels a plain function returns for a menu it does not own. Those had the language
 * written into them, so switching the interface to English left them in Chinese — which is most of
 * what "the settings are translated but the app is not" turned out to mean.
 *
 * Threading a `t` through every one of those call sites was the alternative, and it is worse than it
 * sounds: `describeHiccup` would take a translator to return a string, and so would everything that
 * calls it, all the way up to a component — for a value that depends on one global thing, the
 * language the window is set to. So the language lives here instead, and `I18nProvider` keeps it in
 * step; see `setActiveLocale`.
 *
 * The catalogue is the same one the hook reads, so a key cannot mean two different things depending
 * on which of the two found it, and `MessageKey` still makes a missing translation a type error.
 *
 * **Import this file directly from a `.ts` module — not `i18n/index.ts`.** The barrel re-exports
 * `context.tsx`, and a plain-TypeScript module that pulls it in stops being loadable by
 * `node --test --experimental-strip-types`, which does not know what to do with a `.tsx`. It shows
 * up as `ERR_UNKNOWN_FILE_EXTENSION` in a test that has nothing to do with i18n — `syncPlan.ts`'s
 * suite went red that way. Type-only imports from the barrel are fine: they leave no runtime trace.
 */

import { MESSAGE_CATALOGS, type MessageKey, type ResolvedUiLocale } from "./messages/index.ts";

export type MessageVariables = Readonly<Record<string, string | number>>;

/**
 * 简体中文，直到窗口说了别的。
 *
 * 这是 `zh-CN`，不是「随便哪个」：目录以它为准（`MessageKey` 是从它推出来的），少一条翻译时兜底
 * 回来的也是它。启动到 `I18nProvider` 挂上之间只有几毫秒，但那几毫秒里 store 已经能说话了。
 */
let active: ResolvedUiLocale = "zh-CN";

/** Called by `I18nProvider` whenever the resolved language changes. */
export function setActiveLocale(locale: ResolvedUiLocale): void {
	active = locale;
}

/** What the window is currently set to — for the rare caller that needs to ask. */
export function activeLocale(): ResolvedUiLocale {
	return active;
}

/**
 * One message, in the language the window is set to.
 *
 * Falls back to `zh-CN` for a key a catalogue is missing, which the types make unreachable today and
 * would be the right answer anyway: a sentence in the wrong language beats a key printed at a person.
 */
export function translate(key: MessageKey, variables?: MessageVariables): string {
	const template = MESSAGE_CATALOGS[active][key] ?? MESSAGE_CATALOGS["zh-CN"][key];
	if (!variables) return template;
	return template.replace(/\{([^}]+)\}/g, (match, name: string) => {
		const value = variables[name];
		return value === undefined ? match : String(value);
	});
}
