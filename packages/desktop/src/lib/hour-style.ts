/**
 * Whether the hour gets a leading zero, which depends on the clock the language tells time by.
 *
 * On a 24-hour clock "09:05" is the ordinary way to write it, and the Chinese interface has always
 * shown it that way. On a 12-hour clock the zero reads as a typo — "02:28 PM" — so English, Korean
 * and Traditional Chinese go without.
 *
 * This replaces `hour: "2-digit"` in a format written back when it only ever spoke Chinese. A format
 * that asked for `"numeric"` already leaves the hour alone in every language, and switching it over
 * would pad a Chinese 9:05 that was never padded.
 *
 * Kept per language: every message row asks, and the answer only changes with the language.
 */

import type { ResolvedUiLocale } from "../i18n/index.ts";

const hourStyles = new Map<ResolvedUiLocale, "numeric" | "2-digit">();

export function hourStyle(locale: ResolvedUiLocale): "numeric" | "2-digit" {
	let style = hourStyles.get(locale);
	if (!style) {
		style = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12 ? "numeric" : "2-digit";
		hourStyles.set(locale, style);
	}
	return style;
}
