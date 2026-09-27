/**
 * The README parser, against what READMEs in this catalogue actually contain.
 *
 * Every case below the first few was a leak on the live pages at some point: a `<details>` printed
 * as text, `**[a link](…)**` with its brackets showing, a GitHub `[!NOTE]` read as prose, a code
 * block inside a numbered list restarting the numbering. The rule they all pin is the same one — a
 * README never shows its own source — and the safety rule underneath it: nothing unsafe gets a URL.
 *
 * The tree is written out as a small HTML-like string, only to make the expectations readable. The
 * renderer never builds a string; it builds React elements from the same tree.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { githubBase, parseMarkdown, plainText, resolveUrl, slugify, type Block, type Inline } from "../src/lib/readme/parse.ts";

const BASE = { repo: "owner/repo", dir: "skills/demo" };

function inline(nodes: readonly Inline[]): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case "text":
					return node.value;
				case "code":
					return `<code>${node.value}</code>`;
				case "break":
					return "<br>";
				case "image": {
					const sources = node.sources?.map((source) => `<source media="${source.media}" srcset="${source.srcSet}">`).join("") ?? "";
					return `${sources}<img src="${node.src}" alt="${node.alt}"${node.width ? ` width="${node.width}"` : ""}${node.badge ? " badge" : ""}${node.round ? " round" : ""}>`;
				}
				case "link":
					return `<a href="${node.href}"${node.internal ? " internal" : ""}>${inline(node.children)}</a>`;
				default:
					return `<${node.type}>${inline(node.children)}</${node.type}>`;
			}
		})
		.join("");
}

function html(blocks: readonly Block[]): string {
	return blocks
		.map((block) => {
			switch (block.type) {
				case "heading":
					return `<h${block.level} id="${block.id}"${block.align ? ` align="${block.align}"` : ""}>${inline(block.children)}</h${block.level}>`;
				case "paragraph":
					return `<p${block.align ? ` align="${block.align}"` : ""}>${inline(block.children)}</p>`;
				case "code":
					return `<pre${block.lang ? ` lang="${block.lang}"` : ""}>${block.value}</pre>`;
				case "quote":
					return `<blockquote>${html(block.children)}</blockquote>`;
				case "alert":
					return `<alert ${block.kind}>${html(block.children)}</alert>`;
				case "list": {
					const tag = block.ordered ? "ol" : "ul";
					const items = block.items
						.map((item) => `<li${item.checked === undefined ? "" : item.checked ? " checked" : " unchecked"}>${html(item.children)}</li>`)
						.join("");
					return `<${tag}${block.start !== 1 ? ` start="${block.start}"` : ""}${block.tight ? "" : " loose"}>${items}</${tag}>`;
				}
				case "table":
					return `<table><tr>${block.head.map((cell, index) => `<th${block.align[index] ? ` align="${block.align[index]}"` : ""}>${inline(cell)}</th>`).join("")}</tr>${block.rows
						.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
						.join("")}</table>`;
				case "grid":
					return `<grid>${block.rows.map((row) => `<tr>${row.map((cell) => `<td${cell.width ? ` width="${cell.width}"` : ""}>${html(cell.children)}</td>`).join("")}</tr>`).join("")}</grid>`;
				case "details":
					return `<details${block.open ? " open" : ""}><summary>${inline(block.summary)}</summary>${html(block.children)}</details>`;
				case "group":
					return `<div align="${block.align}">${html(block.children)}</div>`;
				case "rule":
					return "<hr>";
				default:
					return "";
			}
		})
		.join("");
}

const md = (source: string, base: typeof BASE | undefined = BASE) => html(parseMarkdown(source, base ? { base } : {}));

/** Everything a reader would see as text — code excluded, since showing syntax is what code is for. */
function visibleText(blocks: readonly Block[]): string {
	const text = (nodes: readonly Inline[]): string =>
		nodes.map((node) => (node.type === "text" ? node.value : node.type === "code" || node.type === "image" || node.type === "break" ? " " : text(node.children))).join("");
	return blocks
		.map((block) => {
			switch (block.type) {
				case "heading":
				case "paragraph":
					return text(block.children);
				case "quote":
				case "alert":
				case "group":
					return visibleText(block.children);
				case "details":
					return `${text(block.summary)} ${visibleText(block.children)}`;
				case "list":
					return block.items.map((item) => visibleText(item.children)).join(" ");
				case "table":
					return [...block.head, ...block.rows.flat()].map(text).join(" ");
				case "grid":
					return block.rows.flat().map((cell) => visibleText(cell.children)).join(" ");
				default:
					return "";
			}
		})
		.join("\n");
}

