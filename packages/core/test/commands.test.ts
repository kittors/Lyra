/**
 * Slash commands: what is found on disk, and what `/name args` turns into.
 *
 * Real directories throughout. The whole of the discovery half is "does this layout on disk
 * produce that list", and a fixture that hands back a prepared list answers a question nobody
 * asked.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { expandCommand, parseInvocation, rankCommands, splitArguments } from "../src/commands/expand.ts";
import { type CommandSource, loadCommands, type SlashCommand } from "../src/commands/loader.ts";

let root: string;

async function put(path: string, body: string): Promise<void> {
	await mkdir(join(root, path, ".."), { recursive: true });
	await writeFile(join(root, path), body);
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-commands-"));
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const sources = (): CommandSource[] => [
	{ dir: join(root, "project/.lyra/commands"), scope: "workspace", origin: "lyra" },
	{ dir: join(root, "home/commands"), scope: "user", origin: "lyra" },
	{ dir: join(root, "project/.claude/commands"), scope: "workspace", origin: "claude" },
];

test("a markdown file becomes a command, described by its frontmatter", async () => {
	await put(
		"project/.lyra/commands/review.md",
		"---\ndescription: 审查改动\nargument-hint: <文件>\n---\n\n请审查 $ARGUMENTS。",
	);

	const { commands } = await loadCommands(sources());
	const review = commands.find((c) => c.name === "review");
	assert.ok(review, "the file was found");
	assert.equal(review.description, "审查改动");
	assert.equal(review.argumentHint, "<文件>");
	assert.equal(review.scope, "workspace");
	assert.equal(review.content, "请审查 $ARGUMENTS。");
});

test("a nested directory namespaces the command", async () => {
	await put("project/.lyra/commands/git/commit.md", "写一条提交信息");

	const { commands } = await loadCommands(sources());
	assert.ok(
		commands.some((c) => c.name === "git:commit"),
		`git/commit.md is /git:commit (${commands.map((c) => c.name).join(", ")})`,
	);
});

test("a command with no description borrows the first line of its body", async () => {
	await put("home/commands/tidy.md", "# 整理导入\n\n把 import 排好序。");

	const { commands } = await loadCommands(sources());
	const tidy = commands.find((c) => c.name === "tidy");
	assert.ok(tidy);
	assert.equal(tidy.description, "整理导入", "the heading marks are not part of it");
});

test("commands written for Claude Code are found too, and lose only on a name collision", async () => {
	/*
	 * The point of reading `.claude/commands`: these files are prompts in markdown, and asking
	 * someone to copy them across to be told the same thing back is a worse product for no reason.
	 */
	await put("project/.claude/commands/security-review.md", "---\ndescription: 安全审查\n---\n检查注入风险。");
	// Same name as one of ours, to prove which wins.
	await put("project/.claude/commands/review.md", "---\ndescription: 来自 Claude 的审查\n---\n别的内容");

	const { commands } = await loadCommands(sources());
	const claude = commands.find((c) => c.name === "security-review");
	assert.ok(claude, "a Claude Code command is available");
	assert.equal(claude.origin, "claude", "and says where it came from");

	const review = commands.find((c) => c.name === "review");
	assert.equal(review?.description, "审查改动", "ours wins the collision, and the other is simply shadowed");
});

test("the shadowed command is reported, and the report names the file that won", async () => {
	/*
	 * Shadowing silently is how someone ends up staring at a `/review` that behaves like a stranger
	 * wrote it. The list shows one entry, and nothing on screen says a second file lost.
	 */
	const { diagnostics } = await loadCommands(sources());
	const shadowed = diagnostics.find((d) => d.path.includes(join(".claude", "commands", "review.md")));
	assert.ok(shadowed, `the losing file is named (${diagnostics.map((d) => d.path).join("; ")})`);
	assert.match(shadowed.message, /review/, "the message says which command");
	assert.match(shadowed.message, /\.lyra/, "and points at the file that took it");
});

test("frontmatter that opens and never closes is reported instead of becoming prose", async () => {
	/*
	 * The parse still succeeds — the whole file becomes the body, which is all that is left once
	 * the delimiters are unusable. What must not happen is doing that in silence: the author sees a
	 * file that looks like it has metadata, and the model gets `description:` injected as text.
	 */
	await put("home/commands/unterminated.md", "---\ndescription: 忘了闭合\n\n正文在这里。");

	const { commands, diagnostics } = await loadCommands(sources());
	const loaded = commands.find((c) => c.name === "unterminated");
	assert.ok(loaded, "it still loads — refusing the file would cost the user a command");
	assert.ok(
		diagnostics.some((d) => d.path.includes("unterminated") && /闭合/.test(d.message)),
		`and the problem is named (${diagnostics.map((d) => d.message).join("; ")})`,
	);
});

