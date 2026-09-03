/**
 * Whether a language is actually coloured, not merely recognised.
 *
 * "The grammar loaded" is a much weaker claim than it sounds, and the difference is what shipped:
 * `vue` resolved to `lang-html`, which knows `<script>` as JavaScript and `<style>` as CSS — and a
 * Vue file uses neither. `<style lang="scss">` and `<script setup lang="ts">` fell through to no
 * grammar at all, so the tags were coloured, the two hundred lines between them were not, and every
 * check that asked "is there a grammar for vue?" said yes.
 *
 * So these measure the output. Two numbers per language:
 *
 *   - **coverage** — what share of the characters got a class. Not a target to maximise: a language
 *     that is mostly identifiers legitimately colours less than one that is mostly keywords. It is
 *     a floor, set below what each currently achieves, to catch a grammar that stops working.
 *   - **variety** — how many distinct classes came back. This is the one that catches a grammar
 *     falling back to something cruder: CSS parsed as plain text still colours *something*, and it
 *     is the collapse from seven kinds to two that says so.
 *
 * Comments are checked by name because they are the thing people notice first, and because a
 * grammar that gets everything else right and drops comments looks broken in a specific, reported
 * way.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHighlightStyle } from "@codemirror/language";
import { loadFenceLanguage, tokenize, type Token } from "../src/lib/code/highlight.ts";

interface Case {
	/** The fence name, as someone would write it. */
	lang: string;
	code: string;
	/** Floor for the share of characters carrying a class, in percent. */
	coverage: number;
	/** Floor for the number of distinct classes. */
	variety: number;
	/** The word that must come back coloured, when the sample has a comment. */
	comment?: string;
}

const CASES: Case[] = [
	{
		lang: "vue",
		// Measured at 47% for this sample: an SFC is mostly identifiers and structure, and the
		// template's own text is not meant to be coloured. The floor is what matters — a collapse
		// back to "tags only" scores in the twenties.
		coverage: 40,
		variety: 6,
		comment: "标注",
		code: `<template>
  <div :class="cls" @click="go">{{ msg }}</div>
</template>

<script setup lang="ts">
const msg: string = "hi";
</script>

<style lang="scss">
// 标注
$c: #4caaeb;
.a { color: $c; }
</style>`,
	},
	{
		lang: "scss",
		coverage: 30,
		variety: 3,
		comment: "标注",
		code: `// 标注\n$c: #4caaeb;\n.a { color: $c; &:hover { opacity: .5; } }`,
	},
	{ lang: "css", coverage: 35, variety: 3, comment: "标注", code: `/* 标注 */\n.a { color: red; }` },
	{
		lang: "go",
		coverage: 40,
		variety: 4,
		comment: "标注",
		code: `package main\n\n// 标注\nfunc main() {\n\tfmt.Println("hi")\n}`,
	},
	{
		lang: "python",
		coverage: 30,
		variety: 4,
		comment: "标注",
		code: `# 标注\ndef f(x: int) -> str:\n    return f"{x}"`,
	},
	{
		lang: "java",
		coverage: 45,
		variety: 4,
		comment: "标注",
		code: `// 标注\npublic class A {\n  public static void main(String[] args) {}\n}`,
	},
	{
		lang: "tsx",
		coverage: 35,
		variety: 5,
		comment: "标注",
		code: `// 标注\nexport const A = () => <div className="x">hi</div>;`,
	},
	{ lang: "ts", coverage: 50, variety: 4, comment: "标注", code: `// 标注\nexport const a: number = 1;` },
	{ lang: "js", coverage: 50, variety: 4, comment: "标注", code: `// 标注\nexport const a = 1;` },
	{ lang: "json", coverage: 25, variety: 3, code: `{"a": 1, "b": [true, null]}` },
	{ lang: "yaml", coverage: 30, variety: 2, comment: "标注", code: `# 标注\nkey: value\nlist:\n  - a` },
	{ lang: "bash", coverage: 25, variety: 2, comment: "标注", code: `# 标注\necho "hi" | grep -o x` },
	{ lang: "nginx", coverage: 40, variety: 2, comment: "标注", code: `# 标注\nserver { listen 80; }` },
	{ lang: "dockerfile", coverage: 25, variety: 2, comment: "标注", code: `# 标注\nFROM node:20\nRUN npm ci` },
	{ lang: "rust", coverage: 35, variety: 4, comment: "标注", code: `// 标注\nfn main() { println!("hi"); }` },
	{ lang: "sql", coverage: 30, variety: 3, comment: "标注", code: `-- 标注\nSELECT a FROM t WHERE b = 1;` },
];

