/**
 * 描述短于 40 字符的技能产出 warning——验收清单 07 §10。
 *
 * 太短的描述是一种静默失效：技能加载了、列表里有、模型永远不选它，因为它靠描述决定要不要
 * 用，而「处理 PDF」四个字说不清什么时候该用。是 warning 不是拒绝：它能用，只是不好用。
 * 而 warning 必须跟错误分得开——设置页那句「N 个技能未能加载」数的是没加载的。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadSkills } from "../src/skills/loader.ts";

let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-skilldesc-"));
	await mkdir(join(root, "short"), { recursive: true });
	await mkdir(join(root, "fine"), { recursive: true });
	await mkdir(join(root, "broken"), { recursive: true });
	await writeFile(join(root, "short", "SKILL.md"), '---\nname: short\ndescription: "处理 PDF"\n---\n\n正文。\n');
	await writeFile(join(root, "fine", "SKILL.md"), '---\nname: fine\ndescription: "从 PDF 里抽取文本和表格，用户给了 PDF 文件、或者提到发票、合同、扫描件时用"\n---\n\n正文。\n');
	await writeFile(join(root, "broken", "SKILL.md"), "---\nname: broken\n---\n\n没有描述。\n");
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("短描述：技能加载了，附一条 warning", async () => {
	const { skills, diagnostics } = await loadSkills([{ dir: root, source: "workspace" }]);
	assert.ok(skills.some((s) => s.name === "short"), "它得能用——这是 warning 不是拒绝");
	const warning = diagnostics.find((d) => d.path.includes("short") && d.severity === "warning");
	assert.ok(warning, `该有一条 warning：${JSON.stringify(diagnostics)}`);
	assert.match(warning.message, /40/, "说清线在哪");
});

test("够长的描述没有 warning", async () => {
	const { diagnostics } = await loadSkills([{ dir: root, source: "workspace" }]);
	assert.ok(!diagnostics.some((d) => d.path.includes("fine")), `fine 不该有任何诊断：${JSON.stringify(diagnostics)}`);
});

test("错误和 warning 分得开：没描述的是错误，太短的是 warning", async () => {
	/*
	 * 设置页按这个分两段。混在一起，「未能加载」那个数就错了，而且会让人去找一个不存在的
	 * 加载失败。
	 */
	const { skills, diagnostics } = await loadSkills([{ dir: root, source: "workspace" }]);
	const errors = diagnostics.filter((d) => d.severity !== "warning");
	const warnings = diagnostics.filter((d) => d.severity === "warning");
	assert.equal(errors.length, 1, "只有 broken 是错误");
	assert.ok(errors[0].path.includes("broken"));
	assert.equal(warnings.length, 1, "只有 short 是 warning");
	assert.ok(!skills.some((s) => s.name === "broken"), "错误的确实没加载");
});
