/**
 * Every language the app can colour, what it looks like, and who formats it.
 *
 * Three separate tables answer three parts of that question and none of them answers it whole:
 * `GRAMMARS` in `highlight.ts` knows what can be *coloured*, `PARSERS` in `editor/format.ts`
 * knows what Prettier can *print*, and `EXTERNAL` in `electron/format-external.ts` knows which
 * languages insist on their own binary. This joins them, so the settings page can say — for one
 * language, in one line — whether the options above it will do anything at all.
 *
 * The samples are short on purpose. They are not tutorials; each one exists to put something on
 * every colour a theme declares, which is why nearly all of them carry a comment, a string and a
 * keyword. A sample that exercised four of the eleven would make two themes look more alike than
 * they are.
 *
 * Aliases share an entry. `ts`, `mts` and `cts` are one language wearing three extensions, and
 * listing them separately would pad the picker with rows that differ only in a suffix.
 */

export type FormatterKind =
	/** Prettier, in the renderer. The options on this page apply. */
	| "prettier"
	/** The language's own binary — gofmt, rustfmt, ruff. The options here do not apply. */
	| "external"
	/** Coloured, but nothing here can reformat it. */
	| "none";

export interface LanguageEntry {
	/** Grammar key, as `GRAMMARS` spells it. */
	key: string;
	label: string;
	/** Every extension that resolves here, for searching and for the hint under the name. */
	aliases: string[];
	formatter: FormatterKind;
	/** The binary, for `external`. Shown so the answer to "why not" is actionable. */
	tool?: string;
	sample: string;
}

/*
 * Written out rather than derived, because the derivation would be a lie in both directions:
 * `PARSERS` is keyed by extension including ones nobody thinks of as a language (`cjs`), and
 * `EXTERNAL` lists tools that may not be installed. What is stable is which language belongs to
 * which engine, which is what this states.
 */
