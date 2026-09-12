/**
 * What `parseFrontmatter` reports, and what a skill loader does with the report.
 *
 * The interesting case is a block that opens and never closes. The parse cannot fail — with the
 * delimiters unusable, treating the whole file as body is the only reading left — so for a long
 * time it succeeded quietly and the author was left looking at a file that appears to carry
 * metadata and behaves as if it carries none. The skill loads with a name taken from its directory,
 * `description:` arrives in the model's context as prose, and nothing anywhere says so.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { isUnparsable, loadSkills, parseFrontmatter } from "../src/skills/loader.ts";

let root: string;

async function skill(name: string, body: string): Promise<void> {
	await mkdir(join(root, "skills", name), { recursive: true });
	await writeFile(join(root, "skills", name, "SKILL.md"), body);
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-skill-fm-"));
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("a document with no frontmatter is not a problem", () => {
	const parsed = parseFrontmatter("just a body\n");
	assert.ok(parsed);
	assert.deepEqual(parsed.frontmatter, {});
	assert.equal(parsed.body, "just a body\n");
	assert.equal(parsed.problem, undefined, "not having frontmatter is ordinary");
});

test("a closed block parses and leaves no problem", () => {
	const parsed = parseFrontmatter("---\nname: x\n---\nbody\n");
	assert.ok(parsed);
	assert.equal(parsed.frontmatter.name, "x");
	assert.equal(parsed.body, "body\n");
	assert.equal(parsed.problem, undefined);
});

test("an unterminated block still parses, and says so", () => {
	const parsed = parseFrontmatter("---\nname: x\ndescription: y\n\nbody\n");
	assert.ok(parsed, "it is not a parse failure — the file is readable, just not as intended");
	assert.deepEqual(parsed.frontmatter, {}, "no metadata is claimed");
	assert.match(parsed.body, /name: x/, "the whole document is the body, which is the visible symptom");
	assert.ok(parsed.problem, "and the reading is flagged");
	assert.match(parsed.problem, /never closed/);
});

test("invalid YAML is a parse failure, which is a different thing", () => {
	const parsed = parseFrontmatter("---\n: : :\n---\nbody\n");
	assert.ok(isUnparsable(parsed), "不是「读出来是空的」，是根本读不了");
	/*
	 * 解析器的原话要在里面。
	 *
	 * 从前这里返回 null，于是用户能看到的只有「不是合法 YAML」——文件名有了，错在哪没有。
	 * 不比对完整句子（那是 `yaml` 库的措辞，升级会变），只要求它确实说了点什么，并且不是
	 * 我们自己编的一句空话。
	 */
	assert.ok(parsed.invalid.length > 0);
	assert.ok(!parsed.invalid.includes("\n"), "单行，因为它要被拼进一句诊断里");
});

test("a skill with unterminated frontmatter loads but is reported", async () => {
	await skill("broken", "---\nname: broken\ndescription: 忘了闭合\n\n这里是正文。");
	await skill("fine", "---\nname: fine\ndescription: 正常的技能\n---\n正文。");

	const { skills, diagnostics } = await loadSkills([{ dir: join(root, "skills"), source: "workspace" }]);

	assert.ok(
		skills.some((s) => s.name === "fine"),
		"the healthy one is unaffected",
	);
	assert.ok(
		!skills.some((s) => s.name === "broken"),
		"the broken one is skipped — with no frontmatter it has no description, which is already required",
	);

	const reported = diagnostics.filter((d) => d.path.includes("broken"));
	assert.equal(reported.length, 2, `both the cause and the consequence are reported (${reported.map((d) => d.message).join("; ")})`);
	assert.ok(
		reported.some((d) => /never closed/.test(d.message)),
		"the cause: the block was never closed",
	);
	assert.ok(
		reported.some((d) => /`description` is required/.test(d.message)),
		"the consequence: with no metadata there is no description",
	);
});

test("两种拼写的 disable-model-invocation 都算数", async () => {
	/*
	 * 连字符和驼峰在外面都有人写——启发这些格式的那几个工具彼此就不一致。原本只认连字符那一种，
	 * 写了驼峰的人得到的是一个被静默忽略的字段：技能照常加载、照常出现在列表里，只是那个开关
	 * 不起作用。这类失败没有任何迹象。
	 */
	const dir = await mkdtemp(join(tmpdir(), "ly-skill-keys-"));
	try {
		for (const [name, key] of [
			["hyphen", "disable-model-invocation"],
			["camel", "disableModelInvocation"],
		]) {
			await mkdir(join(dir, name), { recursive: true });
			await writeFile(
				join(dir, name, "SKILL.md"),
				`---\nname: ${name}\ndescription: 一个技能\n${key}: true\n---\n正文\n`,
				"utf8",
			);
		}

		const { skills } = await loadSkills([{ dir, source: "workspace" }]);
		assert.equal(skills.length, 2);
		for (const skill of skills) assert.equal(skill.disableModelInvocation, true, `${skill.name} 的开关该生效`);
	} finally {
		await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});
