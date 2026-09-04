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
import { loadSkills, parseFrontmatter } from "../src/skills/loader.ts";

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
	assert.equal(parseFrontmatter("---\n: : :\n---\nbody\n"), null);
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
