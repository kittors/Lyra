/**
 * The find/replace panel, in Chinese and with icons.
 *
 * CodeMirror ships an English panel of text buttons. Replacing the strings is a lookup table;
 * replacing the buttons means drawing them, because the panel gives no other way in.
 */

/**
 * Making CodeMirror look like the rest of the app.
 *
 * Two jobs: restyling every surface it draws — gutters, the search panel, the completion popup —
 * onto the app's own tokens, and replacing its English chrome with Chinese. Both are long and
 * mechanical, and neither is worth reading while trying to understand the editor itself.
 */


/**
 * The find/replace panel's wording.
 *
 * Keys are CodeMirror's own English strings; anything not listed keeps the original.
 */
/** Hover text for the icon-only buttons, keyed by CodeMirror's own `name` attribute. */
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

export const SEARCH_TIPS: Record<string, string> = {
	next: "下一个",
	prev: "上一个",
	select: "选中全部匹配",
	replace: "替换当前",
	replaceAll: "全部替换",
	close: "关闭 (Esc)",
};

export const SEARCH_PHRASES: Record<string, string> = {
	Find: "查找",
	Replace: "替换",
	next: "下一个",
	previous: "上一个",
	all: "全部",
	"match case": "区分大小写",
	"by word": "全词匹配",
	regexp: "正则",
	replace: "替换",
	"replace all": "全部替换",
	close: "关闭",
	"current match": "当前匹配",
	"replaced $ matches": "已替换 $ 处",
	"replaced match on line $": "已替换第 $ 行的匹配",
	"on line": "行",
};
