/**
 * Block parsing — mostly the places where a block sits somewhere other than the top level.
 *
 * The bug these came from: a table written under a bullet was appended to that bullet's text as a
 * string, so it reached the inline renderer and its pipes and dashes were drawn literally. Pull
 * request descriptions are full of exactly that shape.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Block, parseMarkdown } from "../src/lib/markdown/blocks.ts";

function only(blocks: Block[], kind: Block["kind"]): Block {
	const found = blocks.find((block) => block.kind === kind);
	assert.ok(found, `expected a ${kind} block, got ${blocks.map((b) => b.kind).join(", ")}`);
	return found;
}

test("a table indented under a bullet is a table, not text", () => {
	const blocks = parseMarkdown(
		[
			"- **自适应节奏**：以是否有更新在执行中为准。",
			"  | 状态 | 轮询 | SSE 重连 |",
			"  |------|------|----------|",
			"  | 运行中 | 2s | 300ms → 3s |",
			"  | 空闲 | 30s | 3s → 30s |",
		].join("\n"),
	);

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	const table = only(list.items[0].children, "table");
	assert.equal(table.kind, "table");
	assert.deepEqual(table.header, ["状态", "轮询", "SSE 重连"]);
	assert.equal(table.rows.length, 2);
	assert.deepEqual(table.rows[1], ["空闲", "30s", "3s → 30s"]);

	// And the bullet's own sentence is untouched — no pipes folded into it.
	assert.ok(!list.items[0].text.includes("|"));
});

test("prose after that table is a paragraph inside the same bullet", () => {
	const blocks = parseMarkdown(
		[
			"- 节奏：",
			"  | a | b |",
			"  |---|---|",
			"  | 1 | 2 |",
			"  更新过程中的行为与原来完全一致。",
			"- 下一条",
		].join("\n"),
	);

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	assert.equal(list.items.length, 2, "the second bullet must still be a sibling, not swallowed");
	assert.equal(list.items[1].text, "下一条");

	const kinds = list.items[0].children.map((child) => child.kind);
	assert.deepEqual(kinds, ["table", "paragraph"]);
});

test("a fenced block under a bullet keeps its own lines", () => {
	const blocks = parseMarkdown(["- 运行：", "  ```sh", "  pnpm dev", "  ```"].join("\n"));

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	const code = only(list.items[0].children, "code");
	assert.equal(code.kind, "code");
	assert.equal(code.lang, "sh");
	assert.equal(code.code, "pnpm dev");
});

test("a fence under a bullet keeps relative indentation inside it", () => {
	const blocks = parseMarkdown(["- 配置：", "  ```json", "  {", '    "a": 1', "  }", "  ```"].join("\n"));

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	const code = only(list.items[0].children, "code");
	assert.equal(code.kind, "code");
	assert.equal(code.code, '{\n  "a": 1\n}', "the two-space bullet indent comes off, the JSON's own does not");
});

test("a wrapped sentence under a bullet still folds into that bullet", () => {
	const blocks = parseMarkdown(["- 第一行", "  第二行", "- 下一条"].join("\n"));

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	assert.equal(list.items[0].text, "第一行\n第二行");
	assert.equal(list.items[0].children.length, 0, "prose must not become a paragraph block");
});

test("a nested list under a bullet is still a nested list", () => {
	const blocks = parseMarkdown(["- 外层", "  - 内层 A", "  - 内层 B", "- 外层二"].join("\n"));

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	assert.equal(list.items.length, 2);
	const inner = only(list.items[0].children, "list");
	assert.equal(inner.kind, "list");
	assert.equal(inner.items.length, 2);
});

test("a table on the line right after a sentence is a table", () => {
	// GitHub allows a table to interrupt a paragraph, and this is how people type one.
	const blocks = parseMarkdown(["改动如下：", "| 状态 | 轮询 |", "|---|---|", "| 空闲 | 30s |"].join("\n"));

	assert.deepEqual(
		blocks.map((block) => block.kind),
		["paragraph", "table"],
	);
});

test("a lone line of pipes is a sentence, not a table", () => {
	const blocks = parseMarkdown("用 | 分隔字段。");
	assert.deepEqual(
		blocks.map((block) => block.kind),
		["paragraph"],
	);
});

test("a pipe inside a code span does not split a cell", () => {
	const blocks = parseMarkdown(["| 类型 | 说明 |", "|---|---|", "| `a \\| b` | 联合 |"].join("\n"));

	const table = only(blocks, "table");
	assert.equal(table.kind, "table");
	assert.deepEqual(table.rows[0], ["`a | b`", "联合"], "one cell, with a literal pipe in it");
});

test("an escaped pipe is literal content", () => {
	const blocks = parseMarkdown(["| a | b |", "|---|---|", "| x \\| y | z |"].join("\n"));

	const table = only(blocks, "table");
	assert.equal(table.kind, "table");
	assert.deepEqual(table.rows[0], ["x | y", "z"]);
});

test("a ragged row keeps the cells it has", () => {
	// Hand-written tables are routinely short a cell; dropping the row would lose real content.
	const blocks = parseMarkdown(["| a | b | c |", "|---|---|---|", "| 1 | 2 |"].join("\n"));

	const table = only(blocks, "table");
	assert.equal(table.kind, "table");
	assert.deepEqual(table.rows[0], ["1", "2"]);
});

test("a checklist is checkboxes, not bullets starting with a bracket", () => {
	const blocks = parseMarkdown("- [x] 已完成\n- [ ] 未完成\n- 普通条目");

	const list = only(blocks, "list");
	assert.equal(list.kind, "list");
	assert.deepEqual(
		list.items.map((item) => [item.checked, item.text]),
		[
			[true, "已完成"],
			[false, "未完成"],
			[undefined, "普通条目"],
		],
		"a bullet that is not a task carries no checked state at all",
	);
});

test("a bracket that is not a checkbox stays text", () => {
	const list = only(parseMarkdown("- [见附录] 说明"), "list");
	assert.equal(list.kind, "list");
	assert.equal(list.items[0].checked, undefined);
	assert.equal(list.items[0].text, "[见附录] 说明");
});

test("a tilde fence is a fence", () => {
	const code = only(parseMarkdown("~~~js\nconst a = 1;\n~~~"), "code");
	assert.equal(code.kind, "code");
	assert.equal(code.lang, "js");
	assert.equal(code.code, "const a = 1;");
});

test("backticks inside a tilde fence are content", () => {
	const code = only(parseMarkdown("~~~\n```\n~~~"), "code");
	assert.equal(code.kind, "code");
	assert.equal(code.code, "```", "the other fence character must not close this block");
});

test("a display formula on its own lines", () => {
	const math = only(parseMarkdown("$$\n\\frac{a}{b}\n$$"), "math");
	assert.equal(math.kind, "math");
	assert.equal(math.tex, "\\frac{a}{b}");
});

test("a display formula written on one line", () => {
	const math = only(parseMarkdown("$$x^2 + y^2 = z^2$$"), "math");
	assert.equal(math.kind, "math");
	assert.equal(math.tex, "x^2 + y^2 = z^2");
});

test("column alignment comes from the colons", () => {
	const table = only(parseMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |"), "table");
	assert.equal(table.kind, "table");
	assert.deepEqual(table.align, ["left", "center", "right"]);
});

test("details keeps its summary and parses its body as blocks", () => {
	const blocks = parseMarkdown("<details>\n<summary>展开日志</summary>\n\n段落\n\n- 一\n- 二\n\n</details>");

	const details = only(blocks, "details");
	assert.equal(details.kind, "details");
	assert.equal(details.summary, "展开日志");
	assert.deepEqual(
		details.children.map((child) => child.kind),
		["paragraph", "list"],
	);
});

test("details without a summary still folds", () => {
	const details = only(parseMarkdown("<details>\n正文\n</details>"), "details");
	assert.equal(details.kind, "details");
	assert.equal(details.summary, "详情");
});

test("a nested details does not end the outer one early", () => {
	const blocks = parseMarkdown("<details>\n<summary>外</summary>\n\n<details>\n<summary>内</summary>\n\n里\n\n</details>\n\n</details>\n\n之后");

	assert.deepEqual(
		blocks.map((block) => block.kind),
		["details", "paragraph"],
		"the trailing paragraph must be outside the fold",
	);
	const outer = only(blocks, "details");
	assert.equal(outer.kind, "details");
	assert.equal(outer.summary, "外");
	assert.ok(
		outer.children.some((child) => child.kind === "details"),
		"the inner fold survives as a fold",
	);
});

/* ---------------------------------------------------------------------------
 * Block-level HTML — the shape of a README's opening.
 *
 * A `<p align="center">` holding a logo was transparent until now: the tag went, the contents
 * stayed, and the alignment went with it. The newlines inside it were read as Markdown line breaks
 * too, so a badge row typed one link per line came out as a stack. Both are container semantics
 * being applied to prose, which is what these cover.
 * ------------------------------------------------------------------------- */

