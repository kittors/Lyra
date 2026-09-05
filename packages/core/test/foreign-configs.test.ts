/**
 * 「这个仓库里有其他 AI 工具的配置，Lyra 已经在用」——那几行从哪来（15 §5）。
 *
 * 数字要是真的：一个 `.cursor/rules/` 里两个能解析的文件，才是「2 条规则」；空目录什么都不是。
 * 所以从注册表读，而不是看目录在不在。只算这个仓库里的——`~/.cursor/rules` 是你自己的，不是
 * 仓库带的。看过一次记在项目自己的目录里，不进仓库。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FOREIGN_CONFIGS_NOTICE, foreignConfigsIn, markNoticed, noticed, projectNoticesPath } from "../src/runtime/foreign-configs.ts";

let home: string;
let repo: string;

async function put(path: string, body: string): Promise<void> {
	await mkdir(join(repo, path, ".."), { recursive: true });
	await writeFile(join(repo, path), body, "utf8");
}

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-foreign-home-"));
	repo = await mkdtemp(join(tmpdir(), "ly-foreign-repo-"));
	process.env.LYRA_HOME = home;
	await mkdir(join(repo, ".git"), { recursive: true });
	await put(".cursor/rules/a.mdc", "---\ndescription: A\n---\n甲。");
	await put(".cursor/rules/b.mdc", "---\ndescription: B\n---\n乙。");
	await put(".claude/commands/review.md", "---\ndescription: 审查\n---\n审。");
	await put(".claude/skills/pdf/SKILL.md", "---\nname: pdf\ndescription: 读 PDF，抽取表格与正文，用于总结长文档\n---\n正文");
	await put("AGENTS.md", "# 约定\n\n用 pnpm。");
	// 我们自己的，不该出现在「其他工具」里
	await put(".lyra/rules/ours.md", "---\ndescription: 我们的\n---\n自家。");
	await put("LYRA.md", "# 自家上下文");
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(repo, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("每家工具一行一处，带真实数量；自家的不算", async () => {
	const lines = await foreignConfigsIn(repo);
	const brief = lines.map((l) => `${l.where} ${l.kind} x${l.count} (${l.label})`);
	assert.deepEqual(brief, [
		".claude/commands/ command x1 (Claude Code)",
		".claude/skills/ skill x1 (Claude Code)",
		".cursor/rules/ rule x2 (Cursor)",
		"AGENTS.md context-file x1 (Codex / Agents 标准)",
	]);
	assert.ok(!lines.some((l) => l.where.startsWith(".lyra/") || l.where === "LYRA.md"), "ours is not another tool's");
});

test("一个只有自家配置的仓库，一行都没有", async () => {
	const plain = await mkdtemp(join(tmpdir(), "ly-foreign-plain-"));
	await mkdir(join(plain, ".lyra", "rules"), { recursive: true });
	await writeFile(join(plain, ".lyra", "rules", "x.md"), "---\ndescription: x\n---\nx", "utf8");
	assert.deepEqual(await foreignConfigsIn(plain), []);
	await rm(plain, { recursive: true, force: true });
});

test("看过一次就记下，记在项目自己的目录里而不是仓库里", async () => {
	assert.equal(await noticed(repo, FOREIGN_CONFIGS_NOTICE), false);
	await markNoticed(repo, FOREIGN_CONFIGS_NOTICE, 123);
	assert.equal(await noticed(repo, FOREIGN_CONFIGS_NOTICE), true);
	assert.ok(projectNoticesPath(repo).startsWith(home), "under LYRA_HOME");
	assert.ok(!projectNoticesPath(repo).startsWith(repo), "never inside the repository");
});
