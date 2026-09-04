/**
 * Rules: loading, bucketing, and stream matching.
 *
 * The interrupt path itself is verified end to end against a real model in
 * `test/tool-eval/rule-eval.ts` — a fake stream would prove the plumbing and nothing about
 * whether a model actually corrects itself.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRules, ruleSources } from "../src/rules/loader.ts";
import { formatRules, renderRuleInterrupt } from "../src/rules/session.ts";
import { extractPaths, matchGlob, StreamRuleMonitor } from "../src/rules/stream.ts";
import { ruleTool, RULES_KEY } from "../src/tools/rule.ts";
import type { Rule } from "../src/rules/types.ts";

async function rulesDir(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "lyra-rules-"));
	const dir = join(root, ".lyra", "rules");
	await mkdir(dir, { recursive: true });
	for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body, "utf8");
	return root;
}

/**
 * Load only the rules the test wrote.
 *
 * Built-ins are off here on purpose: a test about bucketing should assert on its own two files,
 * not on however many rules the product happens to ship this month. The built-ins have their own
 * section further down, where they are the subject rather than the background.
 */
const load = async (files: Record<string, string>) => {
	const root = await rulesDir(files);
	return await loadRules([{ dir: join(root, ".lyra", "rules"), source: "workspace", dialect: "lyra" }], { builtin: false });
};

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

test("alwaysApply goes into the always bucket", async () => {
	const set = await load({ "commit.md": "---\nalwaysApply: true\n---\n没被要求就不要提交。" });
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].content, "没被要求就不要提交。");
	assert.equal(set.book.length, 0);
});

test("a description alone makes it a rulebook entry", async () => {
	const set = await load({ "css.md": "---\ndescription: CSS 约定\nglobs: ['**/*.css']\n---\n颜色走 token。" });
	assert.equal(set.book.length, 1);
	assert.deepEqual(set.book[0].globs, ["**/*.css"]);
});

test("a condition makes it a stream rule, and wins over alwaysApply", async () => {
	const set = await load({ "no-any.md": "---\nalwaysApply: true\ncondition: ':\\s*any\\b'\n---\n不要用 any。" });
	assert.equal(set.stream.length, 1);
	assert.equal(set.always.length, 0, "a stream rule must not also sit in the prompt");
	assert.equal(set.stream[0].conditions.length, 1);
});

test("a rule that would do nothing is reported rather than silently dropped", async () => {
	const set = await load({ "orphan.md": "这条规则没有任何 frontmatter。" });
	assert.equal(set.always.length + set.book.length + set.stream.length, 0);
	assert.equal(set.diagnostics.length, 1);
	assert.match(set.diagnostics[0].message, /不会生效/);
	assert.match(set.diagnostics[0].message, /description.*alwaysApply.*condition/s);
});

test("a broken regex disables its own rule and says so, without taking the others down", async () => {
	const set = await load({
		"bad.md": "---\ncondition: '([unclosed'\n---\n坏的。",
		"good.md": "---\ncondition: 'TODO'\n---\n好的。",
	});
	assert.equal(set.stream.length, 1, "the good rule must still load");
	assert.equal(set.stream[0].name, "good");
	assert.ok(set.diagnostics.some((d) => /不是合法正则/.test(d.message)));
});

test("an inline (?i) flag is honoured", async () => {
	const set = await load({ "ci.md": "---\ncondition: '(?i)todo'\n---\n不要留 TODO。" });
	assert.ok(set.stream[0].conditions[0].test("TODO"));
	assert.ok(set.stream[0].conditions[0].test("todo"));
});

test("higher-precedence sources shadow same-named rules and say so", async () => {
	const project = await rulesDir({ "x.md": "---\nalwaysApply: true\n---\n项目版本。" });
	const user = await rulesDir({ "x.md": "---\nalwaysApply: true\n---\n用户版本。" });
	const set = await loadRules(
		[
			{ dir: join(project, ".lyra", "rules"), source: "workspace", dialect: "lyra" },
			{ dir: join(user, ".lyra", "rules"), source: "user", dialect: "lyra" },
		],
		{ builtin: false },
	);
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].content, "项目版本。");
	assert.ok(set.diagnostics.some((d) => /已由更高优先级的来源提供/.test(d.message)));
});

