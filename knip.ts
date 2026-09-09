/**
 * What knip is allowed to conclude, and what it has to be taught first.
 *
 * This was `knip.json`. It is TypeScript now for one reason: a compiler is a function, and JSON
 * cannot hold one. Without it knip does not open a stylesheet, and this repository keeps five font
 * packages, Tailwind and KaTeX's stylesheet reachable *only* from CSS — so every run reported them
 * as unused dependencies.
 *
 * The tempting fix was to list those seven in `ignoreDependencies`. Two of them already were, from
 * the last time somebody hit this. That is the wrong shape of fix: the list grows by one every time
 * a font is added, nothing says why any entry is on it, and a report that has to be hand-filtered
 * before it can be read is a report nobody reads. Teaching the tool to follow `@import` and `url()`
 * costs nine lines and answers the whole class.
 */

/**
 * A stylesheet, as the specifiers it references.
 *
 * knip parses the output as if it were a module, so both spellings a stylesheet uses have to come
 * out as imports: `@import "…"` for the chain from `styles.css` down to `fonts.css`, and
 * `url("…")` for the `src:` of every `@font-face`. Absolute and inline references are dropped —
 * neither can be a package, and a `data:` URI here is a whole embedded font.
 */
const css = (text: string): string =>
	[
		...[...text.matchAll(/@import\s+["']([^"']+)["']/gu)].map((match) => match[1]),
		...[...text.matchAll(/url\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]),
	]
		.filter((specifier) => !/^(data:|https?:|\/)/u.test(specifier))
		.map((specifier) => `import ${JSON.stringify(specifier)};`)
		.join("\n");

export default {
	compilers: { css },
	workspaces: {
		/*
		 * The repository's own scripts are entry points, not dead code.
		 *
		 * `css-equivalence.mjs` and `codemod/move.mjs` are run by hand — each carries its usage in
		 * its header — so nothing imports them and knip called them unused files. Deleting a tool
		 * because no code calls it is exactly the mistake a list of unused files invites.
		 */
		".": {
			entry: ["scripts/**/*.mjs", "test/*.test.ts"],
			project: ["scripts/**/*.mjs", "test/**/*.ts"],
		},
		"packages/core": {
			entry: ["src/index.ts", "src/tokens.ts", "src/activity.ts", "src/trajectory-view.ts", "src/**/index.ts", "test/*.test.ts"],
			project: ["src/**/*.ts"],
		},
		"packages/desktop": {
			entry: ["electron/main.ts", "electron/preload.ts", "src/main.tsx", "test/*.test.ts", "scripts/*.mjs", "electron.vite.config.ts"],
			project: ["src/**/*.{ts,tsx}", "electron/**/*.ts", "src/**/*.css"],
		},
		"packages/mobile": {
			// `app.config.ts` was listed here and does not exist; knip reported the pattern as dead.
			entry: ["app/**/*.tsx"],
			project: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
		},
	},
	/*
	 * What is reached by something knip cannot read at all.
	 *
	 * `@electron/rebuild` is invoked by electron-builder, `expo-*` and `react-native-css-interop`
	 * by Expo's own config resolution, and `git-cliff` by `scripts/release.mjs` through `npx` — a
	 * string, not an import. The MCP SDK is loaded by name at runtime. None of these is a
	 * stylesheet problem, so the compiler above does not help them.
	 *
	 * `lefthook` and `tailwindcss` used to be here and are not any more: the first is a real
	 * dependency of the root `prepare` script, and the second arrives through `@import "tailwindcss"`
	 * in `styles.css`, which the compiler now follows. An entry that has stopped being necessary is
	 * worth removing — every one of them is a dependency nobody is checking.
	 */
	ignoreDependencies: [
		"@electron/rebuild",
		"expo-updates",
		"expo-system-ui",
		"react-native-css-interop",
		"@modelcontextprotocol/sdk",
		"git-cliff",
	],
	/** External programs, present on the machine rather than in the tree. `bwrap` is the Linux sandbox. */
	ignoreBinaries: ["rg", "bwrap"],
};
