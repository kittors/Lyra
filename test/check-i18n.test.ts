/**
 * The check that guards seven languages, checked.
 *
 * `scripts/check-i18n.mjs` reported zero hardcoded Chinese for months while four real strings sat
 * in the renderer: an `aria-label`, a `hint`, a relay label under the QR code and the word 「字符」
 * in a counter. Both causes were in the scanner, not in the code it scans —
 *
 *   `//` inside a string was read as the start of a comment, so everything after the first
 *   `https://` on a line was thrown away, and this codebase puts an example URL in a placeholder
 *   next to the label it is placed beside
 *
 *   a JSX text run was matched with `>([^<>]*)<`, which stops at any `>` — including the one in
 *   `{pages > 1 ? … : …}`, four characters before the word it was supposed to find
 *
 * A green check nobody has tested is a claim, and this one was wrong in the direction that does
 * not announce itself. So the scanner has tests now, and they are the cases that beat it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error — a plain `.mjs` script with no declarations; `findings` is its only export.
import { findings } from "../scripts/check-i18n.mjs";

const found = (source: string, options?: { jsx?: boolean }): string[] =>
	(findings(source, options) as { line: number; text: string }[]).map((one) => one.text);

test("a comment in Chinese is not a finding — that is what comments are for here", () => {
	assert.deepEqual(found("// 这一段解释为什么\nconst a = 1;\n"), []);
	assert.deepEqual(found("/*\n * 为什么这么写\n */\nconst a = 1;\n"), []);
});

test("a URL inside a string does not hide the rest of the line", () => {
	// The BrowserSettings case: the label sat after a placeholder holding an example URL.
	const source = '<TextInput placeholder="https://example.com/search?q=%s" aria-label="自定义搜索地址" />\n';
	assert.deepEqual(found(source), ['"自定义搜索地址"']);
});

test("a string that contains a URL is itself found", () => {
	// The ProviderEditor case: the `//` was inside the very string being checked.
	const source = '<Field hint="例如 https://relay.example.com 或 https://relay.example.com/v1" />\n';
	assert.deepEqual(found(source), ['"例如 https://relay.example.com 或 https://relay.example.com/v1"']);
});

test("a template literal with a URL in it does not swallow the file after it", () => {
	const source = 'const a = `${scheme}://${host}`;\nconst label = "配对地址";\n';
	assert.deepEqual(found(source), ['"配对地址"']);
});

test("JSX text survives a comparison in the expression beside it", () => {
	// The TraceText case, reduced.
	const source = '<span>{text.length} 字符{pages > 1 ? ` · ${page}` : ""}</span>\n';
	assert.deepEqual(found(source), ["字符"]);
});

test("an expression between two words does not join them into one finding", () => {
	const source = "<span>共 {n} 个</span>\n";
	assert.deepEqual(found(source), ["共 个"]);
});

test("the text scan is for JSX only, because `=>` in a plain module is not a tag", () => {
	/*
	 * `store/derive.ts` produced this: with no tag to stop at, a run that starts at the `>` of an
	 * arrow crosses the rest of the module and reports whatever Chinese it passed. The strings in
	 * it are still found by the string scan — which is the only scan a `.ts` file needs.
	 */
	const source = 'const f = (n: number) => n + 1;\nexport const PROMPTS = ["继续"];\n';
	assert.deepEqual(found(source, { jsx: false }), ['"继续"']);
});

test("an i18n-exempt note speaks for the lines under it, up to the first blank one", () => {
	const source = [
		"// i18n-exempt: 这段文字发给模型，翻译它会改变行为",
		'const PROMPTS = ["继续", "接着做"];',
		"",
		'const label = "下一步";',
		"",
	].join("\n");
	assert.deepEqual(found(source), ['"下一步"']);
});

test("an escaped quote does not end the string it is inside", () => {
	const source = 'const a = "他说 \\"好\\" 然后走了";\n';
	assert.deepEqual(found(source), ['"他说 \\"好\\" 然后走了"']);
});

test("a comment inside a template expression is still a comment", () => {
	const source = "const a = `${/* 这里解释一下 */ value}`;\nconst b = \"标签\";\n";
	assert.deepEqual(found(source), ['"标签"']);
});
