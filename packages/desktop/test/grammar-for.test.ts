/**
 * Which grammar a file gets, decided by its name.
 *
 * The rule that matters is the order: a name wins over an extension, because the files that need
 * this most are the ones whose extension lies. `CMakeLists.txt` is not text, `.gitignore` is not
 * an extension at all, and `Dockerfile` has nothing to go on but its name — all three used to
 * render as one flat colour, which for a configuration file means its comments do not read as
 * comments.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BY_FILENAME, GRAMMARS, grammarKeyFor } from "../src/lib/code/highlight.ts";

test("configuration files that are named rather than suffixed are recognised", () => {
	// Its own grammar now. This said `sh` for as long as there was no `dockerfile` entry in
	// `GRAMMARS` — a reasonable approximation, and no longer the best one available.
	assert.equal(grammarKeyFor("Dockerfile"), "dockerfile");
	assert.equal(grammarKeyFor("project/Makefile"), "sh");
	assert.equal(grammarKeyFor(".gitignore"), "gitignore");
	assert.equal(grammarKeyFor("packages/app/.dockerignore"), "gitignore");
	assert.equal(grammarKeyFor(".editorconfig"), "ini");
});

test("a name beats an extension, which is the whole reason the name table exists", () => {
	// `.txt` would otherwise win, and CMake is not text.
	assert.equal(grammarKeyFor("CMakeLists.txt"), "cmake");
});

test("case and directory separators do not change the answer", () => {
	assert.equal(grammarKeyFor("DOCKERFILE"), "dockerfile");
	assert.equal(grammarKeyFor("a/b/c/.GitIgnore"), "gitignore");
	assert.equal(grammarKeyFor("C:\\\\Users\\\\me\\\\Dockerfile"), "dockerfile");
});

test("the shells, the configs and the scripts all have a grammar now", () => {
	for (const [path, expected] of [
		["deploy.sh", "sh"],
		["setup.bash", "bash"],
		["Cargo.toml", "toml"],
		["app.ini", "ini"],
		["fix.patch", "patch"],
		["init.lua", "lua"],
		["main.swift", "swift"],
		["build.ps1", "ps1"],
		["analysis.r", "r"],
		["schema.proto", "proto"],
	] as const) {
		assert.equal(grammarKeyFor(path), expected, path);
	}
});

test("what it already handled still works", () => {
	assert.equal(grammarKeyFor("src/main.ts"), "ts");
	assert.equal(grammarKeyFor("style.css"), "css");
	assert.equal(grammarKeyFor("data.json"), "json");
	assert.equal(grammarKeyFor("notes.md"), "md");
});

test("a file nothing can parse says so rather than guessing", () => {
	assert.equal(grammarKeyFor("LICENSE"), null);
	assert.equal(grammarKeyFor("photo.png"), null);
	assert.equal(grammarKeyFor("archive.tar.gz"), null);
	assert.equal(grammarKeyFor(""), null);
});

test("every name in the table points at a grammar that exists", () => {
	for (const [name, key] of Object.entries(BY_FILENAME)) {
		assert.ok(GRAMMARS[key], `${name} 指向了不存在的语法 ${key}`);
	}
});

test("every grammar loads without throwing", async () => {
	// A bad import path here is invisible until someone opens that kind of file, months later.
	for (const [key, load] of Object.entries(GRAMMARS)) {
		const extension = await load();
		assert.ok(extension, `${key} 没有返回扩展`);
	}
});

test("a .gitignore is coloured by what each line means, not left as one flat run", async () => {
	// The claim under test is that the parts are *told apart*: a comment, a negation, a glob and a
	// literal must not all come back as the same token, which is what "one colour" was.
	const { ignoreLanguage } = await import("../src/lib/code/ignore-mode.ts");
	const source = ["# 构建产物", "dist/", "*.log", "!build/icon.icns", "[Dd]ebug/"].join("\n");
	const tree = ignoreLanguage.parser.parse(source);

	const kinds = new Map<string, string[]>();
	tree.iterate({
		enter: (node) => {
			const text = source.slice(node.from, node.to);
			if (!text.trim()) return;
			kinds.set(node.name, [...(kinds.get(node.name) ?? []), text]);
		},
	});

	const named = [...kinds.keys()].filter((name) => name !== "Document");
	assert.ok(named.length >= 3, `只分出了 ${named.length} 种 token：${named.join(", ")}`);
	assert.ok(
		[...kinds.entries()].some(([name, texts]) => name.includes("omment") && texts.some((t) => t.includes("构建产物"))),
		"注释没有被识别成注释",
	);
	assert.ok(kinds.has("keyword"), "否定规则 `!` 没有单独的 token —— 它是最容易看错的一行");
});
