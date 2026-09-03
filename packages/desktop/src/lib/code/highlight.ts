/**
 * Syntax colouring, shared by the file editor and by code blocks in the transcript.
 *
 * One place for both, because a `for` keyword that is purple in an open file and grey in a
 * reply about that file is the same fact told two different ways. The editor mounts these as
 * CodeMirror extensions; the transcript renders the same tags to spans without an editor.
 */

import { HighlightStyle, type Language, StreamLanguage, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { highlightTree, tags as t } from "@lezer/highlight";
import { findCodeTheme } from "./themes.ts";

/**
 * Token colours.
 *
 * `light-dark()` so one stylesheet serves both themes without a rebuild — the browser picks
 * per the `color-scheme` the root sets.
 */
export function highlightStyle(lightThemeId?: string, darkThemeId?: string): HighlightStyle {
	const light = findCodeTheme(lightThemeId, "light");
	const dark = findCodeTheme(darkThemeId, "dark");
	const c = (tag: keyof typeof light.tokens) => `light-dark(${light.tokens[tag]}, ${dark.tokens[tag]})`;

	return HighlightStyle.define([
		{ tag: [t.keyword, t.modifier, t.controlKeyword], color: c("keyword") },
		{ tag: [t.definitionKeyword, t.moduleKeyword], color: c("keyword") },
		{ tag: [t.string, t.special(t.string)], color: c("string") },
		{ tag: [t.number, t.bool, t.null, t.atom], color: c("number") },
		{ tag: [t.comment, t.blockComment, t.lineComment], color: c("comment"), fontStyle: "italic" },
		{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: c("function") },
		/*
		 * A key is a key, however the grammar spells it.
		 *
		 * JSON marks its keys `propertyName`, but YAML — and JavaScript object literals — mark
		 * theirs `definition(propertyName)`. Grouped with `definition(variableName)` it inherited
		 * the plain text colour, which is why a YAML file came out as an undifferentiated wall:
		 * every key the same weight as its value, with only quoted strings picking up any colour.
		 */
		{ tag: [t.definition(t.propertyName)], color: c("function") },
		/*
		 * A name being *defined* carries the colour; a name being used does not.
		 *
		 * These were grouped with plain `variableName`, so `func Greet(...)` and `const answer = 42`
		 * put their most informative word — the one the line exists to introduce — in body text, while
		 * `fmt.Sprintf` on the next line was coloured for being a call. Backwards, and it is most of
		 * why a dark theme looked like white text with occasional accents: in ordinary code, most
		 * identifiers appear at their definition.
		 */
		{ tag: [t.definition(t.variableName)], color: c("function") },
		/*
		 * Unquoted scalars, which is most of a YAML file's right-hand side.
		 *
		 * The grammar cannot tell `true` from `1.2.3` from a bare word — all three are `Literal`
		 * — so this cannot be split into booleans and numbers the way a typed language can. Plain
		 * text is the honest rendering: the key carries the colour, the value carries the weight.
		 */
		{ tag: [t.content], color: c("variable") },
		// Anchors and aliases (&name, *name) — references, so they read like other labels.
		{ tag: [t.labelName], color: c("keyword") },
		{ tag: [t.typeName, t.className, t.namespace, t.constant(t.variableName), t.standard(t.variableName), t.special(t.variableName)], color: c("type") },
		{ tag: [t.propertyName], color: c("function") },
		{ tag: [t.variableName], color: c("variable") },
		{ tag: [t.operator, t.punctuation, t.separator, t.bracket], color: c("punctuation") },
		{ tag: [t.tagName], color: c("tag") },
		{ tag: [t.attributeName], color: c("attribute") },
		// `quote` is what the properties/ini modes give a value. Unmapped, a config file came
		// out with its keys coloured and its values plain.
		{ tag: [t.attributeValue, t.quote], color: c("string") },
		{ tag: [t.heading], color: c("function"), fontWeight: "600" },
		{ tag: [t.link, t.url], color: c("function"), textDecoration: "underline" },
		{ tag: [t.emphasis], fontStyle: "italic" },
		{ tag: [t.strong], fontWeight: "600" },
		{ tag: [t.strikethrough], textDecoration: "line-through" },
		{ tag: [t.meta, t.processingInstruction], color: c("comment") },
		{ tag: [t.invalid], color: c("tag") },
		{ tag: [t.escape, t.regexp], color: c("attribute") },
		// A patch opened in the editor: without these the whole file is one colour. See the note
		// in `preview-highlight.ts` for why they borrow existing token colours.
		{ tag: [t.inserted], color: c("string") },
		{ tag: [t.deleted], color: c("number") },
	]);
}

/** Everything the editor knows how to colour, keyed by extension. */
/*
 * Booleans and numbers in YAML, which the grammar cannot label for us.
 *
 * Lezer marks every unquoted scalar `Literal` — `true`, `1.2.3` and a bare word are the same
 * node, because in YAML they genuinely are until something decides how to read them. That left
 * the right-hand side of a config file entirely uncoloured while JSON, whose grammar does carry
 * types, came out fully lit. This looks at the text of each `Literal` and marks the ones that
 * are unambiguously a boolean, a null or a number, which is the same judgement a reader makes.
 *
 * Keys are `Literal` too, under a `Key` parent — skipped, since they already have a colour.
 */
/** Shared with the editor theme, which colours the decorator below. */
export const ATOM = "light-dark(#a3562a, #dd9160)";

const YAML_BOOL = /^(?:true|false|yes|no|on|off)$/i;
const YAML_NULL = /^(?:null|~)$/i;
const YAML_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function yamlScalarMarks(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "Literal" || node.node.parent?.name === "Key") return;
				const text = view.state.doc.sliceString(node.from, node.to);
				if (YAML_BOOL.test(text) || YAML_NULL.test(text) || YAML_NUMBER.test(text)) {
					builder.add(node.from, node.to, ATOM_MARK);
				}
			},
		});
	}
	return builder.finish();
}