// ---------------------------------------------------------------------------
// Scope parsing
// ---------------------------------------------------------------------------

test("the default scope is prose and tools, never thinking", async () => {
	const set = await load({ "r.md": "---\ncondition: 'x'\n---\n。" });
	const kinds = set.stream[0].scopes.map((s) => s.kind);
	assert.deepEqual(kinds.sort(), ["text", "tool"]);
});

test("tool:name(glob) parses into a narrowed scope", async () => {
	const set = await load({ "r.md": "---\ncondition: 'x'\nscope: 'tool:edit(**/*.ts), text'\n---\n。" });
	const scopes = set.stream[0].scopes;
	assert.ok(scopes.some((s) => s.kind === "tool" && "tool" in s && s.tool === "edit" && s.glob === "**/*.ts"));
	assert.ok(scopes.some((s) => s.kind === "text"));
});

// ---------------------------------------------------------------------------
// Stream matching
// ---------------------------------------------------------------------------

function streamRule(over: Partial<Rule> = {}): Rule {
	return {
		name: "no-any",
		path: "/tmp/no-any.md",
		content: "不要用 any。",
		conditions: [/:\s*any\b/],
		scopes: [{ kind: "text" }, { kind: "tool" }],
		interrupt: "always",
		repeat: "once",
		source: "workspace",
		bucket: "stream",
		...over,
	};
}

test("a pattern spanning several deltas still matches", () => {
	const monitor = new StreamRuleMonitor([streamRule()]);
	monitor.startTurn();
	assert.equal(monitor.feed({ source: "text", delta: "const x", key: "text" }).length, 0);
	assert.equal(monitor.feed({ source: "text", delta: ": a", key: "text" }).length, 0);
	const hits = monitor.feed({ source: "text", delta: "ny = 1;", key: "text" });
	assert.equal(hits.length, 1);
	assert.equal(hits[0].rule.name, "no-any");
	assert.match(hits[0].excerpt, /:\s*any/);
});

test("thinking is not watched unless the rule asks for it", () => {
	const off = new StreamRuleMonitor([streamRule()]);
	off.startTurn();
	assert.equal(off.feed({ source: "thinking", delta: "maybe : any works", key: "thinking" }).length, 0);

	const on = new StreamRuleMonitor([streamRule({ scopes: [{ kind: "thinking" }] })]);
	on.startTurn();
	assert.equal(on.feed({ source: "thinking", delta: "maybe : any works", key: "thinking" }).length, 1);
});

test("a rule scoped to one tool ignores the others", () => {
	const rule = streamRule({ scopes: [{ kind: "tool", tool: "edit" }] });
	const monitor = new StreamRuleMonitor([rule]);
	monitor.startTurn();
	assert.equal(monitor.feed({ source: "tool", delta: "x: any", key: "t1", toolName: "bash" }).length, 0);
	assert.equal(monitor.feed({ source: "tool", delta: "x: any", key: "t2", toolName: "edit" }).length, 1);
});

test("a glob-scoped rule needs a matching path in the arguments", () => {
	const rule = streamRule({ scopes: [{ kind: "tool", tool: "edit", glob: "**/*.ts" }] });
	const monitor = new StreamRuleMonitor([rule]);
	monitor.startTurn();
	assert.equal(monitor.feed({ source: "tool", delta: "x: any", key: "a", toolName: "edit", paths: ["a.css"] }).length, 0);
	assert.equal(monitor.feed({ source: "tool", delta: "x: any", key: "b", toolName: "edit", paths: ["src/a.ts"] }).length, 1);
});

test("tool buffers are keyed per call, so a pattern cannot span two calls", () => {
	const monitor = new StreamRuleMonitor([streamRule()]);
	monitor.startTurn();
	// Split so that neither half matches alone — only the concatenation would.
	assert.equal(monitor.feed({ source: "tool", delta: "const x:", key: "call-1", toolName: "edit" }).length, 0);
	assert.equal(monitor.feed({ source: "tool", delta: " any = 1", key: "call-2", toolName: "edit" }).length, 0);
});