test("a centred container keeps its alignment and its contents", () => {
	const blocks = parseMarkdown('<p align="center">\n  <img src="assets/lyra.png" alt="Lyra" width="200">\n</p>');

	const html = only(blocks, "html");
	assert.equal(html.kind, "html");
	assert.equal(html.align, "center");
	assert.equal(html.children.length, 1);
	assert.equal(html.children[0].kind, "paragraph");
});

test("newlines inside a container are whitespace, not line breaks", () => {
	const html = only(
		parseMarkdown(
			'<p align="center">\n  <a href="a"><img src="1.svg" alt="CI"></a>\n  <a href="b"><img src="2.svg" alt="MIT"></a>\n</p>',
		),
		"html",
	);

	assert.equal(html.kind, "html");
	// One paragraph, folded onto one line: three badges on three lines is the bug this prevents.
	assert.equal(html.children.length, 1);
	const first = html.children[0];
	assert.equal(first.kind, "paragraph");
	assert.ok(first.kind === "paragraph" && !first.text.includes("\n"), first.kind === "paragraph" ? first.text : "");
});

test("an aligned heading is a heading, not a box with text in it", () => {
	const heading = only(parseMarkdown('<h1 align="center">标题</h1>'), "heading");

	assert.equal(heading.kind, "heading");
	assert.equal(heading.kind === "heading" && heading.level, 1);
	assert.equal(heading.kind === "heading" && heading.text, "标题");
	assert.equal(heading.kind === "heading" && heading.align, "center");
});

