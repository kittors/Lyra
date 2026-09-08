import type { UiLocale } from "@lyra/core";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { resolveUiLocale } from "./locales.ts";
import { MESSAGE_CATALOGS, type MessageKey, type ResolvedUiLocale } from "./messages/index.ts";
import { setActiveLocale } from "./translate.ts";

type MessageVariables = Readonly<Record<string, string | number>>;

interface I18nValue {
	locale: UiLocale;
	resolvedLocale: ResolvedUiLocale;
	t: (key: MessageKey, variables?: MessageVariables) => string;
	formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
	formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
}

function browserLanguages(): readonly string[] {
	if (typeof navigator === "undefined") return [];
	return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

function makeValue(locale: UiLocale, languages: readonly string[]): I18nValue {
	const resolvedLocale = resolveUiLocale(locale, languages);
	const catalog = MESSAGE_CATALOGS[resolvedLocale];
	const t = (key: MessageKey, variables?: MessageVariables): string => {
		const template = catalog[key] ?? MESSAGE_CATALOGS["zh-CN"][key];
		if (!variables) return template;
		return template.replace(/\{([^}]+)\}/g, (match, name: string) => {
			const value = variables[name];
			return value === undefined ? match : String(value);
		});
	};
	return {
		locale,
		resolvedLocale,
		t,
		formatNumber: (value, options) => new Intl.NumberFormat(resolvedLocale, options).format(value),
		formatDate: (value, options) => new Intl.DateTimeFormat(resolvedLocale, options).format(value),
	};
}

/*
 * 没有 Provider 时，回到目录的源语言。
 *
 * 从前默认是 `makeValue("system", [])`——而 `system` 配上一份空的语言列表会落到英文（见
 * `resolveUiLocale` 的兜底）。窗口里这从不发生，`App` 永远带着 Provider；发生的地方是测试，
 * 于是每一个直接挂载组件的用例都在断言一种没人选过的语言。`zh-CN` 是 `MessageKey` 的出处，
 * 也是 `translate` 的默认，回到它至少让两条路答得一样。
 */
const I18nContext = createContext<I18nValue>(makeValue("zh-CN", []));

export function I18nProvider({ locale, children }: { locale: UiLocale; children: React.ReactNode }) {
	const [languages, setLanguages] = useState(browserLanguages);

	useEffect(() => {
		if (locale !== "system") return;
		const update = () => setLanguages(browserLanguages());
		window.addEventListener("languagechange", update);
		return () => window.removeEventListener("languagechange", update);
	}, [locale]);

	const value = useMemo(() => makeValue(locale, languages), [locale, languages]);
	/*
	 * The same answer, told to the code that cannot hold a hook.
	 *
	 * A store raising a notice and `hiccup.ts` describing a dropped connection are read by the same
	 * person as everything above them, so they have to change language at the same moment. Written
	 * during render rather than in the effect below: the store can speak before effects have run —
	 * a session restoring on launch does — and a notice a frame early in the previous language is
	 * the bug this exists to close. See `i18n/translate.ts`.
	 */
	setActiveLocale(value.resolvedLocale);
	useEffect(() => {
		document.documentElement.lang = value.resolvedLocale;
	}, [value.resolvedLocale]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	return useContext(I18nContext);
}
