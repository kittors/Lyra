/**
 * That a fence which declares a language actually gets one.
 *
 * The failure this exists for was silent and total. `loadFenceLanguage` read `.language` off
 * whatever the grammar module returned — correct for `@codemirror/lang-*`, which exports a
 * `LanguageSupport`, and wrong for every `legacy-modes` grammar, which `StreamLanguage.define`
 * returns as a `Language` directly. So shell, yaml, dockerfile, nginx, ini, toml and the rest
 * loaded, parsed, and were then thrown away: the block rendered as plain text under a label
 * announcing its language, which is exactly what an unsupported language looks like.
 *
 * A list rather than a spot check, because the bug was per-shape and not per-language: one member
 * of each family would have passed while its siblings all failed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHighlightStyle } from "@codemirror/language";
import { loadFenceLanguage, tokenize } from "../src/lib/code/highlight.ts";

/** Everything a fence in this app's own docs and transcripts plausibly says. */
const FENCES = [
	// LanguageSupport, from `@codemirror/lang-*`
	"ts", "typescript", "tsx", "js", "jsx", "json", "python", "go", "rust", "java", "cpp", "css",
	"html", "sql", "xml", "php", "markdown", "vue",
	// StreamLanguage, from `legacy-modes` — the family that was entirely broken
	"bash", "sh", "zsh", "nginx", "toml", "ini", "dockerfile", "ruby", "perl", "haskell", "clojure",
	"powershell", "protobuf", "swift", "kotlin", "lua", "r", "scala", "diff", "cmake",
	// An array of extensions, which is a third shape again
	"yaml", "yml",
	// Aliases
	"makefile", "graphql", "md",
];

test("every fence language this app claims to know resolves to a grammar", async () => {
	const missing: string[] = [];
	for (const fence of FENCES) {
		const language = await loadFenceLanguage(fence).catch(() => null);
		if (!language) missing.push(fence);
	}
	assert.deepEqual(missing, [], `这些语言标了名字却没有语法，代码块会以纯文本渲染：${missing.join(", ")}`);
});

/*
 * Resolving is not colouring. A grammar that loads and then matches nothing produces a single
 * uncoloured run, which on screen is indistinguishable from having no grammar at all.
 */
test("a legacy grammar actually colours something", async () => {
	const language = await loadFenceLanguage("nginx");
	assert.ok(language, "nginx 应该有语法");
	/*
	 * CodeMirror's own style, not the app's.
	 *
	 * `sharedHighlightStyle` reads CSS variables off `document`, which does not exist here. What is
	 * being checked is that the grammar produces tagged ranges at all — which style names them is
	 * the theme's business, and the theme is tested by looking at it.
	 */
	const tokens = tokenize(
		"server {\n    listen 80;\n    server_name localhost;\n}",
		language!,
		defaultHighlightStyle,
	);
	const coloured = tokens.filter((t) => t.className).length;
	assert.ok(coloured > 0, "解析出来了却一个 token 都没上色，看起来和没有语法一模一样");
});

test("shell, the most common fence of all, colours too", async () => {
	const language = await loadFenceLanguage("bash");
	assert.ok(language);
	const tokens = tokenize('echo "hello" | grep -o world', language!, defaultHighlightStyle);
	assert.ok(tokens.filter((t) => t.className).length > 0);
});

test("an unknown language is null rather than a broken grammar", async () => {
	assert.equal(await loadFenceLanguage("definitely-not-a-language"), null);
	assert.equal(await loadFenceLanguage(""), null);
});

/**
 * Files whose name is their type.
 *
 * Half the files in a project have no useful extension — `Dockerfile`, `.env.local`, `.zshrc`,
 * `Gemfile` — and every one of them opened as plain text. The prefix families are the ones that
 * bit hardest: `.env` was handled and `.env.local` was not, which is the file people actually open.
 */
test("a project's unextensioned files still get a grammar", async () => {
	const { grammarKeyFor } = await import("../src/lib/code/highlight.ts");
	const expected: [string, string][] = [
		["Dockerfile", "dockerfile"],
		["Dockerfile.dev", "dockerfile"],
		["docker-compose.yml", "yaml"],
		["docker-compose.prod.yml", "yaml"],
		[".env", "env"],
		[".env.local", "env"],
		[".env.production", "env"],
		[".gitignore", "gitignore"],
		[".zshrc", "sh"],
		[".bashrc", "sh"],
		["Gemfile", "ruby"],
		["Rakefile", "ruby"],
		["Makefile", "sh"],
		["CMakeLists.txt", "cmake"],
		["nginx.conf", "nginx"],
		["go.mod", "properties"],
		["tsconfig.json", "json"],
		[".prettierrc", "json"],
		["App.vue", "vue"],
		["style.scss", "scss"],
	];
	for (const [file, grammar] of expected) {
		assert.equal(grammarKeyFor(file), grammar, `${file} 应该按 ${grammar} 渲染`);
	}
});

test("every grammar a filename maps to actually exists", async () => {
	const { BY_FILENAME, loadFenceLanguage } = await import("../src/lib/code/highlight.ts");
	const missing: string[] = [];
	for (const [name, grammar] of Object.entries(BY_FILENAME)) {
		if (!(await loadFenceLanguage(grammar).catch(() => null))) missing.push(`${name}→${grammar}`);
	}
	assert.deepEqual(missing, [], `这些文件名指向了不存在的语法：${missing.join(", ")}`);
});
