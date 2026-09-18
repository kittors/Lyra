import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { grepTool } from "../src/tools/grep.ts";
import { globTool } from "../src/tools/glob.ts";
import { readTool } from "../src/tools/read.ts";
import { symbolTool } from "../src/tools/symbol.ts";

const currentFile = fileURLToPath(import.meta.url);
const testDir = dirname(currentFile);

test("grepTool accepts alias parameters such as query and search", async () => {
	const res = await grepTool.execute({ query: "grepTool", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /grepTool/);
});

test("globTool accepts query and search aliases", async () => {
	const res = await globTool.execute({ query: "*.ts", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /tool-aliases\.test\.ts/);
});

test("readTool accepts file and filePath aliases", async () => {
	const res = await readTool.execute({ file: currentFile, limit: 5 } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /1→import/);
});

test("symbolTool accepts query and symbol aliases", async () => {
	const res = await symbolTool.execute({ query: "grepTool", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
});

test("globTool falls back to extracting pattern from description when pattern is missing", async () => {
	const res = await globTool.execute({ description: "Find security config files (pattern: **/*Security*.java)", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
});

test("globTool extracts quoted pattern or wildcard from description", async () => {
	const res = await globTool.execute({ description: "Find all *.ts files in directory", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /tool-aliases\.test\.ts/);
});

test("grepTool falls back to extracting pattern from description when pattern is missing", async () => {
	const res = await grepTool.execute({ description: "Search for (pattern: grepTool)", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /grepTool/);
});

test("grepTool extracts quoted pattern from description", async () => {
	const res = await grepTool.execute({ description: "Search \"grepTool\" in files", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /grepTool/);
});

test("globTool falls back to raw description when no pattern labels or wildcards exist", async () => {
	const res = await globTool.execute({ description: "tool-aliases.test.ts", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /tool-aliases\.test\.ts/);
});

test("grepTool falls back to raw regex description directly", async () => {
	const res = await grepTool.execute({ description: "grepTool|globTool|readTool", path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /grepTool/);
});

test("grep schema does not require pattern so query-only calls are not rejected upstream", () => {
	const required = (grepTool.parameters as { required?: string[] }).required ?? [];
	assert.equal(required.includes("pattern"), false);
	const globRequired = (globTool.parameters as { required?: string[] }).required ?? [];
	assert.equal(globRequired.includes("pattern"), false);
});

test("grepTool extracts alternation and spaces from a labeled description", async () => {
	const res = await grepTool.execute({ description: 'pattern: "grepTool|globTool"' } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /grepTool/);
});

test("grepTool provides self-healing error message when pattern and description are missing", async () => {
	const res = await grepTool.execute({ path: testDir } as any, { cwd: testDir, sessionId: "s", state: new Map() });
	assert.equal(res.isError, true);
	assert.match(res.content[0].text, /`pattern` is required/);
	assert.match(res.content[0].text, /e\.g\. \{"pattern": "your_regex"\}/);
});
