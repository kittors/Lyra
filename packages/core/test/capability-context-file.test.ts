/**
 * `context-file` 经注册表——第 14 个「声明了、没接上」。
 *
 * 这个 kind 在 `CapabilityId` 里占着位、在 `kinds.ts` 里连去重规则都定义好了（`scope:depth`，
 * 同一层留一份、跨层都留），而一直没有 provider 供应它。项目指令一直走的是 `prompt/system.ts`
 * 里自己的目录遍历——「按目录找、每层留一个」的第六份副本。
 *
 * `project-instructions.test.ts` 那七条不动，它们是行为不变的护栏。这里测的是**只有经注册表
 * 才有的东西**：遮蔽可见、目录被监听、仓库根边界来自注册表自己。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createRegistry } from "../src/capability/index.ts";
import type { ContextFile } from "../src/capability/types.ts";

let root: string;
let home: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-ctxfile-"));
	home = await mkdtemp(join(tmpdir(), "ly-ctxfile-home-"));
	await mkdir(join(root, "repo", ".git"), { recursive: true });
	await mkdir(join(root, "repo", "packages", "api"), { recursive: true });
	await writeFile(join(root, "repo", "AGENTS.md"), "根：用 pnpm。\n");
	await writeFile(join(root, "repo", "packages", "api", "AGENTS.md"), "api：不加依赖。\n");
	// 同一个目录里两份——那是从别的工具迁过来没删的旧版本
	await writeFile(join(root, "repo", "packages", "api", "CLAUDE.md"), "api 的旧版：这份不该生效。\n");
	await writeFile(join(root, "AGENTS.md"), "仓库外面的，不该被读到。\n");
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const registry = () => createRegistry({ home: join(home, ".lyra"), userHome: home });

test("跨层都留，各带自己的 depth", async () => {
	const result = await registry().load<ContextFile>("context-file", { cwd: join(root, "repo", "packages", "api") });
	const byDepth = result.items.map((f) => `${f.depth}:${f.name}`).sort();
	assert.deepEqual(byDepth, ["0:packages/api/AGENTS.md", "2:AGENTS.md"], JSON.stringify(byDepth));
});

test("同一层的第二份是「被遮蔽」，不是静默消失", async () => {
	/*
	 * provider 自己挑一份的话，CLAUDE.md 就没了，而写它的人对着一份不生效的文件发呆。
	 * 经注册表，它带着「被谁盖的」回来——设置页能说出这件事。
	 */
	const result = await registry().load<ContextFile>("context-file", { cwd: join(root, "repo", "packages", "api") });
	const shadowed = result.all.filter((f) => f.shadowedBy);
	assert.equal(shadowed.length, 1, `该正好有一份被遮蔽：${JSON.stringify(result.all.map((f) => [f.name, Boolean(f.shadowedBy)]))}`);
	assert.ok(shadowed[0].path.endsWith("CLAUDE.md"), "输的是 CLAUDE.md");
	assert.ok(shadowed[0].shadowedBy?.path.endsWith("AGENTS.md"), "盖它的是同一层的 AGENTS.md");
	assert.ok(!result.items.some((f) => f.content.includes("不该生效")), "生效的列表里没有它");
});

test("停在仓库根：外面那份读不到，而边界来自注册表自己", async () => {
	/*
	 * `createRegistry` 给 `repoRoot` 默认之前，每个 provider 拿到的都是 null——「向上遍历到
	 * 仓库根」在注册表这条路上是一句写在计划里的话。
	 */
	const result = await registry().load<ContextFile>("context-file", { cwd: join(root, "repo", "packages", "api") });
	assert.ok(!result.items.some((f) => f.content.includes("仓库外面")));
});

test("走过的目录都在 watched 里，改 AGENTS.md 能触发重载", async () => {
	const result = await registry().load<ContextFile>("context-file", { cwd: join(root, "repo", "packages", "api") });
	assert.ok(result.watched.includes(join(root, "repo")), `根目录该被监听：${result.watched.join("、")}`);
	assert.ok(result.watched.includes(join(root, "repo", "packages", "api")), "cwd 也该被监听");
});

test("不在 git 仓库里时只读 cwd 自己", async () => {
	const loose = join(root, "loose", "deep");
	await mkdir(loose, { recursive: true });
	await writeFile(join(root, "loose", "AGENTS.md"), "上一层，不该被读到。\n");
	await writeFile(join(loose, "AGENTS.md"), "自己这层。\n");
	const result = await registry().load<ContextFile>("context-file", { cwd: loose });
	assert.equal(result.items.length, 1);
	assert.match(result.items[0].content, /自己这层/);
});