test("text-align in a style attribute says the same thing as align", () => {
	const html = only(parseMarkdown('<div style="text-align: center">中间</div>'), "html");
	assert.equal(html.kind === "html" && html.align, "center");
});

test("a container with no alignment is still a container", () => {
	const html = only(parseMarkdown("<div>\n\n里面的一段\n\n</div>"), "html");
	assert.equal(html.kind === "html" && html.align, null);
	assert.equal(html.kind === "html" && html.children.length, 1);
});

test("blocks inside a container are still blocks", () => {
	const html = only(parseMarkdown('<div align="center">\n\n## 小标题\n\n- 一\n- 二\n\n</div>'), "html");

	assert.deepEqual(
		html.kind === "html" ? html.children.map((child) => child.kind) : [],
		["heading", "list"],
		"a heading and a list inside a div are a heading and a list",
	);
});

test("a nested container does not end the outer one early", () => {
	const blocks = parseMarkdown('<div align="center">\n<div>内层</div>\n</div>\n\n之后');

	assert.deepEqual(
		blocks.map((block) => block.kind),
		["html", "paragraph"],
		"the trailing paragraph must be outside the box",
	);
	const outer = only(blocks, "html");
	assert.ok(
		outer.kind === "html" && outer.children.some((child) => child.kind === "html"),
		"the inner box survives as a box",
	);
});

test("an unclosed container takes the rest, the way GitHub reads it", () => {
	const blocks = parseMarkdown('<div align="center">\n\n一段\n\n两段');

	assert.deepEqual(
		blocks.map((block) => block.kind),
		["html"],
	);
	assert.equal(blocks[0].kind === "html" && blocks[0].children.length, 2);
});

test("a container ends the paragraph above it", () => {
	const blocks = parseMarkdown('一句话\n<p align="center">中间</p>\n另一句');

	assert.deepEqual(
		blocks.map((block) => block.kind),
		["paragraph", "html", "paragraph"],
	);
});

test("inline tags are not containers", () => {
	// `<span>` and `<kbd>` belong to the inline pass. Pulling one up here would break a sentence
	// in half around it — and `<picture>` must not be read as a `<p>` with attributes.
	for (const line of ["<span>一句</span>话", "<kbd>Esc</kbd> 退出", "<picture><img src='a.png'></picture>"]) {
		assert.deepEqual(
			parseMarkdown(line).map((block) => block.kind),
			["paragraph"],
			line,
		);
	}
});
