/**
 * The monospace faces worth offering by name.
 *
 * The setting is a CSS font stack and always has been — it has to be, because the first choice may
 * not be installed and something has to catch that. What was wrong was making people *type* one:
 * getting `"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace`
 * right by hand, quotes and all, to change a font.
 *
 * So each entry is a whole stack with its own sensible fallbacks, chosen by the name at the front.
 * Anyone with a face not on this list still has the text field — see 自定义 in `AppearanceSettings`.
 *
 * `available` is answered by the browser rather than guessed at: a name in this list that is not
 * installed would silently render as something else, and the menu would be lying about what you
 * picked.
 */

import type { MessageKey } from "../../i18n/messages/index.ts";

export interface CodeFontOption {
	/** What the menu calls it. */
	label: string;
	/** The full stack, which is what gets stored. */
	stack: string;
	/** The first family, for the availability check and for the sample. */
	/**
	 * Only the entry that is not a typeface's own name carries a key.
	 *
	 * 「JetBrains Mono」 is called that in every language; the last row is a description, so it is
	 * the one that has to move. Looked up by the picker rather than here — this table is built at
	 * import time, before the language is settled.
	 */
	labelKey?: MessageKey;
	family: string;
	/**
	 * Shipped with the app, so it is always there.
	 *
	 * Checked rather than probed. `document.fonts.check` answers for faces the page has *used*; a
	 * bundled `@font-face` that nothing has rendered yet reports as missing, and the menu was
	 * labelling the app's own default 「未安装」.
	 */
	bundled?: boolean;
}

export const CODE_FONTS: CodeFontOption[] = [
	{
		label: "JetBrains Mono",
		family: "JetBrains Mono Variable",
		bundled: true,
		stack: '"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
	},
	{
		label: "SF Mono",
		family: "SF Mono",
		stack: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{ label: "Menlo", family: "Menlo", stack: 'Menlo, ui-monospace, "SF Mono", "PingFang SC", monospace' },
	{ label: "Monaco", family: "Monaco", stack: 'Monaco, Menlo, ui-monospace, "PingFang SC", monospace' },
	{
		label: "Fira Code",
		family: "Fira Code",
		bundled: true,
		stack: '"Fira Code", "Fira Mono", ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{
		label: "Cascadia Code",
		family: "Cascadia Code",
		stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{
		label: "Source Code Pro",
		family: "Source Code Pro",
		bundled: true,
		stack: '"Source Code Pro", ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{
		label: "IBM Plex Mono",
		family: "IBM Plex Mono",
		bundled: true,
		stack: '"IBM Plex Mono", ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{
		label: "Roboto Mono",
		family: "Roboto Mono",
		stack: '"Roboto Mono", ui-monospace, Menlo, "PingFang SC", monospace',
	},
	{ label: "Consolas", family: "Consolas", stack: 'Consolas, ui-monospace, Menlo, "PingFang SC", monospace' },
	{
		label: "System monospace",
		labelKey: "codeFonts.systemMono",
		family: "ui-monospace",
		stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace',
	},
];

/**
 * Whether this face is actually installed.
 *
 * Measured, not asked. `document.fonts.check` only knows the faces declared with `@font-face`; for
 * any other name it reports true, so on Windows SF Mono, Menlo and Monaco all came back "installed"
 * and the menu offered fonts that would render as Consolas. A face that is present changes the width
 * of a sample against at least one of three generics; a missing one falls through to the generic
 * every time and changes nothing. A generic keyword like `ui-monospace` always resolves to something.
 */
export function fontAvailable(option: CodeFontOption, measure: (font: string) => number = measureWidth): boolean {
	// Bundled faces are present by definition; see the note on `bundled`.
	if (option.bundled) return true;
	if (!option.family.includes(" ") && option.family.startsWith("ui-")) return true;
	const cached = measure === measureWidth ? installed.get(option.family) : undefined;
	if (cached !== undefined) return cached;
	let present: boolean;
	try {
		present = ["monospace", "serif", "sans-serif"].some((generic) => measure(`72px ${generic}`) !== measure(`72px "${option.family}", ${generic}`));
	} catch {
		// No canvas to measure with. Offering a face is better than hiding one that is there.
		present = true;
	}
	if (measure === measureWidth) installed.set(option.family, present);
	return present;
}

/** Installed faces do not come and go while the app runs; measured once each. */
const installed = new Map<string, boolean>();
const SAMPLE = "mmmmmmmmmmlli1WQ@#0O";
let canvas: HTMLCanvasElement | undefined;

function measureWidth(font: string): number {
	const context = (canvas ??= document.createElement("canvas")).getContext("2d");
	if (!context) throw new Error("no 2d context");
	context.font = font;
	return context.measureText(SAMPLE).width;
}

/** Which preset a stored stack corresponds to, or null when it was typed by hand. */
export function matchCodeFont(stack: string): CodeFontOption | null {
	const normalised = stack.trim();
	return CODE_FONTS.find((option) => option.stack === normalised) ?? null;
}
