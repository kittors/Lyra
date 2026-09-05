/**
 * `compileCondition` refuses what the loader refuses, in the loader's words.
 *
 * The function exists so the settings page can check a pattern while it is being typed. That is
 * only worth anything if it agrees with the loader: a page that accepts `(a+)+` and a loader that
 * later drops it in silence would be worse than no check at all. So the last test here reads the
 * diagnostic the loader writes and compares it, character for character, with the reason the
 * page would have shown.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileCondition, conditionSource, MAX_CONDITION_LENGTH } from "../src/rules/condition.ts";
import { loadRules } from "../src/rules/loader.ts";

test("a plain pattern compiles, and inline flags become real flags", () => {
	const plain = compileCondition("rm -rf");
	assert.ok(plain.ok && plain.regex.test("running rm -rf /tmp"));

	const insensitive = compileCondition("(?i)todo");
	assert.ok(insensitive.ok, "the (?i) prefix is how most other tools spell it");
	assert.ok(insensitive.ok && insensitive.regex.test("A TODO left behind"));
	assert.ok(insensitive.ok && !insensitive.regex.source.includes("(?i)"), "the prefix is consumed, not passed to the engine");
});

test("a nested quantifier is refused with the reason spelled out", () => {
	const refused = compileCondition("(a+)+$");
	assert.ok(!refused.ok);
	assert.match(refused.ok ? "" : refused.reason, /嵌套量词/);
});

test("a syntax error is refused with the engine's message", () => {
	const refused = compileCondition("([unclosed");
	assert.ok(!refused.ok);
	assert.match(refused.ok ? "" : refused.reason, /不是合法正则/);
});

test("a pattern past the length cap is refused before anything is compiled", () => {
	const refused = compileCondition("a".repeat(MAX_CONDITION_LENGTH + 1));
	assert.ok(!refused.ok);
	assert.match(refused.ok ? "" : refused.reason, new RegExp(String(MAX_CONDITION_LENGTH)));
});

test("the loader says exactly what the page would have said", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-cond-"));
	const dir = join(root, ".lyra", "rules");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "evil.md"), "---\ncondition: '(a+)+$'\n---\n坏的。", "utf8");
	await writeFile(join(dir, "broken.md"), "---\ncondition: '([unclosed'\n---\n也坏。", "utf8");

	const set = await loadRules([{ dir, source: "workspace", dialect: "lyra" }], { builtin: false });
	assert.equal(set.stream.length, 0, "neither becomes a rule");

	for (const pattern of ["(a+)+$", "([unclosed"]) {
		const page = compileCondition(pattern);
		assert.ok(!page.ok);
		const reason = page.ok ? "" : page.reason;
		assert.ok(
			set.diagnostics.some((d) => d.message === reason),
			`the loader's diagnostics should contain the page's reason verbatim:\n  page:   ${reason}\n  loader: ${set.diagnostics.map((d) => d.message).join("\n          ")}`,
		);
	}
});

test("a compiled condition is written back the way the file spelled it", () => {
	// The settings page hands this to the try-panel; `/todo/i` would be tried as a pattern with slashes.
	for (const pattern of ["todo", "(?i)todo", "(?ms)^rm -rf"]) {
		const compiled = compileCondition(pattern);
		assert.ok(compiled.ok);
		assert.equal(conditionSource(compiled.regex), pattern);
	}
});