test("repeat: once fires a single time per session", () => {
	const monitor = new StreamRuleMonitor([streamRule()]);
	monitor.startTurn();
	const first = monitor.feed({ source: "text", delta: "x: any", key: "text" });
	assert.equal(first.length, 1);
	monitor.markFired(first[0].rule);

	monitor.startTurn();
	assert.equal(monitor.feed({ source: "text", delta: "y: any", key: "text" }).length, 0);
});

test("repeat: afterTurns waits out the gap", () => {
	const monitor = new StreamRuleMonitor([streamRule({ repeat: { afterTurns: 2 } })]);
	monitor.startTurn();
	const hit = monitor.feed({ source: "text", delta: "x: any", key: "text" });
	monitor.markFired(hit[0].rule);

	monitor.startTurn();
	assert.equal(monitor.feed({ source: "text", delta: "x: any", key: "text" }).length, 0, "one turn later is too soon");
	monitor.startTurn();
	assert.equal(monitor.feed({ source: "text", delta: "x: any", key: "text" }).length, 1, "two turns later is eligible");
});

test("even repeat: always is capped within one turn", () => {
	// A rule that re-matched the correction it caused would otherwise loop.
	const monitor = new StreamRuleMonitor([streamRule({ repeat: "always" })]);
	monitor.startTurn();
	for (let i = 0; i < 2; i++) {
		const hits = monitor.feed({ source: "text", delta: `x${i}: any `, key: `k${i}` });
		assert.equal(hits.length, 1);
		monitor.markFired(hits[0].rule);
	}
	assert.equal(monitor.feed({ source: "text", delta: "x3: any", key: "k3" }).length, 0, "the third time in one turn is refused");
});

test("a monitor with no stream rules does nothing at all", () => {
	const monitor = new StreamRuleMonitor([]);
	assert.equal(monitor.active, false);
	monitor.startTurn();
	assert.equal(monitor.feed({ source: "text", delta: "anything : any", key: "text" }).length, 0);
});

test("a nested quantifier is refused at load time", async () => {
	// Measured before this guard existed: `(a+)+$` against 40 characters took 56 seconds, and a
	// JS regex cannot be interrupted once it starts.
	const set = await load({ "evil.md": "---\ncondition: '(a+)+$'\n---\n坏的。" });
	assert.equal(set.stream.length, 0);
	assert.ok(set.diagnostics.some((d) => /嵌套量词/.test(d.message)));
});

test("matching only sees the tail of a long buffer, so input size stays bounded", () => {
	const monitor = new StreamRuleMonitor([streamRule({ conditions: [/NEEDLE/] })]);
	monitor.startTurn();
	// Push the needle far outside the 4 KiB match window.
	monitor.feed({ source: "text", delta: `NEEDLE${"x".repeat(8000)}`, key: "text" });
	assert.equal(monitor.feed({ source: "text", delta: "y", key: "text" }).length, 0, "the needle is outside the window");
	assert.equal(monitor.feed({ source: "text", delta: "NEEDLE", key: "text" }).length, 1, "a fresh occurrence still matches");
});

// ---------------------------------------------------------------------------
// Path extraction and globs
// ---------------------------------------------------------------------------

test("paths come out of partially streamed arguments", () => {
	assert.deepEqual(extractPaths('{"path":"src/a.ts","patch":"REPL'), ["src/a.ts"]);
	assert.deepEqual(extractPaths('{"file_path":"b.css"'), ["b.css"]);
	// Still unterminated — the value so far is what we have.
	assert.deepEqual(extractPaths('{"path":"src/partial'), []);
	assert.deepEqual(extractPaths("{}"), []);
});

test("globs cover the shapes rules are written with", () => {
	assert.ok(matchGlob("*.ts", "a.ts"));
	assert.ok(matchGlob("*.ts", "src/a.ts"), "a bare extension glob should match at any depth");
	assert.ok(matchGlob("**/*.css", "packages/desktop/src/x.css"));
	assert.ok(matchGlob("src/*.ts", "src/a.ts"));
	assert.ok(!matchGlob("src/*.ts", "src/deep/a.ts"), "a single star must not cross a separator");
	assert.ok(!matchGlob("*.ts", "a.js"));
});

