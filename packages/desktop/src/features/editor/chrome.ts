/**
 * Making CodeMirror look — and read — like the rest of the app.
 *
 * Two jobs: restyling every surface it draws (gutters, the search panel, the completion popup)
 * onto the app's own tokens, and replacing its English chrome with whatever language the window is
 * set to. Both are long and mechanical, and neither is worth reading while trying to understand
 * the editor itself.
 *
 * The panel gives no way to hand it a React child, so the buttons are drawn as markup here and the
 * words come from the same catalogue as everything else.
 */

import { translate } from "../../i18n/translate.ts";

/**
 * The find bar's icons, as markup.
 *
 * Same set and same geometry as the lucide icons the rest of the app imports as components —
 * CodeMirror builds these buttons itself, so they cannot take a React child, and glyphs like
 * `↓` or `≡` borrowed from the text font sat next to real icons everywhere else and read as a
 * different program's toolbar.
 */
const icon = (paths: string, size = 13) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const SEARCH_ICONS: Record<string, string> = {
	next: icon('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
	prev: icon('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
	select: icon('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
	replace: icon(
		'<path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
		14.5,
	),
	replaceAll: icon(
		'<path d="M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
		14.5,
	),
	close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

/** Three options, in lucide's own find-bar icons. */
export const OPTION_ICONS = [
	icon(
		'<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M22 9v7"/><path d="M3.304 13h6.392"/><circle cx="18.5" cy="12.5" r="3.5"/>',
	),
	icon(
		'<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>',
	),
	icon(
		'<circle cx="7" cy="12" r="3"/><path d="M10 9v6"/><circle cx="17" cy="12" r="3"/><path d="M14 7v8"/><path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"/>',
	),
];

export const CHEVRON_RIGHT = icon('<path d="m9 18 6-6-6-6"/>');
export const CHEVRON_DOWN = icon('<path d="m6 9 6 6 6-6"/>');

/**
 * The find bar's own words, looked up when the bar is built rather than when this file loads.
 *
 * Functions rather than tables: a module-level object would freeze whatever language the window
 * happened to be in at import time, which for a file imported at startup is the fallback and not
 * the choice. `CodeEditor` calls these inside the effect that installs the search extension, so a
 * language change rebuilds them.
 *
 * `searchTips` is hover text for the icon-only buttons, keyed by CodeMirror's own `name` attribute.
 */
export function searchTips(): Record<string, string> {
	return {
		next: translate("common.next"),
		prev: translate("common.previous"),
		select: translate("find.selectAll"),
		replace: translate("find.replaceOne"),
		replaceAll: translate("find.replaceAll"),
		close: translate("find.closeEsc"),
	};
}

/** What CodeMirror's own search UI says, in the window's language. `$` is its placeholder. */
export function searchPhrases(): Record<string, string> {
	return {
		Find: translate("find.find"),
		Replace: translate("find.replace"),
		next: translate("common.next"),
		previous: translate("common.previous"),
		all: translate("common.all"),
		"match case": translate("find.matchCase"),
		"by word": translate("find.wholeWord"),
		regexp: translate("find.regex"),
		replace: translate("find.replace"),
		"replace all": translate("find.replaceAll"),
		close: translate("common.close"),
		"current match": translate("find.currentMatch"),
		"replaced $ matches": translate("find.replacedN"),
		"replaced match on line $": translate("find.replacedOnLine"),
		"on line": translate("common.line"),
	};
}