// ── HTML is interpreted, never printed ───────────────────────────────

test("a centred banner becomes its picture and its words, centred, with no tags left over", () => {
	const out = md('<div align="center"> <img src="https://x/logo.svg" width="120" /> <h1>Waza</h1> <p><b>Habits as skills.</b></p> </div>');
	assert.equal(
		out,
		'<div align="center"><p><img src="https://x/logo.svg" alt="" width="120"></p><h1 id="waza">Waza</h1><p><strong>Habits as skills.</strong></p></div>',
	);
});

test("a linked badge keeps both the picture and where it points, and is known to be a badge", () => {
	assert.equal(
		md('<a href="https://github.com/o/r/releases"><img src="https://img.shields.io/v.svg" alt="Version"></a>'),
		'<p><a href="https://github.com/o/r/releases"><img src="https://img.shields.io/v.svg" alt="Version" badge></a></p>',
	);
});

test("a badge its author sized past text height is drawn at that size, not squeezed into the row", () => {
	assert.equal(
		md('<img src="https://trendshift.io/api/badge/repositories/1" alt="Trendshift" width="250" height="55"/>'),
		'<p><img src="https://trendshift.io/api/badge/repositories/1" alt="Trendshift" width="250"></p>',
	);
	assert.equal(md('<img src="https://img.shields.io/v.svg" alt="v" height="20">'), '<p><img src="https://img.shields.io/v.svg" alt="v" badge></p>');
});

test("a picture keeps its alt text and resolves against the repository's raw bytes", () => {
	assert.equal(md('<img src="a.png" alt="A diagram">'), '<p><img src="https://raw.githubusercontent.com/owner/repo/HEAD/skills/demo/a.png" alt="A diagram"></p>');
});