const ATOM_MARK = Decoration.mark({ class: "ly-yaml-atom" });

const yamlScalars = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = yamlScalarMarks(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) this.decorations = yamlScalarMarks(update.view);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export const GRAMMARS: Record<string, () => Promise<Extension>> = {
	ts: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
	mts: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
	cts: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
	tsx: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
	js: async () => (await import("@codemirror/lang-javascript")).javascript(),
	mjs: async () => (await import("@codemirror/lang-javascript")).javascript(),
	cjs: async () => (await import("@codemirror/lang-javascript")).javascript(),
	jsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
	json: async () => (await import("@codemirror/lang-json")).json(),
	/*
	 * The legacy mode, not `lang-json` — because this one knows what a comment is.
	 *
	 * `.jsonc` differs from `.json` in exactly one way, and parsing it with the strict grammar
	 * rendered every `//` line as body text: the one construct the format exists for, invisible.
	 * The trade is that keys come out in the string colour rather than their own, which is the
	 * cheaper loss by a wide margin.
	 */
	jsonc: async () => {
		const { StreamLanguage } = await import("@codemirror/language");
		const { json } = await import("@codemirror/legacy-modes/mode/javascript");
		return StreamLanguage.define(json);
	},
	md: async () => (await import("@codemirror/lang-markdown")).markdown(),
	mdx: async () => (await import("@codemirror/lang-markdown")).markdown(),
	css: async () => (await import("@codemirror/lang-css")).css(),
	scss: async () => (await import("@codemirror/lang-css")).css(),
	less: async () => (await import("@codemirror/lang-css")).css(),
	html: async () => (await import("@codemirror/lang-html")).html(),
	htm: async () => (await import("@codemirror/lang-html")).html(),
	vue: async () => vueSupport(),
	// Svelte's blocks are the same shape — `<style lang="scss">`, `<script lang="ts">` — so the same
	// nesting applies. Its own template syntax is not covered, which is a smaller gap than the two
	// hundred lines of style and script that were not covered before.
	svelte: async () => vueSupport(),
	xml: async () => (await import("@codemirror/lang-xml")).xml(),
	svg: async () => (await import("@codemirror/lang-xml")).xml(),
	py: async () => (await import("@codemirror/lang-python")).python(),
	rs: async () => (await import("@codemirror/lang-rust")).rust(),
	go: async () => (await import("@codemirror/lang-go")).go(),
	java: async () => (await import("@codemirror/lang-java")).java(),
	kt: async () => (await import("@codemirror/lang-java")).java(),
	c: async () => (await import("@codemirror/lang-cpp")).cpp(),
	h: async () => (await import("@codemirror/lang-cpp")).cpp(),
	cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
	hpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
	cc: async () => (await import("@codemirror/lang-cpp")).cpp(),
	sql: async () => (await import("@codemirror/lang-sql")).sql(),
	yaml: async () => [(await import("@codemirror/lang-yaml")).yaml(), yamlScalars],
	yml: async () => [(await import("@codemirror/lang-yaml")).yaml(), yamlScalars],

	/*
	 * Everything below is a `StreamLanguage` from `@codemirror/legacy-modes`.
	 *
	 * These are line-oriented formats with no tree grammar, and they are most of what a project's
	 * configuration is actually written in: the shell scripts, the Dockerfile, the `.toml`, the
	 * `.env`. Before this they rendered as one flat colour — which for a file whose whole content
	 * is keys, values and comments means the comments do not read as comments.
	 *
	 * Loaded on demand like the rest, so opening a `.ts` file never pays for any of them.
	 */
	sh: async () => stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
	bash: async () => stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
	zsh: async () => stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
	fish: async () => stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
	toml: async () => stream((await import("@codemirror/legacy-modes/mode/toml")).toml),
	/*
	 * Dockerfile has its own grammar, and was reachable only by filename.
	 *
	 * `BY_FILENAME` maps the file `Dockerfile` to `sh`, which is a reasonable approximation when all
	 * you have is a name. A fence that says ```dockerfile is not an approximation — it is a
	 * declaration — and there was no entry for it here at all, so it fell through to plain text.
	 */
	dockerfile: async () => stream((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile),
	ini: async () => stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
	/*
	 * Languages that were simply missing, all of them already in `legacy-modes`.
	 *
	 * Nothing was broken about these — there was no entry, so a fence saying ```ruby rendered as
	 * plain text with a label claiming otherwise. Adding them costs no new dependency.
	 */
	ruby: async () => stream((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
	perl: async () => stream((await import("@codemirror/legacy-modes/mode/perl")).perl),
	haskell: async () => stream((await import("@codemirror/legacy-modes/mode/haskell")).haskell),
	clojure: async () => stream((await import("@codemirror/legacy-modes/mode/clojure")).clojure),
	powershell: async () => stream((await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
	protobuf: async () => stream((await import("@codemirror/legacy-modes/mode/protobuf")).protobuf),
	cfg: async () => stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
	conf: async () => stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
	properties: async () => stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
	/*
	 * Its own grammar, not the properties one.
	 *
	 * `.env` is `KEY=value`, and properties marks both halves as definitions — so the name and
	 * the secret rendered in one colour with an uncoloured `=` between them, on the one file
	 * whose entire purpose is telling those two apart. See `dotenv-mode.ts`.
	 */
	env: async () => (await import("./dotenv-mode.ts")).dotenvLanguage,
	diff: async () => stream((await import("@codemirror/legacy-modes/mode/diff")).diff),
	patch: async () => stream((await import("@codemirror/legacy-modes/mode/diff")).diff),
	lua: async () => stream((await import("@codemirror/legacy-modes/mode/lua")).lua),
	rb: async () => stream((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
	swift: async () => stream((await import("@codemirror/legacy-modes/mode/swift")).swift),
	ps1: async () => stream((await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
	psm1: async () => stream((await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
	pl: async () => stream((await import("@codemirror/legacy-modes/mode/perl")).perl),
	r: async () => stream((await import("@codemirror/legacy-modes/mode/r")).r),
	jl: async () => stream((await import("@codemirror/legacy-modes/mode/julia")).julia),
	hs: async () => stream((await import("@codemirror/legacy-modes/mode/haskell")).haskell),
	clj: async () => stream((await import("@codemirror/legacy-modes/mode/clojure")).clojure),
	/*
	 * Ruby's grammar, not Erlang's — despite the shared runtime.
	 *
	 * Elixir borrows its surface syntax from Ruby and almost none of it from Erlang: `#` comments,
	 * `def ... do ... end`, `@attributes`, and `#{}` interpolation are all Ruby's, while Erlang
	 * comments with `%` and ends its clauses with periods. Parsed as Erlang, every comment in an
	 * Elixir file rendered as code — which is what `test/language-coverage.test.ts` caught.
	 */
	ex: async () => stream((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
	erl: async () => stream((await import("@codemirror/legacy-modes/mode/erlang")).erlang),
	scala: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).scala),
	cs: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).csharp),
	m: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).objectiveC),
	dart: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).dart),
	groovy: async () => stream((await import("@codemirror/legacy-modes/mode/groovy")).groovy),
	proto: async () => stream((await import("@codemirror/legacy-modes/mode/protobuf")).protobuf),
	nginx: async () => stream((await import("@codemirror/legacy-modes/mode/nginx")).nginx),
	cmake: async () => stream((await import("@codemirror/legacy-modes/mode/cmake")).cmake),
	php: async () => (await import("@codemirror/lang-php")).php(),
	graphql: async () => (await import("./graphql-mode.ts")).graphqlLanguage,
	tex: async () => stream((await import("@codemirror/legacy-modes/mode/stex")).stex),
	gitignore: async () => (await import("./ignore-mode.ts")).ignoreLanguage,
};

/** A legacy stream mode, wrapped as the extension CodeMirror 6 wants. */
function stream(mode: Parameters<typeof StreamLanguage.define>[0]): Extension {
	return StreamLanguage.define(mode);
}

/**
 * A single-file component, with the languages its blocks actually contain.
 *
 * `vue` used to be `html()`, which is right about the shape of the file and wrong about everything
 * inside it. HTML knows two nested languages, `<script>` as JavaScript and `<style>` as CSS, and a
 * Vue file almost never uses either: `<style lang="scss">` and `<script setup lang="ts">` are the
 * norm, and both fell through to no grammar at all. The block was rendered as plain text under a
 * tag that had been coloured — which is why the outer tags looked right and the two hundred lines
 * between them did not.
 *
 * So the nesting is declared. `attrs` is what decides it: the same `<style>` tag is SCSS, LESS or
 * plain CSS depending on one attribute, and getting that wrong is worse than not colouring it —
 * SCSS parsed as CSS stops at the first `$variable`.
 *
 * Built once and shared. Each parser here pulls its own grammar module, and a file with four blocks
 * would otherwise load four copies.
 */
let vueCache: Promise<Extension> | null = null;
function vueSupport(): Promise<Extension> {
	vueCache ??= (async () => {
		const [{ html }, { vue }, { sass }, { less }, { css }, { javascript }] = await Promise.all([
			import("@codemirror/lang-html"),
			import("@codemirror/lang-vue"),
			import("@codemirror/lang-sass"),
			import("@codemirror/lang-less"),
			import("@codemirror/lang-css"),
			import("@codemirror/lang-javascript"),
		]);

		/** `<style>`, in whichever dialect the tag says. */
		const styleBlocks = [
			{ tag: "style", attrs: (a: Record<string, string>) => a.lang === "scss", parser: sass().language.parser },
			{ tag: "style", attrs: (a: Record<string, string>) => a.lang === "sass", parser: sass({ indented: true }).language.parser },
			{ tag: "style", attrs: (a: Record<string, string>) => a.lang === "less", parser: less().language.parser },
			// No `lang`, or one nobody handles: CSS is the default and the safest guess.
			{ tag: "style", attrs: (a: Record<string, string>) => !a.lang, parser: css().language.parser },
		];

		/** `<script>`, where `setup` and `lang="ts"` are the common case rather than the exception. */
		const scriptBlocks = [
			{
				tag: "script",
				attrs: (a: Record<string, string>) => a.lang === "ts" || a.lang === "typescript",
				parser: javascript({ typescript: true }).language.parser,
			},
			{
				tag: "script",
				attrs: (a: Record<string, string>) => a.lang === "tsx",
				parser: javascript({ typescript: true, jsx: true }).language.parser,
			},
		];

		const base = html({ nestedLanguages: [...styleBlocks, ...scriptBlocks], autoCloseTags: false });
		// Vue's own grammar for the template — directives, interpolation, shorthands — over that base.
		return vue({ base });
	})();
	return vueCache;
}

/**
 * Files whose name *is* their type.
 *
 * `Dockerfile` has no extension, `.gitignore` is all extension, and `CMakeLists.txt` claims `.txt`
 * while being nothing of the sort. Checked before the extension for exactly that last reason.
 *
 * The ignore files share one grammar because they share one syntax — see `ignore-mode.ts`.
 */
export const BY_FILENAME: Record<string, string> = {
	// A Dockerfile has a grammar of its own; it was pointed at shell because there was no entry for
	// `dockerfile` in `GRAMMARS` when this table was written. There is now.
	dockerfile: "dockerfile",
	containerfile: "dockerfile",
	makefile: "sh",
	gnumakefile: "sh",
	"cmakelists.txt": "cmake",
	".gitignore": "gitignore",
	".dockerignore": "gitignore",
	".npmignore": "gitignore",
	".eslintignore": "gitignore",
	".prettierignore": "gitignore",
	".vercelignore": "gitignore",
	".gitattributes": "gitignore",
	".env": "env",
	".editorconfig": "ini",
	".babelrc": "json",
	".prettierrc": "json",
	".eslintrc": "json",
	".npmrc": "ini",
	".nvmrc": "properties",
	"nginx.conf": "nginx",
	// Go's own manifests, which are neither TOML nor free text.
	"go.mod": "properties",
	"go.sum": "properties",
	// Ruby by convention rather than by extension.
	gemfile: "ruby",
	rakefile: "ruby",
	podfile: "ruby",
	guardfile: "ruby",
	// Shell startup files, which people open constantly and which had no extension to go on.
	".bashrc": "sh",
	".bash_profile": "sh",
	".zshrc": "sh",
	".zprofile": "sh",
	".profile": "sh",
	".zshenv": "sh",
	// The rest of the dotfile config crowd.
	".eslintrc.json": "json",
	".babelrc.json": "json",
	".stylelintrc": "json",
	".swcrc": "json",
	".yarnrc": "properties",
	"jsconfig.json": "json",
	"pnpm-workspace.yaml": "yaml",
	"docker-compose.yml": "yaml",
	"docker-compose.yaml": "yaml",
	procfile: "properties",
};

/**
 * Names whose *prefix* decides the grammar.
 *
 * `.env.local`, `.env.production`, `Dockerfile.dev` — the same file with a qualifier on the end,
 * and every one of them was falling through to plain text because the table above matches whole
 * names. These are the two families where that convention is near-universal; anything rarer is
 * better served by its extension.
 */
const BY_FILENAME_PREFIX: [prefix: string, grammar: string][] = [
	[".env.", "env"],
	["dockerfile.", "dockerfile"],
	["docker-compose.", "yaml"],
];

/**
 * Which grammar a file's name asks for, or null.
 *
 * One place, because three callers used to answer it differently: the editor looked at the
 * extension only, the fence renderer at the info string, and the diff at neither. A `Dockerfile`
 * was plain text in all three.
 */
export function grammarKeyFor(path: string): string | null {
	const name = path.toLowerCase().split(/[/\\]/).pop() ?? "";
	const byName = BY_FILENAME[name];
	if (byName) return GRAMMARS[byName] ? byName : null;

	// `.env.local` and friends — see `BY_FILENAME_PREFIX`.
	for (const [prefix, grammar] of BY_FILENAME_PREFIX) {
		if (name.startsWith(prefix) && GRAMMARS[grammar]) return grammar;
	}

	// A leading dot is the whole name (`.env`), which the table above has already had its say on.
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	const extension = name.slice(dot + 1);
	return GRAMMARS[extension] ? extension : null;
}

/**
 * What a fenced block's info string means, in the names people actually write.
 *
 * Markdown fences are labelled by language (` ```typescript `), files by extension (`.ts`), and
 * the grammar table above is keyed by the latter. Only the aliases that differ are listed —
 * anything already spelt like its extension falls through unchanged.
 */
const FENCE_ALIASES: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	python: "py",
	rust: "rs",
	golang: "go",
	kotlin: "kt",
	"c++": "cpp",
	"objective-c": "c",
	// A Makefile is close enough to shell for the purpose of colouring it, and there is no make
	// grammar to be had. The fence claims a language; this is the nearest true thing.
	makefile: "sh",
	make: "sh",
	mk: "sh",
	markdown: "md",
	yml: "yaml",
};

/**
 * Colour a fenced block, without building an editor to do it.
 *
 * CodeMirror is the right answer for a file you can edit and the wrong one for forty snippets
 * in a transcript: each instance carries a view, a DOM subtree and its own event handlers, for
 * text nobody is going to type into. Parsing with the same grammar and walking the tree gives
 * identical colours for a fraction of that.
 *
 * Returns null for a language nothing here can parse — a shell session, or no info string at
 * all — so the caller can render plain text rather than guessing.
 */
export async function loadFenceLanguage(info: string): Promise<Language | null> {
	const name = info.toLowerCase().trim().split(/[\s:,]/)[0];
	if (!name) return null;
	const load = GRAMMARS[FENCE_ALIASES[name] ?? name];
	if (!load) return null;
	try {
		return asLanguage(await load());
	} catch {
		return null;
	}
}

/**
 * The `Language` out of whatever a grammar module hands back, which is one of two shapes.
 *
 * `@codemirror/lang-*` exports a `LanguageSupport`: the language plus its extras — completion,
 * indentation, folding — with the language itself on `.language`. `StreamLanguage.define`, which is
 * how every `legacy-modes` grammar is wrapped, returns a `Language` directly.
 *
 * Reading `.language` and giving up when it was missing therefore rejected every legacy grammar
 * there is: shell, yaml, dockerfile, nginx, ini, toml, the lot. They loaded, they parsed, and then
 * this threw them away and the block was rendered as plain text. Nothing said so — the fence still
 * showed its language label, which is exactly what an unsupported language looks like.
 *
 * A third shape turns up too: an array, for the grammars that ship a view plugin alongside the
 * language — `yaml` pairs one with a decorator for its scalars. The language is whichever member
 * yields one.
 *
 * `parser` is the test rather than `instanceof`: it is what `tokenize` actually needs, and it does
 * not care which package the object came from.
 */
function asLanguage(loaded: unknown): Language | null {
	if (Array.isArray(loaded)) {
		for (const member of loaded) {
			const found = asLanguage(member);
			if (found) return found;
		}
		return null;
	}
	const support = loaded as { language?: Language };
	const candidate = support?.language ?? (loaded as Language | null);
	return candidate && typeof (candidate as Language).parser === "object" ? candidate : null;
}

export interface Token {
	text: string;
	/** CodeMirror's generated class for this tag, or "" for text no rule matched. */
	className: string;
}

/**
 * Split code into coloured runs.
 *
 * `highlightTree` only calls back for ranges that matched a rule, so the gaps between them —
 * whitespace, punctuation nothing claimed — have to be filled in or the text comes out with
 * pieces missing.
 */
export function tokenize(code: string, language: Language, style: HighlightStyle): Token[] {
	const tree = language.parser.parse(code);
	const tokens: Token[] = [];
	let at = 0;

	highlightTree(tree, style, (from, to, className) => {
		if (from > at) tokens.push({ text: code.slice(at, from), className: "" });
		tokens.push({ text: code.slice(from, to), className });
		at = to;
	});
	if (at < code.length) tokens.push({ text: code.slice(at), className: "" });

	return tokens;
}

/**
 * The same runs, split at line breaks.
 *
 * A diff is rendered one row per line, so it needs its colours cut the same way — and a token
 * can legitimately span lines (a block comment, a template literal), which is exactly the case
 * that colouring each line on its own gets wrong. Parsing the whole passage and dividing the
 * result afterwards keeps those spans intact.
 */
export function tokenizeLines(code: string, language: Language, style: HighlightStyle): Token[][] {
	const lines: Token[][] = [[]];
	for (const token of tokenize(code, language, style)) {
		const parts = token.text.split("\n");
		for (const [index, part] of parts.entries()) {
			if (index > 0) lines.push([]);
			if (part) lines[lines.length - 1].push({ text: part, className: token.className });
		}
	}
	return lines;
}

/**
 * Put the generated class definitions in the document, once.
 *
 * `HighlightStyle` hands CodeMirror a style module that the editor mounts on its own root.
 * Rendering the same classes outside an editor means the rules have to exist in the document
 * too, or every span comes out carrying a class name with nothing behind it.
 *
 * The rules are read out as text rather than mounted through `style-mod` directly: that package
 * is CodeMirror's own transitive dependency, and reaching past a dependency into what it happens
 * to pull in is how a working build breaks on an unrelated upgrade.
 */
let shared: HighlightStyle | null = null;
let currentLightId: string | undefined;
let currentDarkId: string | undefined;

/**
 * The one style for the whole app, mounted the first time anything asks.
 *
 * `HighlightStyle.define` generates a fresh set of class names on every call, and
 * `mountHighlightStyles` updates the rules in the document so changes to the light/dark code theme
 * propagate to every CodeBlock, DiffView, and FileViewer.
 */
export function sharedHighlightStyle(lightThemeId?: string, darkThemeId?: string): HighlightStyle {
	if (!shared || currentLightId !== lightThemeId || currentDarkId !== darkThemeId) {
		currentLightId = lightThemeId;
		currentDarkId = darkThemeId;
		shared = highlightStyle(lightThemeId, darkThemeId);
		mountHighlightStyles(shared);
	}
	return shared;
}

let highlightStyleEl: HTMLStyleElement | null = null;

export function mountHighlightStyles(style: HighlightStyle): void {
	const rules = style.module?.getRules();
	if (!rules) return;
	if (!highlightStyleEl) {
		highlightStyleEl = document.createElement("style");
		highlightStyleEl.dataset.dwHighlight = "";
		document.head.append(highlightStyleEl);
	}
	highlightStyleEl.textContent = rules;
}