// ---------------------------------------------------------------------------
// Prompt and injection shape
// ---------------------------------------------------------------------------

test("the prompt block is empty when there are no rules", async () => {
	const set = await load({});
	assert.equal(formatRules(set), "");
});

test("always-apply bodies and the rulebook listing both appear", async () => {
	const set = await load({
		"a.md": "---\nalwaysApply: true\n---\n常驻内容。",
		"b.md": "---\ndescription: 关于 CSS\nglobs: ['**/*.css']\n---\n正文很长。",
		"c.md": "---\ncondition: 'x'\n---\n流式的。",
	});
	const text = formatRules(set);
	assert.match(text, /<rules>[\s\S]*常驻内容。[\s\S]*<\/rules>/);
	assert.match(text, /<rulebook>[\s\S]*- b \(\*\*\/\*\.css\): 关于 CSS/);
	assert.doesNotMatch(text, /流式的。/, "a stream rule must cost nothing in the prompt");
});

test("the injected message is synthetic and names the rule and the text that tripped it", () => {
	const rule = streamRule();
	const message = renderRuleInterrupt([{ rule, excerpt: ": any", source: "text" }]);
	assert.equal(message.role, "user");
	assert.equal((message as { synthetic?: boolean }).synthetic, true);
	const text = message.content[0].type === "text" ? message.content[0].text : "";
	assert.match(text, /rule="no-any"/);
	assert.match(text, /": any"/);
	assert.match(text, /不要用 any。/);
});

// ---------------------------------------------------------------------------
// The `rule` tool
//
// The rulebook is a menu; without this it has no kitchen behind it.
// ---------------------------------------------------------------------------

test("the rule tool returns a rulebook entry's body", async () => {
	const set = await load({ "css.md": "---\ndescription: CSS 约定\n---\n颜色一律走 --ly-* token。" });
	const state = new Map<string, unknown>([[RULES_KEY, set]]);
	const res = await ruleTool.execute({ name: "css" }, { cwd: "/tmp", sessionId: "t", state });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /--ly-\* token/);
});

test("an unknown rule lists what can be read, and does not leak stream rules", async () => {
	const set = await load({
		"css.md": "---\ndescription: CSS 约定\n---\n正文。",
		"secret.md": "---\ncondition: 'x'\n---\n流式的，不该出现在清单里。",
	});
	const state = new Map<string, unknown>([[RULES_KEY, set]]);
	const res = await ruleTool.execute({ name: "nope" }, { cwd: "/tmp", sessionId: "t", state });
	assert.equal(res.isError, true);
	const text = res.content[0].type === "text" ? res.content[0].text : "";
	assert.match(text, /css/);
	assert.doesNotMatch(text, /secret/, "stream rules are invisible until they fire; do not advertise them");
});

test("the rule tool says something useful when a project has no readable rules", async () => {
	const set = await load({ "s.md": "---\ncondition: 'x'\n---\n只有流式规则。" });
	const state = new Map<string, unknown>([[RULES_KEY, set]]);
	const res = await ruleTool.execute({ name: "anything" }, { cwd: "/tmp", sessionId: "t", state });
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /没有可按需读取的规则/);
});

// ---------------------------------------------------------------------------
// Other tools' rule files
//
// A team's repository usually already has these. Requiring a rewrite before they do anything
// asks for work with no payoff — and that is where people stop.
// ---------------------------------------------------------------------------

async function ecosystem(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "lyra-eco-"));
	for (const [rel, body] of Object.entries(files)) {
		const full = join(root, rel);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, body, "utf8");
	}
	return root;
}

test("a Cursor .mdc rule loads", async () => {
	const root = await ecosystem({ ".cursor/rules/style.mdc": "---\ndescription: 代码风格\nglobs:\n  - '**/*.ts'\n---\n用 tab 缩进。" });
	const set = await loadRules(ruleSources(root, join(root, "home")), { builtin: false });
	assert.equal(set.book.length, 1);
	assert.equal(set.book[0].name, "style");
	assert.deepEqual(set.book[0].globs, ["**/*.ts"]);
});

