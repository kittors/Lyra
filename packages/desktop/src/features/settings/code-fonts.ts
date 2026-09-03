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

export interface CodeFontOption {
	/** What the menu calls it. */
	label: string;
	/** The full stack, which is what gets stored. */
	stack: string;
	/** The first family, for the availability check and for the sample. */
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
		label: "系统等宽",
		family: "ui-monospace",
		stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace',
	},
];

/**
 * Whether this face is actually installed.
 *
 * `document.fonts.check` needs a size in the shorthand or it answers for nothing. It reports true
 * for a generic family like `ui-monospace` because something always resolves it, which is the right
 * answer: that entry cannot be missing.
 */
export function fontAvailable(option: CodeFontOption): boolean {
	// Bundled faces are present by definition; see the note on `bundled`.
	if (option.bundled) return true;
	// A generic keyword always resolves to something, and quoting it would break the check.
	if (!option.family.includes(" ") && option.family.startsWith("ui-")) return true;
	try {
		return document.fonts.check(`12px "${option.family}"`);
	} catch {
		// Older engines, or a name the parser dislikes. Offering it is better than hiding it.
		return true;
	}
}

/** Which preset a stored stack corresponds to, or null when it was typed by hand. */
export function matchCodeFont(stack: string): CodeFontOption | null {
	const normalised = stack.trim();
	return CODE_FONTS.find((option) => option.stack === normalised) ?? null;
}
