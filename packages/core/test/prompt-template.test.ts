/**
 * The template subset: what it renders, and the two places it deliberately differs from JavaScript.
 *
 * An empty array is false, because `{{#if skills}}` must not emit an empty block. And a broken tag
 * renders as itself rather than throwing, because a typo in a prompt should produce a visibly odd
 * prompt, not a session that will not start.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, lookup, renderTemplate, truthy } from "../src/prompt/template.ts";

const render = (source: string, data: Record<string, unknown> = {}) => renderTemplate(source, data);

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

test("a variable is substituted, unescaped", () => {
	/*
	 * Unescaped is the point: this emits plain text for a model, and HTML-escaping it would put
	 * `&amp;` and `&lt;` into a prompt. Handlebars' `{{}}`/`{{{}}}` distinction is pure cost here.
	 */
	assert.equal(render("Hello {{name}}", { name: "<Lyra & co>" }), "Hello <Lyra & co>");
});

test("a missing variable renders as nothing", () => {
	assert.equal(render("[{{nope}}]"), "[]");
});

test("dotted paths reach into objects", () => {
	assert.equal(lookup({ a: { b: { c: 1 } } }, "a.b.c"), 1);
	assert.equal(lookup({ a: null }, "a.b.c"), undefined, "a null on the way is not an error");
});

// ---------------------------------------------------------------------------
// Conditionals
// ---------------------------------------------------------------------------

test("if and else", () => {
	assert.equal(render("{{#if on}}yes{{else}}no{{/if}}", { on: true }), "yes");
	assert.equal(render("{{#if on}}yes{{else}}no{{/if}}", { on: false }), "no");
});

test("unless is the mirror", () => {
	assert.equal(render("{{#unless off}}shown{{/unless}}", { off: false }), "shown");
	assert.equal(render("{{#unless off}}shown{{/unless}}", { off: true }), "");
});

test("an empty array is false — the reason this helper exists", () => {
	/*
	 * In JavaScript `[]` is truthy, which would make every list section carry its own length check
	 * and would emit an empty `<available_skills>` the first time one was forgotten.
	 */
	assert.equal(truthy([]), false);
	assert.equal(truthy([1]), true);
	assert.equal(render("{{#if skills}}<skills/>{{/if}}", { skills: [] }), "");
});

test("zero and empty string are false, as they are in JavaScript", () => {
	assert.equal(truthy(0), false);
	assert.equal(truthy(""), false);
});

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

test("each over scalars exposes `this`", () => {
	assert.equal(render("{{#each names}}[{{this}}]{{/each}}", { names: ["a", "b"] }), "[a][b]");
});

test("each over objects spreads their fields", () => {
	const out = render("{{#each tools}}{{name}}:{{snippet}} {{/each}}", {
		tools: [
			{ name: "read", snippet: "读文件" },
			{ name: "bash", snippet: "跑命令" },
		],
	});
	assert.equal(out, "read:读文件 bash:跑命令");
});

test("the index is available", () => {
	assert.equal(render("{{#each xs}}{{@index}}{{/each}}", { xs: ["a", "b", "c"] }), "012");
});

test("each over nothing takes the else branch", () => {
	assert.equal(render("{{#each xs}}x{{else}}（没有）{{/each}}", { xs: [] }), "（没有）");
});

test("the outer scope is still visible inside each", () => {
	assert.equal(render("{{#each xs}}{{project}}/{{this}} {{/each}}", { project: "lyra", xs: ["a"] }), "lyra/a");
});

// ---------------------------------------------------------------------------
// Tool presence
// ---------------------------------------------------------------------------

test("has renders only when the tool is loaded", () => {
	/*
	 * The helper this whole thing was worth writing for: a session without `bash` must not be given
	 * advice about shell commands.
	 */
	const source = `{{#has tools "bash"}}别用 cat，用 read。{{/has}}`;
	assert.equal(render(source, { tools: ["read", "bash"] }), "别用 cat，用 read。");
	assert.equal(render(source, { tools: ["read"] }), "");
});

test("has requires all of them; hasAny requires one", () => {
	const all = `{{#has tools "grep" "glob"}}both{{/has}}`;
	const any = `{{#hasAny tools "grep" "glob"}}either{{/hasAny}}`;
	assert.equal(render(all, { tools: ["grep"] }), "");
	assert.equal(render(any, { tools: ["grep"] }), "either");
});

test("has has an else branch", () => {
	assert.equal(render(`{{#has tools "bash"}}有{{else}}没有{{/has}}`, { tools: [] }), "没有");
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test("an unknown block renders as itself rather than throwing", () => {
	/*
	 * A prompt is content. A typo in one should produce a visibly odd prompt that somebody notices,
	 * not a window that will not open.
	 */
	assert.equal(render("a{{#nonsense}}b"), "a{{#nonsense}}b");
});

test("an unclosed block does not hang or throw", () => {
	assert.equal(render("start {{#if on}}middle", { on: true }), "start middle");
});

test("compiling once and rendering twice gives two answers", () => {
	const template = compile("{{greeting}} {{name}}");
	assert.equal(template({ greeting: "hi", name: "a" }), "hi a");
	assert.equal(template({ greeting: "yo", name: "b" }), "yo b");
});

test("nesting works to the depth a prompt needs", () => {
	const source = `{{#if skills}}<skills>{{#each skills}}
- {{name}}{{#if description}}: {{description}}{{/if}}{{/each}}
</skills>{{/if}}`;
	const out = render(source, { skills: [{ name: "pdf", description: "读 PDF" }, { name: "bare" }] });
	assert.match(out, /- pdf: 读 PDF/);
	assert.match(out, /- bare$/m, "a skill with no description gets no colon");
});
