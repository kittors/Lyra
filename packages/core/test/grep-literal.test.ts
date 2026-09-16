/**
 * What `grep` does with a pattern that is not a regular expression.
 *
 * Models reach for this tool with a fragment of the code they are looking for — `onEvent(event`,
 * `*.ts` — which the regular expression engine rejects outright. Failing there is the worst of the
 * three possible answers: the text is right there in the file, and a tool error teaches nothing
 * except to guess again. So an uncompilable pattern is searched for literally, and the result says
 * so, because a search whose metacharacters were silently disarmed otherwise reads as one that ran
 * as written.
 *
 * Both routes through the tool are covered by these: ripgrep's `--fixed-strings` retry where it is
 * installed, the built-in scanner's escaped pattern where it is not.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { grepTool } from "../src/tools/grep.ts";

const SOURCE = [
	"const handler = onEvent(event) => run(event);",
	'const pattern = "*.ts";',
	"function runAll() { return handler; }",
].join("\n");

async function workspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-grep-"));
	await writeFile(join(dir, "sample.ts"), SOURCE);
	return dir;
}

const ctx = (cwd: string) => ({ cwd, sessionId: "s", state: new Map<string, unknown>() });

for (const fallback of [false, true]) {
	test(`large matching lines have bounded output, including details (fallback=${fallback})`, async (t) => {
		const dir = await workspace();
		t.after(() => rm(dir, { recursive: true, force: true }));
		await writeFile(join(dir, "huge.json"), Array.from({ length: 20 }, () => `needle ${"😀".repeat(20_000)}`).join("\n"));
		const path = process.env.PATH;
		if (fallback) process.env.PATH = "";
		t.after(() => { process.env.PATH = path; });
		const res = await grepTool.execute({ pattern: "needle" }, ctx(dir));
		const text = res.content.map((part) => part.text).join("");
		assert.ok(text.length < 16_000, `output was ${text.length} characters`);
		assert.match(text, /huge.json:1:needle/);
		assert.match(text, /omitted|truncated/);
		assert.match(text, /\[38008 characters omitted;/, "the original omission count survives total-output limiting");
		assert.ok(text.isWellFormed(), "Unicode boundaries stay intact");
		assert.ok(JSON.stringify(res.details).length < 20_000, "details cannot smuggle the original output back in");
	});
}

test("an unclosed group is searched for as text rather than failing", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));

	const res = await grepTool.execute({ pattern: "onEvent(event" }, ctx(dir));

	assert.equal(res.isError, undefined, "a pattern that will not compile is not an error");
	assert.match(res.content[0].text, /onEvent\(event\) => run/, "the line it names is found");
	assert.equal((res.details as { literal?: boolean }).literal, true);
});

test("a bare quantifier — the glob a model typed by mistake — finds its own text", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));

	const res = await grepTool.execute({ pattern: "*.ts" }, ctx(dir));

	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /const pattern/);
	assert.equal((res.details as { literal?: boolean }).literal, true);
});

test("the fallback is said out loud, so a disarmed pattern is not read as a clean miss", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));

	const res = await grepTool.execute({ pattern: "nowhere(at all" }, ctx(dir));

	assert.equal((res.details as { count: number }).count, 0);
	assert.match(res.content[0].text, /not a valid regular expression/);
	assert.match(res.content[0].text, /searched for literally/);
});

test("a pattern that does compile is still a regular expression", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));

	const res = await grepTool.execute({ pattern: "function\\s+run\\w+" }, ctx(dir));

	assert.match(res.content[0].text, /function runAll/);
	assert.ok(!(res.details as { literal?: boolean }).literal, "nothing was disarmed, so nothing is announced");
});

test("the same holds where ripgrep is not installed and the built-in scanner answers", async (t) => {
	const dir = await workspace();
	// Emptied so `spawn("rg")` cannot resolve, which is exactly what the tool sees on a machine
	// without it — the one route these tests would otherwise never take on a developer's laptop.
	const path = process.env.PATH;
	process.env.PATH = "";
	t.after(() => {
		process.env.PATH = path;
		return rm(dir, { recursive: true, force: true });
	});

	const res = await grepTool.execute({ pattern: "onEvent(event" }, ctx(dir));

	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /onEvent\(event\) => run/);
	assert.equal((res.details as { literal?: boolean }).literal, true);
});

test("a match past the first 2000 characters of a line stays in the result", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));
	const needle = "MID-LINE-NEEDLE-7K2M";
	await writeFile(join(dir, "catalog.json"), `${"a".repeat(80_000)}"id":"${needle}","name":"Keep this"${"b".repeat(80_000)}`);
	const res = await grepTool.execute({ pattern: needle }, ctx(dir));
	const text = res.content.map((part) => part.text).join("");
	assert.ok(text.length < 16_000, `output was ${text.length} characters`);
	assert.match(text, /catalog\.json:1:/);
	assert.match(text, new RegExp(needle));
	assert.match(text, /omitted/);
	assert.match(text, /char_offset=/);
});

test("a regular expression that matches nothing is reported as itself", async (t) => {
	const dir = await workspace();
	t.after(() => rm(dir, { recursive: true, force: true }));

	const res = await grepTool.execute({ pattern: "class\\s+Missing" }, ctx(dir));

	assert.equal((res.details as { count: number }).count, 0);
	assert.match(res.content[0].text, /No matches for \/class\\s\+Missing\/\./);
	assert.doesNotMatch(res.content[0].text, /literally/);
});