test("script and style bodies, and comments, never reach the page", () => {
	const blocks = parseMarkdown('<p>before</p><script src="evil.js">alert("x")</script><style>body{}</style><!-- secret --><p>after</p>');
	const text = visibleText(blocks);
	assert.ok(text.includes("before") && text.includes("after"), text);
	assert.ok(!/script|alert|body\{|secret|</.test(text), text);
});

test("entities come back as the characters they stand for", () => {
	assert.equal(md("<p>a &amp; b &lt;c&gt; &nbsp;&copy;</p>"), "<p>a &amp; b &lt;c&gt;  ©</p>".replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"));
	assert.equal(md("Tom &amp; Jerry &#8212; &#x4e2d;"), "<p>Tom & Jerry — 中</p>");
});

test("a fold opens on its summary, and its body is markdown again — even nested HTML", () => {
	const source = [
		"<details>",
		"<summary>These lovely people already did 🐱</summary>",
		"<br/>",
		'<div align="center">',
		'  <a href="https://cats.example"><img src="https://cdn.example/sponsors.svg" width="1000" loading="lazy" /></a>',
		"</div>",
		"</details>",
		"",
		"## License",
	].join("\n");
	assert.equal(
		md(source),
		'<details><summary>These lovely people already did 🐱</summary><div align="center"><p><a href="https://cats.example"><img src="https://cdn.example/sponsors.svg" alt="" width="1000"></a></p></div></details><h2 id="license">License</h2>',
	);
});

test("a fold with markdown after its summary, across blank lines", () => {
	const out = md("<details open>\n<summary><b>Install</b></summary>\n\n- one\n- two\n\n</details>");
	assert.equal(out, "<details open><summary><strong>Install</strong></summary><ul><li><p>one</p></li><li><p>two</p></li></ul></details>");
});

test("tags inside a line of text: <br>, <kbd>, <sup>, <code>", () => {
	assert.equal(md("Press <kbd>Ctrl</kbd>+<kbd>C</kbd><br>x<sup>2</sup> and <code>a &lt; b</code>"), "<p>Press <kbd>Ctrl</kbd>+<kbd>C</kbd><br>x<sup>2</sup> and <code>a < b</code></p>");
});

test("indented HTML inside a centred block is still HTML, not a code block", () => {
	assert.equal(md('<div align="center">\n    <img src="https://x/a.png">\n</div>'), '<div align="center"><p><img src="https://x/a.png" alt=""></p></div>');
});

test("an HTML table keeps its cells, and the markdown written inside them", () => {
	const source = [
		"<table>",
		"<tr>",
		'<td width="50%">',
		"",
		"## Before",
		"",
		"> Great question! Let me think.",
		"",
		"</td>",
		"",
		'<td width="50%">',
		"",
		"## After",
		"",
		"> 1. Open `src/auth.ts`",
		"> 2. Run the tests",
		"",
		"</td>",
		"</tr>",
		"</table>",
	].join("\n");
	assert.equal(
		md(source),
		'<grid><tr><td width="50%"><h2 id="before">Before</h2><blockquote><p>Great question! Let me think.</p></blockquote></td><td width="50%"><h2 id="after">After</h2><blockquote><ol><li><p>Open <code>src/auth.ts</code></p></li><li><p>Run the tests</p></li></ol></blockquote></td></tr></grid>',
	);
});

test("<picture> keeps its dark variant, and only a colour-scheme query", () => {
	const out = md(
		'<picture><source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg"><source media="(min-width: 1px)" srcset="x.svg"><img src="logo-light.svg" alt="Logo" height="42"></picture>',
	);
	assert.equal(
		out,
		'<p><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/owner/repo/HEAD/skills/demo/logo-dark.svg"><img src="https://raw.githubusercontent.com/owner/repo/HEAD/skills/demo/logo-light.svg" alt="Logo"></p>',
	);
});

test("an avatar drawn round in its style is drawn round here", () => {
	assert.ok(md('<img src="https://github.com/u.png" width="40" style="border-radius:50%" alt="u">').includes(" round>"));
});

// ── Markdown the old renderer showed as source ───────────────────────

test("a link inside bold is a link, not its brackets", () => {
	assert.equal(
		md("The **[Adoption Guide](docs/adoption-guide.md)** covers it."),
		'<p>The <strong><a href="https://github.com/owner/repo/blob/HEAD/skills/demo/docs/adoption-guide.md">Adoption Guide</a></strong> covers it.</p>',
	);
});

test("GitHub's alert blocks become notes of their kind", () => {
	assert.equal(md("> [!NOTE]\n> Read this first."), "<alert note><p>Read this first.</p></alert>");
	assert.equal(md("> [!WARNING] Careful.\n> Very."), "<alert warning><p>Careful. Very.</p></alert>");
	assert.equal(md("> Just a quote"), "<blockquote><p>Just a quote</p></blockquote>");
});

test("escapes are the character, not the backslash", () => {
	assert.equal(md("Benchling\\* and \\_not italic\\_ and \\`tick\\`"), "<p>Benchling* and _not italic_ and `tick`</p>");
});

test("a table keeps an escaped pipe inside its cell, and its column alignment", () => {
	assert.equal(
		md("| a | b |\n|---|:-:|\n| x \\| y | `z` |"),
		'<table><tr><th>a</th><th align="center">b</th></tr><tr><td>x | y</td><td><code>z</code></td></tr></table>',
	);
});

test("code spans of several backticks hold backticks", () => {
	assert.equal(md("Use `` `inline` `` or ` ```block``` `"), "<p>Use <code>`inline`</code> or <code>```block```</code></p>");
});

test("an HTML comment on its own lines disappears; the text after it stays", () => {
	assert.equal(md("<!-- hidden\nstill hidden -->\nVisible"), "<p>Visible</p>");
	assert.equal(md("<!-- a --> after"), "<p>after</p>");
});

// ── Lists ────────────────────────────────────────────────────────────

test("nested lists nest", () => {
	assert.equal(md("- a\n  - b\n  - c\n- d"), "<ul><li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li><li><p>d</p></li></ul>");
	assert.equal(md("1. one\n   - sub\n2. two"), "<ol><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ol>");
});

test("a code block inside a numbered item keeps the numbering going", () => {
	assert.equal(
		md("1. Install:\n\n   ```bash\n   npm i x\n   ```\n\n2. Run it"),
		'<ol loose><li><p>Install:</p><pre lang="bash">npm i x</pre></li><li><p>Run it</p></li></ol>',
	);
});

test("an ordered list keeps the number it starts at", () => {
	assert.equal(md("3. three\n4. four"), '<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>');
});

test("task items are ticked or not", () => {
	assert.equal(md("- [x] done\n- [ ] todo"), "<ul><li checked><p>done</p></li><li unchecked><p>todo</p></li></ul>");
});

test("a wrapped item's second line carries on without being indented", () => {
	assert.equal(md("- first line\nsecond line\n- next"), "<ul><li><p>first line second line</p></li><li><p>next</p></li></ul>");
});

test("a list may follow a paragraph without a blank line", () => {
	assert.equal(md("Steps:\n- one\n- two"), "<p>Steps:</p><ul><li><p>one</p></li><li><p>two</p></li></ul>");
});

// ── Links, pictures and the URLs they are allowed ────────────────────

test("reference-style links and badges resolve through their definitions", () => {
	const out = md("[![npm][badge]][npm] and [docs][]\n\n[badge]: https://img.shields.io/npm/v/x.svg\n[npm]: https://www.npmjs.com/package/x\n[docs]: https://x.dev/docs");
	assert.equal(
		out,
		'<p><a href="https://www.npmjs.com/package/x"><img src="https://img.shields.io/npm/v/x.svg" alt="npm" badge></a> and <a href="https://x.dev/docs">docs</a></p>',
	);
});

test("links with titles and parentheses in their address", () => {
	assert.equal(md('[wiki](https://en.wikipedia.org/wiki/Foo_(bar) "Foo")'), '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a></p>');
});

test("nothing unsafe gets a URL: scripts, data, and paths out of the repository", () => {
	assert.equal(md("[x](javascript:alert(1))"), "<p>x</p>");
	assert.equal(md('<a href="javascript:alert(1)">t</a>'), "<p>t</p>");
	assert.equal(md("![p](data:image/svg+xml;base64,AAAA)"), "");
	assert.equal(md('<img src="data:image/png;base64,AAAA">'), "");
	assert.equal(md("[up](../../../etc/passwd)"), "<p>up</p>");
	assert.equal(resolveUrl("vbscript:x", BASE, "link"), null);
	assert.equal(resolveUrl("  JAVASCRIPT:x", BASE, "link"), null);
	assert.equal(resolveUrl("java\nscript:x", BASE, "link"), null);
});

test("relative paths resolve the way GitHub resolves them", () => {
	assert.equal(resolveUrl("../other/SKILL.md", BASE, "link")?.href, "https://github.com/owner/repo/blob/HEAD/skills/other/SKILL.md");
	assert.equal(resolveUrl("/docs/a.md#x", BASE, "link")?.href, "https://github.com/owner/repo/blob/HEAD/docs/a.md#x");
	assert.equal(resolveUrl("./img/a.png?raw=true", BASE, "image")?.href, "https://raw.githubusercontent.com/owner/repo/HEAD/skills/demo/img/a.png");
	assert.equal(resolveUrl("https://github.com/o/r/blob/main/a.png", BASE, "image")?.href, "https://github.com/o/r/raw/main/a.png");
	assert.equal(resolveUrl("docs/a.md", undefined, "link"), null, "no repository, nowhere to resolve to");
	assert.deepEqual(githubBase("https://github.com/anthropics/skills.git", "/skills/"), { repo: "anthropics/skills", dir: "skills" });
	assert.equal(githubBase("https://gitlab.com/a/b"), undefined);
});

test("a README's table of contents points at this page's headings", () => {
	assert.equal(md("[How it works](#how-it-works)"), '<p><a href="#how-it-works" internal>How it works</a></p>');
});

test("bare URLs are links; the punctuation after them, and Chinese after them, is not", () => {
	assert.equal(md("see https://example.com/a_(b). ok"), '<p>see <a href="https://example.com/a_(b)">https://example.com/a_(b)</a>. ok</p>');
	assert.equal(md("见https://x.com/docs。然后"), '<p>见<a href="https://x.com/docs">https://x.com/docs</a>。然后</p>');
	assert.equal(md("at www.example.com, now"), '<p>at <a href="https://www.example.com">www.example.com</a>, now</p>');
	assert.equal(md("not a=https://x.com"), "<p>not a=https://x.com</p>");
});

test("badges are told apart from pictures", () => {
	assert.ok(md("![ci](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)").includes(" badge>"));
	assert.ok(md("![shot](https://x.dev/screenshot.png)").endsWith('alt="shot"></p>'));
});

// ── Headings and text ────────────────────────────────────────────────

test("headings get GitHub's anchors, told apart when they repeat", () => {
	assert.equal(md("# Hello World\n## Hello World\n### 安装 Install!"), '<h1 id="hello-world">Hello World</h1><h2 id="hello-world-1">Hello World</h2><h3 id="安装-install">安装 Install!</h3>');
	assert.equal(slugify("What's new in v2.0?"), "whats-new-in-v20");
	assert.equal(md("Title\n=====\n\nSub\n---"), '<h1 id="title">Title</h1><h2 id="sub">Sub</h2>');
	assert.equal(md("## Closed ##"), '<h2 id="closed">Closed</h2>');
});

test("lines of Chinese join without a space; lines of English join with one; two spaces break", () => {
	assert.equal(md("第一行\n第二行"), "<p>第一行第二行</p>");
	assert.equal(md("line one\nline two"), "<p>line one line two</p>");
	assert.equal(md("a  \nb"), "<p>a<br>b</p>");
});

test("emphasis: nested, not across code, not inside a snake_case name", () => {
	assert.equal(md("**bold *and italic***"), "<p><strong>bold <em>and italic</em></strong></p>");
	assert.equal(md("*a `b*c` d*"), "<p><em>a <code>b*c</code> d</em></p>");
	assert.equal(md("use snake_case_name here"), "<p>use snake_case_name here</p>");
	assert.equal(md("2 * 3 * 4"), "<p>2 * 3 * 4</p>");
	assert.equal(md("~~gone~~ and **中文：**后面"), "<p><del>gone</del> and <strong>中文：</strong>后面</p>");
});

test("front matter is metadata, not prose", () => {
	assert.equal(md("---\nname: demo\ndescription: x\n---\n\n# Demo"), '<h1 id="demo">Demo</h1>');
});

test("a type parameter in prose is text, not a tag", () => {
	assert.equal(md("Returns Array<T> or <3"), "<p>Returns Array<T> or <3</p>");
});

test("plainText strips a line of markdown down to what it says", () => {
	assert.equal(plainText("**Fast** `grep` and [docs](https://x.dev) &amp; <b>more</b>"), "Fast grep and docs & more");
});

// ── Hostile input ────────────────────────────────────────────────────

test("pathological input stays fast and does not overflow the stack", () => {
	const started = performance.now();
	parseMarkdown(`${"*a ".repeat(20000)}\n\n${"`".repeat(5000)}\n\n${"[".repeat(5000)}\n\n${"<a b ".repeat(3000)}`);
	parseMarkdown(`${">".repeat(2000)} deep`);
	parseMarkdown(`${"- ".repeat(500)}deep list`);
	parseMarkdown(`${"<div>".repeat(300)}x${"</div>".repeat(300)}`);
	const elapsed = performance.now() - started;
	assert.ok(elapsed < 2000, `took ${Math.round(elapsed)}ms`);
});

test("a fold with no summary leaves the label to the renderer, in the interface's language", () => {
	const [fold] = parseMarkdown("<details>\n\nhidden\n\n</details>");
	assert.equal(fold?.type, "details");
	assert.deepEqual(fold?.type === "details" ? fold.summary : null, []);
});
