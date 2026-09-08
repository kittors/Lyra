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

const I18nContext = createContext<I18nValue>(makeValue("system", []));

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