export const LANGUAGES: LanguageEntry[] = [
	{
		key: "ts",
		label: "TypeScript",
		aliases: ["ts", "mts", "cts"],
		formatter: "prettier",
		sample: `// 取一个用户，取不到就报错
export async function findUser(id: string): Promise<User> {
	const found = await db.users.findOne({ id });
	if (!found) throw new Error(\`没有这个用户：\${id}\`);
	return found;
}`,
	},
	{
		key: "tsx",
		label: "TSX / React",
		aliases: ["tsx"],
		formatter: "prettier",
		sample: `export function Badge({ count }: { count: number }) {
	// 超过 99 就不再数了
	const label = count > 99 ? "99+" : String(count);
	return <span className="rounded-full bg-accent px-1.5">{label}</span>;
}`,
	},
	{
		key: "js",
		label: "JavaScript",
		aliases: ["js", "mjs", "cjs"],
		formatter: "prettier",
		sample: `// 防抖：安静下来之后才真的执行
export function debounce(fn, wait = 200) {
	let timer = null;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), wait);
	};
}`,
	},
	{
		key: "jsx",
		label: "JSX",
		aliases: ["jsx"],
		formatter: "prettier",
		sample: `export const Empty = ({ title, hint }) => (
	<div className="flex flex-col items-center gap-1">
		<strong>{title}</strong>
		<span className="text-ink-faint">{hint}</span>
	</div>
);`,
	},
	{
		key: "json",
		label: "JSON",
		aliases: ["json"],
		formatter: "prettier",
		sample: `{
	"name": "@lyra/desktop",
	"version": "0.8.32",
	"private": true,
	"scripts": { "dev": "electron-vite dev", "test": "node --test" }
}`,
	},
	{
		key: "jsonc",
		label: "JSON with Comments",
		aliases: ["jsonc"],
		formatter: "prettier",
		sample: `{
	// 编译目标：跟着 Electron 走
	"compilerOptions": {
		"target": "ES2023",
		"strict": true
	}
}`,
	},
	{
		key: "md",
		label: "Markdown",
		aliases: ["md", "mdx", "markdown"],
		formatter: "prettier",
		sample: `# 标题

正文里可以有 **粗体**、*斜体*、\`行内代码\` 和 [链接](https://example.com)。

> 引用里也可以写东西。

1. 有序的一条
2. 有序的两条

\`\`\`ts
const answer = 42;
\`\`\``,
	},
	{
		key: "css",
		label: "CSS",
		aliases: ["css"],
		formatter: "prettier",
		sample: `/* 卡片，浮在页面之上一点点 */
.card {
	background: var(--color-card);
	border-radius: 10px;
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}`,
	},
	{
		key: "scss",
		label: "SCSS",
		aliases: ["scss", "sass"],
		formatter: "prettier",
		sample: `$radius: 10px;

.card {
	border-radius: $radius;
	&:hover { background: rgba(0, 0, 0, 0.04); }
}`,
	},
	{
		key: "less",
		label: "Less",
		aliases: ["less"],
		formatter: "prettier",
		sample: `@radius: 10px;

.card {
	border-radius: @radius;
	&:hover { background: fade(#000, 4%); }
}`,
	},
	{
		key: "html",
		label: "HTML",
		aliases: ["html", "htm"],
		formatter: "prettier",
		sample: `<!doctype html>
<html lang="zh">
	<head>
		<!-- 字符集要在最前面 -->
		<meta charset="utf-8" />
		<title>Lyra</title>
	</head>
	<body>
		<main id="root" data-ready="false"></main>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>`,
	},
	{
		key: "vue",
		label: "Vue SFC",
		aliases: ["vue"],
		formatter: "prettier",
		sample: `<template>
	<button :class="{ on }" @click="on = !on">{{ label }}</button>
</template>

<script setup lang="ts">
const on = ref(false);
const label = computed(() => (on.value ? "开" : "关"));
</script>

<style scoped>
button { border-radius: 6px; }
</style>`,
	},
	{
		key: "svelte",
		label: "Svelte",
		aliases: ["svelte"],
		formatter: "none",
		sample: `<script lang="ts">
	let count = 0;
	$: doubled = count * 2;
</script>

<button on:click={() => count++}>点了 {count} 次</button>`,
	},
	{
		key: "xml",
		label: "XML / SVG",
		aliases: ["xml", "svg"],
		formatter: "none",
		sample: `<!-- 一个圆 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
	<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" />
</svg>`,
	},
	{
		key: "py",
		label: "Python",
		aliases: ["py", "pyi", "python"],
		formatter: "external",
		tool: "ruff / black",
		sample: `# 一个用户，以及打招呼的方式
from dataclasses import dataclass


@dataclass
class User:
    """带默认值的用户记录。"""

    id: str
    name: str = "匿名"
    tags: list[str] = ()

    def greet(self, times: int = 1) -> str:
        return "、".join(f"你好，{self.name}" for _ in range(times))`,
	},
	{
		key: "go",
		label: "Go",
		aliases: ["go"],
		formatter: "external",
		tool: "gofmt",
		sample: `package main

import "fmt"

// Greet 打个招呼。
func Greet(name string) string {
	if name == "" {
		name = "匿名"
	}
	return fmt.Sprintf("你好，%s", name)
}`,
	},
	{
		key: "rs",
		label: "Rust",
		aliases: ["rs"],
		formatter: "external",
		tool: "rustfmt",
		sample: `/// 打个招呼。
pub fn greet(name: Option<&str>) -> String {
    match name {
        Some(n) => format!("你好，{n}"),
        None => "你好".to_string(),
    }
}`,
	},
	{
		key: "java",
		label: "Java",
		aliases: ["java"],
		formatter: "external",
		tool: "google-java-format",
		sample: `package com.lyra;

/** 一个用户。 */
public record User(String id, String name) {
	public String greet() {
		return "你好，" + name;
	}
}`,
	},
	{
		key: "kt",
		label: "Kotlin",
		aliases: ["kt", "kts"],
		formatter: "external",
		tool: "ktfmt",
		sample: `// 一个用户
data class User(val id: String, val name: String = "匿名") {
    fun greet(): String = "你好，$name"
}`,
	},
	{
		key: "c",
		label: "C",
		aliases: ["c", "h"],
		formatter: "external",
		tool: "clang-format",
		sample: `#include <stdio.h>

/* 打个招呼 */
int main(void) {
	const char *name = "世界";
	printf("你好，%s\\n", name);
	return 0;
}`,
	},
	{
		key: "cpp",
		label: "C++",
		aliases: ["cpp", "hpp", "cc", "cxx"],
		formatter: "external",
		tool: "clang-format",
		sample: `#include <string>

// 一个用户
struct User {
	std::string id;
	std::string name{"匿名"};

	[[nodiscard]] std::string greet() const { return "你好，" + name; }
};`,
	},
	{
		key: "cs",
		label: "C#",
		aliases: ["cs"],
		formatter: "none",
		sample: `namespace Lyra;

// 一个用户
public record User(string Id, string Name = "匿名")
{
    public string Greet() => $"你好，{Name}";
}`,
	},
	{
		key: "swift",
		label: "Swift",
		aliases: ["swift"],
		formatter: "external",
		tool: "swift-format",
		sample: `// 一个用户
struct User {
    let id: String
    var name: String = "匿名"

    func greet() -> String { "你好，\\(name)" }
}`,
	},
	{
		key: "rb",
		label: "Ruby",
		aliases: ["rb", "ruby"],
		formatter: "external",
		tool: "rubocop",
		sample: `# 一个用户
class User
  attr_reader :id, :name

  def initialize(id, name = "匿名")
    @id = id
    @name = name
  end

  def greet = "你好，#{name}"
end`,
	},
	{
		key: "php",
		label: "PHP",
		aliases: ["php"],
		formatter: "external",
		tool: "php-cs-fixer",
		sample: `<?php

// 一个用户
final class User
{
    public function __construct(
        public readonly string $id,
        public string $name = '匿名',
    ) {}

    public function greet(): string
    {
        return "你好，{$this->name}";
    }
}`,
	},
	{
		key: "sql",
		label: "SQL",
		aliases: ["sql"],
		formatter: "external",
		tool: "sql-formatter",
		sample: `-- 最近登录过的用户
SELECT u.id, u.name, COUNT(s.id) AS sessions
FROM users AS u
LEFT JOIN sessions AS s ON s.user_id = u.id
WHERE u.last_seen_at > NOW() - INTERVAL '7 days'
GROUP BY u.id, u.name
ORDER BY sessions DESC
LIMIT 20;`,
	},
	{
		key: "yaml",
		label: "YAML",
		aliases: ["yaml", "yml"],
		formatter: "prettier",
		sample: `# 部署
services:
  api:
    image: registry/api:latest
    ports: ["8080:8080"]
    environment:
      NODE_ENV: production`,
	},
	{
		key: "toml",
		label: "TOML",
		aliases: ["toml"],
		formatter: "external",
		tool: "taplo",
		sample: `# 包信息
[package]
name = "demo"
version = "0.1.0"

[dependencies]
serde = { version = "1", features = ["derive"] }`,
	},
	{
		key: "ini",
		label: "INI / Properties",
		aliases: ["ini", "cfg", "conf", "properties", "editorconfig"],
		formatter: "none",
		sample: `; 缩进用制表符
[*]
indent_style = tab
indent_size = 2
end_of_line = lf`,
	},
	{
		key: "env",
		label: ".env",
		aliases: ["env"],
		formatter: "none",
		sample: `# 别把这个文件提交上去
NODE_ENV=production
DATABASE_URL=postgres://localhost:5432/lyra
API_KEY="不要写真的"`,
	},
	{
		key: "sh",
		label: "Shell",
		aliases: ["sh", "bash", "zsh", "fish"],
		formatter: "external",
		tool: "shfmt",
		sample: `#!/usr/bin/env bash
set -euo pipefail

# 逐个构建并推送
for name in api web; do
	docker build -t "registry/\${name}:latest" "./\${name}"
	docker push "registry/\${name}:latest"
done`,
	},
	{
		key: "ps1",
		label: "PowerShell",
		aliases: ["ps1", "psm1", "powershell"],
		formatter: "none",
		sample: `# 打个招呼
function Get-Greeting {
	param([string]$Name = "匿名")
	"你好，$Name"
}`,
	},
	{
		key: "dockerfile",
		label: "Dockerfile",
		aliases: ["dockerfile"],
		formatter: "none",
		sample: `# 构建阶段
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm i --frozen-lockfile
CMD ["node", "server.js"]`,
	},
	{
		key: "nginx",
		label: "nginx",
		aliases: ["nginx"],
		formatter: "none",
		sample: `# 反向代理
upstream api {
	server 127.0.0.1:8080 weight=3;
}

server {
	listen 80;
	server_name example.com;
	gzip on;

	location /api/ {
		proxy_pass http://api;
		proxy_set_header Host $host;
		proxy_read_timeout 60s;
	}
}`,
	},
	{
		key: "graphql",
		label: "GraphQL",
		aliases: ["graphql", "gql"],
		formatter: "prettier",
		sample: `# 取一个用户和他最近的会话
query User($id: ID!) {
	user(id: $id) {
		id
		name
		sessions(last: 5) { id startedAt }
	}
}`,
	},
	{
		key: "proto",
		label: "Protocol Buffers",
		aliases: ["proto", "protobuf"],
		formatter: "none",
		sample: `syntax = "proto3";

// 一个用户
message User {
	string id = 1;
	string name = 2;
	repeated string roles = 3;
}`,
	},
	{
		key: "lua",
		label: "Lua",
		aliases: ["lua"],
		formatter: "external",
		tool: "stylua",
		sample: `-- 打个招呼
local function greet(name)
	name = name or "匿名"
	return ("你好，%s"):format(name)
end

return { greet = greet }`,
	},
	{
		key: "r",
		label: "R",
		aliases: ["r"],
		formatter: "none",
		sample: `# 打个招呼
greet <- function(name = "匿名") {
  sprintf("你好，%s", name)
}

print(greet("世界"))`,
	},
	{
		key: "jl",
		label: "Julia",
		aliases: ["jl"],
		formatter: "none",
		sample: `# 打个招呼
function greet(name::String = "匿名")::String
    return "你好，$(name)"
end`,
	},
	{
		key: "scala",
		label: "Scala",
		aliases: ["scala", "sc"],
		formatter: "none",
		sample: `// 一个用户
final case class User(id: String, name: String = "匿名"):
  def greet: String = s"你好，$name"`,
	},
	{
		key: "hs",
		label: "Haskell",
		aliases: ["hs", "haskell"],
		formatter: "none",
		sample: `-- 打个招呼
greet :: Maybe String -> String
greet (Just name) = "你好，" ++ name
greet Nothing     = "你好"`,
	},
	{
		key: "clj",
		label: "Clojure",
		aliases: ["clj", "cljs", "clojure"],
		formatter: "none",
		sample: `;; 打个招呼
(defn greet
  ([] (greet "匿名"))
  ([name] (str "你好，" name)))`,
	},
	{
		key: "ex",
		label: "Elixir",
		aliases: ["ex", "exs"],
		formatter: "none",
		sample: `defmodule Greeter do
  # 打招呼用的
  @moduledoc "对外只有一个函数。"

  @spec greet(String.t(), pos_integer()) :: String.t()
  def greet(name \\\\ "匿名", times \\\\ 1) do
    Enum.map_join(1..times, "、", fn _ -> "你好，#{name}" end)
  end
end`,
	},
	{
		key: "erl",
		label: "Erlang",
		aliases: ["erl"],
		formatter: "none",
		sample: `%% 打个招呼
-module(greeter).
-export([greet/1]).

greet(Name) ->
	io_lib:format("你好，~s", [Name]).`,
	},
	{
		key: "dart",
		label: "Dart",
		aliases: ["dart"],
		formatter: "external",
		tool: "dart format",
		sample: `// 一个用户
class User {
  User(this.id, [this.name = '匿名']);

  final String id;
  final String name;

  String greet() => '你好，$name';
}`,
	},
	{
		key: "groovy",
		label: "Groovy",
		aliases: ["groovy", "gradle"],
		formatter: "none",
		sample: `// 构建脚本
plugins { id 'java' }

def env = System.getenv('CI') ? 'ci' : 'local'

class Version {
	static final String CURRENT = '0.8.32'
}

dependencies {
	implementation 'com.google.guava:guava:33.0.0-jre'
}`,
	},
	{
		key: "m",
		label: "Objective-C",
		aliases: ["m", "mm"],
		formatter: "none",
		sample: `// 一个用户
@interface User : NSObject
@property (nonatomic, copy) NSString *name;
- (NSString *)greet;
@end`,
	},
	{
		key: "perl",
		label: "Perl",
		aliases: ["perl", "pl", "pm"],
		formatter: "none",
		sample: `# 打个招呼
sub greet {
	my ($name) = @_;
	$name //= "匿名";
	return "你好，$name";
}`,
	},
	{
		key: "cmake",
		label: "CMake",
		aliases: ["cmake"],
		formatter: "none",
		sample: `# 最低版本
cmake_minimum_required(VERSION 3.20)
project(demo LANGUAGES CXX)

add_executable(demo src/main.cpp)
target_compile_features(demo PRIVATE cxx_std_20)`,
	},
	{
		key: "tex",
		label: "LaTeX",
		aliases: ["tex", "latex"],
		formatter: "none",
		sample: `% 一份文档
\\documentclass{article}
\\begin{document}
	你好，世界。
\\end{document}`,
	},
	{
		key: "diff",
		label: "Diff / Patch",
		aliases: ["diff", "patch"],
		formatter: "none",
		sample: `--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,4 @@
 export function greet(name: string) {
-  return "Hello, " + name;
+  return \`你好，\${name}\`;
 }`,
	},
	{
		key: "gitignore",
		label: ".gitignore",
		aliases: ["gitignore", "dockerignore", "npmignore"],
		formatter: "none",
		sample: `# 构建产物，不进仓库
node_modules/
dist/
*.log

# 但这个要留着：它是资产，不是产物
!build/icon.icns`,
	},
];

/** Search by name, by extension, or by the formatter's name. */
export function searchLanguages(query: string): LanguageEntry[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return LANGUAGES;
	return LANGUAGES.filter(
		(entry) =>
			entry.label.toLowerCase().includes(needle) ||
			entry.key.includes(needle) ||
			entry.aliases.some((alias) => alias.includes(needle)) ||
			(entry.tool ?? "").toLowerCase().includes(needle),
	);
}

/** How many languages fall into each engine, for the summary line on the settings page. */
export function formatterCounts(): Record<FormatterKind, number> {
	const counts: Record<FormatterKind, number> = { prettier: 0, external: 0, none: 0 };
	for (const entry of LANGUAGES) counts[entry.formatter]++;
	return counts;
}