function measure(tokens: Token[], code: string) {
	const coloured = tokens.filter((t) => t.className);
	return {
		coverage: Math.round((coloured.reduce((n, t) => n + t.text.length, 0) / code.length) * 100),
		variety: new Set(coloured.map((t) => t.className)).size,
		commented: (word: string) => coloured.some((t) => t.text.includes(word)),
	};
}

for (const probe of CASES) {
	test(`${probe.lang} is actually coloured`, async () => {
		const language = await loadFenceLanguage(probe.lang);
		assert.ok(language, `${probe.lang} 没有语法`);

		const tokens = tokenize(probe.code, language!, defaultHighlightStyle);
		const m = measure(tokens, probe.code);

		assert.ok(
			m.coverage >= probe.coverage,
			`${probe.lang} 着色率掉到 ${m.coverage}%（下限 ${probe.coverage}%）——语法可能退化成纯文本了`,
		);
		assert.ok(
			m.variety >= probe.variety,
			`${probe.lang} 只出了 ${m.variety} 种样式（下限 ${probe.variety}）——多半是回退到更粗的语法了`,
		);
		if (probe.comment) {
			assert.ok(m.commented(probe.comment), `${probe.lang} 的注释没有着色，这是最先被看出来的一处`);
		}
	});
}

/*
 * The specific regression that prompted all of this: a Vue file's blocks.
 *
 * Coverage over the whole file can stay respectable while an entire block is plain — the template
 * alone is enough tags to carry it. So the style block is measured on its own.
 */
test("a Vue file's <style lang=\"scss\"> block is coloured, not just its tags", async () => {
	const language = await loadFenceLanguage("vue");
	assert.ok(language);
	const file = `<template><div/></template>\n<style lang="scss">\n$c: #4caaeb;\n.a { color: $c; }\n</style>`;
	const tokens = tokenize(file, language!, defaultHighlightStyle);

	/** Only what falls inside the style block. */
	const start = file.indexOf("$c:");
	let at = 0;
	let colouredInside = 0;
	for (const token of tokens) {
		if (at >= start && token.className) colouredInside += token.text.length;
		at += token.text.length;
	}
	assert.ok(
		colouredInside > 6,
		`样式块里只有 ${colouredInside} 个字符上了色——外层标签有色、里面两百行没色，正是报上来的那个样子`,
	);
});

/*
 * The other block that had no grammar at all: `<script setup lang="ts">`.
 *
 * HTML nests `<script>` as JavaScript, and a Vue file's script is TypeScript far more often than
 * not — the type annotation is exactly what plain JavaScript chokes on, so it is what this looks
 * for.
 */
test('a Vue file\'s <script setup lang="ts"> block is coloured', async () => {
	const language = await loadFenceLanguage("vue");
	assert.ok(language);
	const file = `<template><div/></template>\n<script setup lang="ts">\nconst n: number = 1;\nexport default {};\n</script>`;
	const tokens = tokenize(file, language!, defaultHighlightStyle);

	const start = file.indexOf("const n");
	let at = 0;
	let colouredInside = 0;
	for (const token of tokens) {
		if (at >= start && token.className) colouredInside += token.text.length;
		at += token.text.length;
	}
	assert.ok(colouredInside > 6, `脚本块里只有 ${colouredInside} 个字符上了色——TypeScript 没被认出来`);
});
