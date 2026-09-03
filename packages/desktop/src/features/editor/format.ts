/**
 * Formatting a file, without needing a toolchain installed for it.
 *
 * Prettier's standalone build, which is the same engine the command line runs but with no file
 * system and no plugin resolution — you hand it the source, the parser and the parser's plugins,
 * and it hands back text. That constraint is the reason for the table below: the plugins have to
 * be named ahead of time rather than discovered, so every language we format is an entry here.
 *
 * Loaded on demand. The parsers are large — the TypeScript one alone is most of a megabyte — and
 * the overwhelming majority of sessions never format a Vue file, so paying for all of them at
 * startup would slow every launch for a feature used by some of them. Once loaded they stay
 * loaded, since the second Go file is very likely to follow the first.
 *
 * Languages with a canonical external formatter (gofmt, rustfmt, black) are deliberately *not*
 * here. Prettier has plugins for some of them, but a Go file formatted by anything other than
 * gofmt is wrong in a way Go programmers can see at a glance — those run in the main process
 * against the real binary. See `electron/format-external.ts`.
 */

/** Prettier's own options, restated as the subset we expose and persist. */
export interface FormatOptions {
	tabWidth: number;
	useTabs: boolean;
	printWidth: number;
	semi: boolean;
	singleQuote: boolean;
	trailingComma: "none" | "es5" | "all";
	bracketSpacing: boolean;
	arrowParens: "always" | "avoid";
}

export const FORMAT_DEFAULTS: FormatOptions = {
	tabWidth: 2,
	useTabs: true,
	printWidth: 120,
	semi: true,
	singleQuote: false,
	trailingComma: "all",
	bracketSpacing: true,
	arrowParens: "always",
};

/**
 * Which parser handles which extension, and what that parser needs loaded.
 *
 * `estree` is the printer for everything JavaScript-shaped — babel and typescript both parse to
 * it — which is why it appears alongside rather than instead of them. Leaving it out is the
 * classic standalone mistake: the parse succeeds and the print fails with "couldn't resolve
 * parser", naming the wrong half.
 */
const PARSERS: Record<string, { parser: string; plugins: string[] }> = {
	js: { parser: "babel", plugins: ["babel", "estree"] },
	jsx: { parser: "babel", plugins: ["babel", "estree"] },
	mjs: { parser: "babel", plugins: ["babel", "estree"] },
	cjs: { parser: "babel", plugins: ["babel", "estree"] },
	ts: { parser: "typescript", plugins: ["typescript", "estree"] },
	tsx: { parser: "typescript", plugins: ["typescript", "estree"] },
	mts: { parser: "typescript", plugins: ["typescript", "estree"] },
	cts: { parser: "typescript", plugins: ["typescript", "estree"] },
	// The HTML plugin covers Vue and Angular templates as well as plain markup; the embedded
	// `<script>` and `<style>` blocks are handed on to the parsers above, which is why an SFC
	// needs all of them present.
	vue: { parser: "vue", plugins: ["html", "typescript", "babel", "estree", "postcss"] },
	html: { parser: "html", plugins: ["html", "typescript", "babel", "estree", "postcss"] },
	css: { parser: "css", plugins: ["postcss"] },
	scss: { parser: "scss", plugins: ["postcss"] },
	less: { parser: "less", plugins: ["postcss"] },
	json: { parser: "json", plugins: ["babel", "estree"] },
	jsonc: { parser: "json", plugins: ["babel", "estree"] },
	json5: { parser: "json5", plugins: ["babel", "estree"] },
	yaml: { parser: "yaml", plugins: ["yaml"] },
	yml: { parser: "yaml", plugins: ["yaml"] },
	md: { parser: "markdown", plugins: ["markdown"] },
	markdown: { parser: "markdown", plugins: ["markdown"] },
	graphql: { parser: "graphql", plugins: ["graphql"] },
	gql: { parser: "graphql", plugins: ["graphql"] },
};

/** Files whose name decides the parser, the same way `highlight.ts` handles its own. */
const BY_FILENAME: Record<string, string> = {
	".prettierrc": "json",
	".babelrc": "json",
	".eslintrc": "json",
	"package.json": "json",
	"tsconfig.json": "jsonc",
	"jsconfig.json": "jsonc",
};

const loaded = new Map<string, Promise<unknown>>();

function loadPlugin(name: string): Promise<unknown> {
	let pending = loaded.get(name);
	if (!pending) {
		/*
		 * A switch rather than a template literal, because the bundler has to see the specifiers.
		 *
		 * `import(\`prettier/plugins/${name}\`)` is legal JavaScript and useless here: Vite cannot
		 * tell what it might resolve to, so it either bundles every file under that directory or
		 * emits a request that fails at runtime in the packaged app. Written out, each one is a
		 * chunk it can find and split.
		 */
		pending = (() => {
			switch (name) {
				case "babel":
					return import("prettier/plugins/babel");
				case "estree":
					return import("prettier/plugins/estree");
				case "typescript":
					return import("prettier/plugins/typescript");
				case "html":
					return import("prettier/plugins/html");
				case "postcss":
					return import("prettier/plugins/postcss");
				case "yaml":
					return import("prettier/plugins/yaml");
				case "markdown":
					return import("prettier/plugins/markdown");
				case "graphql":
					return import("prettier/plugins/graphql");
				default:
					return Promise.reject(new Error(`未知的格式化插件：${name}`));
			}
		})();
		loaded.set(name, pending);
	}
	return pending;
}

/** The file's own extension, lowercased, or its full name for the ones that have no extension. */
function keyFor(path: string): string {
	const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
	if (BY_FILENAME[name]) return BY_FILENAME[name];
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1) : name;
}

/** Whether this file can be formatted in the renderer at all. */
export function canFormat(path: string): boolean {
	return keyFor(path) in PARSERS;
}

/**
 * Format, or explain why not.
 *
 * Returns the formatted text, or `null` when the language has no formatter here — which the
 * caller reports differently from a failure, because they mean different things: one is "not
 * supported", the other is "your file does not parse".
 *
 * Syntax errors are re-thrown with Prettier's own message, which names the line. That is the
 * single most useful thing formatting does on a broken file, and swallowing it would turn a
 * precise complaint into a shortcut that silently does nothing.
 */
export async function formatCode(path: string, source: string, options: FormatOptions): Promise<string | null> {
	const entry = PARSERS[keyFor(path)];
	if (!entry) return null;

	const [{ format }, ...plugins] = await Promise.all([
		import("prettier/standalone"),
		...entry.plugins.map((name) => loadPlugin(name)),
	]);

	return await format(source, {
		parser: entry.parser,
		// oxlint-disable-next-line no-explicit-any -- the standalone plugin type is not exported.
		plugins: plugins as any[],
		...options,
		/*
		 * Line endings left exactly as they were found.
		 *
		 * Prettier's default is to normalise everything to `\n`, which on a repository checked out
		 * on Windows rewrites every line of every file it touches. Formatting one function should
		 * not produce a diff of the whole file.
		 */
		endOfLine: "auto",
	});
}
