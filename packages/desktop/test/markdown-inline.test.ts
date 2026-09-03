/**
 * Inline tokens — mostly the cases where something looks like syntax and is not.
 *
 * A dollar sign is usually money, `<T>` is usually a type parameter, and an underscore in the
 * middle of an identifier is usually part of the identifier. Getting those wrong is worse than
 * having no support for the feature at all, because it corrupts text that was already fine.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Inline, parseInline } from "../src/lib/markdown/inline.ts";

/** Tokens as a compact shape, so an assertion reads like the sentence it is about. */
function shape(tokens: Inline[]): string {
	return tokens
		.map((t) => {
			if (t.kind === "text") return JSON.stringify(t.text);
			if (t.kind === "code") return `code(${JSON.stringify(t.text)})`;
			if (t.kind === "math") return `${t.display ? "display" : "math"}(${JSON.stringify(t.tex)})`;
			if (t.kind === "break") return "br";
			if (t.kind === "image") return `img(${t.src})`;
			if (t.kind === "link") return `link[${t.href}](${shape(t.children)})`;
			if (t.kind === "tag") return `${t.name}(${shape(t.children)})`;
			return `${t.kind}(${shape(t.children)})`;
		})
		.join(" ");
}

test("an HTML comment leaves nothing behind", () => {
	assert.equal(shape(parseInline("<!-- 请勿删除 -->正文")), '"正文"');
	assert.equal(shape(parseInline("前<!-- x -->后")), '"前" "后"'.replace('" "', '" "'));
});

test("an unterminated comment does not eat the rest as a comment silently", () => {
	// It does consume to the end — but it must terminate rather than loop.
	assert.equal(shape(parseInline("a<!-- b")), '"a"');
});

test("a type parameter is not a tag", () => {
	assert.equal(shape(parseInline("Vec<T> 和 Map<K, V>")), '"Vec<T> 和 Map<K, V>"');
});

test("a comparison is not a tag", () => {
	assert.equal(shape(parseInline("if a < b and b > c")), '"if a < b and b > c"');
});

test("br becomes a break", () => {
	assert.equal(shape(parseInline("第一行<br>第二行")), '"第一行" br "第二行"');
	assert.equal(shape(parseInline("第一行<br/>第二行")), '"第一行" br "第二行"');
});

test("kbd is kept, span is not", () => {
	assert.equal(shape(parseInline("按 <kbd>Cmd</kbd>")), '"按 " kbd("Cmd")');
	assert.equal(shape(parseInline('<span style="color:red">红</span>')), '"红"');
});

test("b and i map onto the tokens we already have", () => {
	assert.equal(shape(parseInline("<b>粗</b><i>斜</i>")), 'strong("粗") em("斜")');
});

test("an anchor keeps its href", () => {
	assert.equal(shape(parseInline('<a href="https://x.com">去</a>')), 'link[https://x.com]("去")');
});

test("money is not a formula", () => {
	assert.equal(shape(parseInline("从 $5 涨到 $10")), '"从 $5 涨到 $10"');
	assert.equal(shape(parseInline("成本 $100。")), '"成本 $100。"');
});

test("a formula is a formula", () => {
	assert.equal(shape(parseInline("复杂度 $O(n \\log n)$。")), '"复杂度 " math("O(n \\\\log n)") "。"');
});

test("emphasis inside a formula is left alone", () => {
	const tokens = parseInline("$a_*b*_c$");
	assert.equal(tokens.length, 1);
	assert.equal(tokens[0].kind, "math");
	assert.equal(tokens[0].tex, "a_*b*_c", "the scanner must not re-enter a formula");
});

test("a display formula on one line", () => {
	assert.equal(shape(parseInline("$$x^2$$")), 'display("x^2")');
});

test("an inline formula does not span lines", () => {
	assert.equal(shape(parseInline("价格 $5\n还有 $6")), '"价格 $5" br "还有 $6"');
});

test("markdown inside a code span stays literal", () => {
	assert.equal(shape(parseInline("`**not bold**`")), 'code("**not bold**")');
	assert.equal(shape(parseInline("`$x$`")), 'code("$x$")');
});

test("a code span can hold a backtick when padded", () => {
	assert.equal(shape(parseInline("`` ` ``")), 'code("`")');
});

test("an underscore inside a word is not emphasis", () => {
	assert.equal(shape(parseInline("identity_admin.result_denied")), '"identity_admin.result_denied"');
});

test("emphasis nests", () => {
	assert.equal(shape(parseInline("**粗 `代码` 粗**")), 'strong("粗 " code("代码") " 粗")');
});

test("a bare URL becomes a link", () => {
	assert.equal(
		shape(parseInline("见 https://github.com/a/b/pull/904")),
		'"见 " link[https://github.com/a/b/pull/904]("https://github.com/a/b/pull/904")',
	);
});

test("a full stop after a URL is prose", () => {
	const tokens = parseInline("见 https://x.com/a。");
	const link = tokens.find((t) => t.kind === "link");
	assert.equal(link?.kind, "link");
	assert.equal(link.href, "https://x.com/a");
});

test("a URL already inside link syntax is not doubled", () => {
	assert.equal(shape(parseInline("[看这里](https://x.com)")), 'link[https://x.com]("看这里")');
});

test("a link title is not part of the href", () => {
	const tokens = parseInline('[x](https://a.com "标题")');
	assert.equal(tokens[0].kind, "link");
	assert.equal(tokens[0].href, "https://a.com");
});

test("an image is an image", () => {
	assert.equal(shape(parseInline("![图](https://x.com/a.png)")), "img(https://x.com/a.png)");
	assert.equal(shape(parseInline('<img src="https://x.com/b.png" width="400">')), "img(https://x.com/b.png)");
});

test("an escape means the character is not syntax", () => {
	assert.equal(shape(parseInline("\\*不是斜体\\*")), '"*不是斜体*"');
	assert.equal(shape(parseInline("\\$5")), '"$5"');
});

test("details and summary tags disappear, their words do not", () => {
	assert.equal(shape(parseInline("<summary>展开日志</summary>")), '"展开日志"');
});

test("a declared width comes through, and only when it is a pixel count", () => {
	// `width="200"` is how a README says a logo is a logo. `50%` is a different instruction, and
	// the number it would yield — 50 — is wrong rather than merely ignored.
	const sized = parseInline('<img src="a.png" alt="A" width="200" height="80">')[0];
	assert.equal(sized.kind === "image" && sized.width, 200);
	assert.equal(sized.kind === "image" && sized.height, 80);

	for (const attrs of ['width="50%"', 'width="auto"', 'width="0"', 'width="99999"', 'data-width="200"']) {
		const token = parseInline(`<img src="a.png" ${attrs}>`)[0];
		assert.equal(token.kind === "image" && token.width, undefined, attrs);
	}
});