test("Cursor's alwaysApply is only true when it is literally true", async () => {
	// Cursor's UI writes this key out for every rule. A truthy reading would turn a directory of
	// conditional rules into a directory of rules that are always in the prompt.
	const root = await ecosystem({
		".cursor/rules/a.mdc": "---\ndescription: A\nalwaysApply: false\n---\nA。",
		".cursor/rules/b.mdc": "---\ndescription: B\nalwaysApply: 'yes'\n---\nB。",
		".cursor/rules/c.mdc": "---\ndescription: C\nalwaysApply: true\n---\nC。",
	});
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.deepEqual(set.always.map((r) => r.name), ["c"]);
	assert.deepEqual(set.book.map((r) => r.name).sort(), ["a", "b"]);
});

test("a Cursor rule with globs but no description still gets one", async () => {
	const root = await ecosystem({ ".cursor/rules/css.mdc": "---\nglobs: '**/*.css'\n---\n颜色走 token。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.book.length, 1, "it must not fall through as a rule that does nothing");
	assert.match(set.book[0].description!, /\*\*\/\*\.css/);
});

test(".clinerules works as a directory", async () => {
	const root = await ecosystem({ ".clinerules/general.md": "总是写测试。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].content, "总是写测试。");
});

test(".clinerules works as a single file", async () => {
	// Both spellings are in the wild; a loader that only calls readdir ignores half of them.
	const root = await ecosystem({ ".clinerules": "不要改生成的文件。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].name, "clinerules");
	assert.equal(set.always[0].content, "不要改生成的文件。");
});

test("Copilot applyTo: '**' becomes an always-apply rule with no globs", async () => {
	const root = await ecosystem({ ".github/instructions/all.instructions.md": "---\napplyTo: '**'\n---\n提交信息用中文。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].name, "all", "the double extension must come off in one piece");
	assert.equal(set.always[0].globs, undefined);
});

test("Copilot applyTo with a real glob becomes a rulebook entry", async () => {
	const root = await ecosystem({ ".github/instructions/api.instructions.md": "---\napplyTo: 'src/api/**,src/lib/**'\n---\nAPI 约定。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.book.length, 1);
	assert.deepEqual(set.book[0].globs, ["src/api/**", "src/lib/**"]);
});

test("Copilot with no applyTo still loads, and says why it was guessed at", async () => {
	const root = await ecosystem({ ".github/instructions/x.instructions.md": "---\n---\n没写 applyTo。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.book.length, 1);
	assert.ok(set.diagnostics.some((d) => /缺少 applyTo/.test(d.message)));
});

test("a Windsurf rule with no metadata is a standing instruction", async () => {
	const root = await ecosystem({ ".windsurf/rules/g.md": "不要用 var。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.always.length, 1);
});

test("our own rules win over everyone else's on a name collision", async () => {
	const root = await ecosystem({
		".lyra/rules/style.md": "---\nalwaysApply: true\n---\nLyra 的版本。",
		".cursor/rules/style.mdc": "---\nalwaysApply: true\n---\nCursor 的版本。",
	});
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.equal(set.always.length, 1);
	assert.equal(set.always[0].content, "Lyra 的版本。");
	assert.ok(set.diagnostics.some((d) => /更高优先级/.test(d.message)));
});

test("four dialects coexist in one repository", async () => {
	const root = await ecosystem({
		".lyra/rules/ours.md": "---\ncondition: 'FIXME'\n---\n别留 FIXME。",
		".cursor/rules/cursor.mdc": "---\ndescription: 来自 Cursor\n---\n正文。",
		".clinerules": "来自 Cline。",
		".github/instructions/gh.instructions.md": "---\napplyTo: '**'\n---\n来自 Copilot。",
		".windsurf/rules/ws.md": "来自 Windsurf。",
	});
	const set = await loadRules(ruleSources(root, join(root, "home")), { builtin: false });
	const all = [...set.always, ...set.book, ...set.stream].map((r) => r.name).sort();
	assert.deepEqual(all, ["clinerules", "cursor", "gh", "ours", "ws"]);
	assert.equal(set.stream.length, 1, "our condition rule is the only stream rule");
});

// ---------------------------------------------------------------------------
// Built-in rules
//
// These apply to everybody, so the bar is: catches something a good model still does, does not
// duplicate an existing guard, and is right nearly always.
// ---------------------------------------------------------------------------

test("built-in rules are present by default and are all stream rules", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.deepEqual(set.stream.map((r) => r.name).sort(), ["no-force-push", "no-placeholder-delivery", "no-secret-in-code"]);
	// Costing nothing in the prompt is the point: a built-in that took context would be resented.
	assert.equal(formatRules(set), "");
});

test("built-ins can be switched off by name", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")), { disabled: ["no-force-push"] });
	assert.ok(!set.stream.some((r) => r.name === "no-force-push"));
	assert.ok(set.stream.some((r) => r.name === "no-secret-in-code"));
});

test("built-ins can be dropped wholesale", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")), { builtin: false });
	assert.equal(set.stream.length, 0);
});

test("a user rule of the same name replaces a built-in outright", async () => {
	const root = await ecosystem({ ".lyra/rules/no-force-push.md": "---\nalwaysApply: true\n---\n我自己的版本。" });
	const set = await loadRules(ruleSources(root, join(root, "home")));
	assert.ok(!set.stream.some((r) => r.name === "no-force-push"), "the built-in must be gone, not merged");
	assert.ok(set.always.some((r) => r.content === "我自己的版本。"));
});

test("the secret rule catches published key prefixes and leaves ordinary hex alone", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")));
	const rule = set.stream.find((r) => r.name === "no-secret-in-code")!;
	const hits = (text: string) => rule.conditions.some((c) => c.test(text));

	assert.ok(hits("const key = \"sk-abcdefghij0123456789\""));
	assert.ok(hits("ghp_abcdefghij0123456789xy"));
	assert.ok(hits("AKIAIOSFODNN7EXAMPLE"));
	/*
	 * The hyphenated shapes. These are the formats currently issued, and the first version of this
	 * pattern matched none of them — found by watching a real session write one into a real file.
	 */
	assert.ok(hits("apiKey: \"sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwxyzABC\""));
	assert.ok(hits("sk-svcacct-abcdefghij0123456789"));
	assert.ok(hits("sk-ant-api03-abcdefghij0123456789"));
	// The ones a generic entropy heuristic would ruin: hashes, UUIDs, obvious placeholders.
	assert.ok(!hits("const hash = \"a3f9c2e1b8d7f0a1\""));
	assert.ok(!hits("id: 550e8400-e29b-41d4-a716-446655440000"));
	assert.ok(!hits("apiKey: 'sk-example'"));
	// Hyphens alone must not carry a match: the long opaque run is what makes a key a key.
	assert.ok(!hits("apiKey: 'sk-your-api-key-here'"));
	assert.ok(!hits("apiKey: 'sk-replace-me'"));
});

test("the force-push rule lets --force-with-lease through", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")));
	const rule = set.stream.find((r) => r.name === "no-force-push")!;
	const hits = (text: string) => rule.conditions.some((c) => c.test(text));

	assert.ok(hits("git push --force origin main"));
	assert.ok(hits("git push -f"));
	assert.ok(!hits("git push --force-with-lease origin main"), "the careful form must not be caught");
	assert.ok(!hits("git push origin main"));
});

test("the placeholder rule ignores a plain TODO", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-empty-"));
	const set = await loadRules(ruleSources(root, join(root, "home")));
	const rule = set.stream.find((r) => r.name === "no-placeholder-delivery")!;
	const hits = (text: string) => rule.conditions.some((c) => c.test(text));

	assert.ok(hits("// TODO: implement this"));
	assert.ok(hits("throw new Error('not implemented')"));
	assert.ok(hits("// ... rest of the function"));
	// Ordinary in real code; flagging it would make this rule the boy who cried wolf.
	assert.ok(!hits("// TODO: revisit once the API stabilises"));
	assert.ok(!hits("const todo = items.filter(isPending);"));
});
