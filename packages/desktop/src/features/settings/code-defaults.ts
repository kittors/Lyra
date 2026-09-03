/**
 * What 恢复默认 puts back for the code appearance section.
 *
 * Restated here rather than imported from `@lyra/core`, and that is a build constraint rather than
 * a preference: importing a *value* from that package into the renderer drags the whole of it —
 * native modules included — into this bundle, and the build fails outright. (Types are free; only
 * values cost.) The same rule bit the task strip's `isResumable`.
 *
 * Its own module so `test/appearance-defaults.test.ts` can import it and compare against the real
 * `DEFAULT_APPEARANCE`, which is what keeps a copy honest. Parsing it out of the component's source
 * was the first attempt and broke on the first font stack: those contain commas.
 */
export const CODE_DEFAULTS = {
	codeLightTheme: "lyra-light",
	codeDarkTheme: "lyra-dark",
	codeFont:
		'"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
	codeFontSize: 12,
	codeFontWeight: 400,
	codeLineHeight: 1.6,
	codeLetterSpacing: 0,
} as const;