test("a name that is not kebab-case is reported rather than silently skipped", async () => {
	await put("home/commands/Bad Name.md", "内容");

	const { commands, diagnostics } = await loadCommands(sources());
	assert.ok(!commands.some((c) => c.name.includes(" ")), "it is not loaded");
	assert.ok(
		diagnostics.some((d) => d.path.includes("Bad Name")),
		`and the user is told why (${diagnostics.map((d) => d.message).join("; ")})`,
	);
});

test("a directory that does not exist is not an error", async () => {
	const { commands, diagnostics } = await loadCommands([
		{ dir: join(root, "nowhere"), scope: "user", origin: "lyra" },
	]);
	assert.deepEqual(commands, []);
	assert.deepEqual(diagnostics, []);
});

// ---------------------------------------------------------------- invocation

test("only a leading slash starts a command", () => {
	assert.deepEqual(parseInvocation("/review src/a.ts"), { name: "review", rest: "src/a.ts" });
	assert.deepEqual(parseInvocation("/review"), { name: "review", rest: "" });
	assert.equal(parseInvocation("看看 src/a.ts 的 1/2"), null, "a slash mid-sentence is a path or a fraction");
	assert.equal(parseInvocation("/"), null, "a bare slash is not a command yet");
});

test("quotes hold a phrase together", () => {
	assert.deepEqual(splitArguments(`a "b c" d`), ["a", "b c", "d"]);
	assert.deepEqual(splitArguments(`'一 二' 三`), ["一 二", "三"]);
	assert.deepEqual(splitArguments("  "), []);
	// A Windows path must survive intact; this is why backslash escaping is not implemented.
	assert.deepEqual(splitArguments(String.raw`C:\Users\x`), [String.raw`C:\Users\x`]);
});

// ---------------------------------------------------------------- expansion

const command = (content: string): SlashCommand => ({
	name: "x",
	description: "",
	content,
	path: "/x.md",
	scope: "user",
	origin: "lyra",
});

test("placeholders take the arguments, one at a time or all at once", () => {
	assert.equal(expandCommand(command("看 $1 和 $2"), "a.ts b.ts"), "看 a.ts 和 b.ts");
	assert.equal(expandCommand(command("处理 $ARGUMENTS"), "a.ts b.ts"), "处理 a.ts b.ts");
	assert.equal(expandCommand(command("处理 $@"), "a.ts b.ts"), "处理 a.ts b.ts");
	assert.equal(expandCommand(command("看 $1 和 $2"), "a.ts"), "看 a.ts 和", "a missing one leaves a gap, not a literal");
});

test("an argument is never rescanned as a placeholder", () => {
	/*
	 * Substituting repeatedly would let text that came from the user rewrite the rest of the
	 * template — paste a shell snippet containing `$2` and the command starts editing itself.
	 */
	assert.equal(expandCommand(command("$1 | $2"), '"echo $2" b'), "echo $2 | b");
});

test("a template that ignores its arguments still receives them", () => {
	assert.equal(
		expandCommand(command("审查当前改动。"), "只看 src/"),
		"审查当前改动。\n\n只看 src/",
		"otherwise the command looks broken rather than the template incomplete",
	);
	assert.equal(expandCommand(command("审查当前改动。"), ""), "审查当前改动。", "and nothing is appended when nothing was typed");
});

// ---------------------------------------------------------------- ranking

test("matching reaches into the middle of a name, but ranks the obvious answer first", () => {
	const list = [
		{ name: "autocompact", description: "" },
		{ name: "compact", description: "" },
		{ name: "commit", description: "" },
		{ name: "unrelated", description: "把内容 compact 一下" },
	];
	const names = rankCommands(list, "com").map((c) => c.name);
	assert.deepEqual(names, ["commit", "compact", "autocompact", "unrelated"]);
});

test("a namespaced command is reachable by its last segment", () => {
	const list = [
		{ name: "git:commit", description: "" },
		{ name: "zzz", description: "" },
	];
	assert.deepEqual(rankCommands(list, "commit").map((c) => c.name), ["git:commit"]);
});

test("an exact name always leads", () => {
	const list = [
		{ name: "compact-all", description: "" },
		{ name: "compact", description: "" },
	];
	assert.equal(rankCommands(list, "compact")[0].name, "compact");
});
