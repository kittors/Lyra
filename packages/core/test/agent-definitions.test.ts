import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { AgentDefinitionStore } from "../src/agents/definition-store.ts";
import { renderAgentDocument, type AgentDraft } from "../src/agents/definition-document.ts";
import { asWindows, refuseRenames } from "./held-open.ts";

const draft: AgentDraft = { name: "qa-agent", description: "Inspect code", systemPrompt: "Read before acting.", tools: ["read"] };
async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "lyra-agent-definitions-"));
	const home = join(root, "home"), cwd = join(root, "project");
	await mkdir(home); await mkdir(cwd);
	const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
	process.env.HOME = root; process.env.USERPROFILE = root;
	t.after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
	return { home, cwd, store: new AgentDefinitionStore(home) };
}

test("create without a session, reject duplicates and stale edits, and persist across registry reload", async t => {
	const { store, home } = await fixture(t);
	await store.save(null, { scope: "user", draft }, ["read"]);
	const record = (await store.list(null)).find(item => item.definition.name === draft.name); assert.ok(record);
	await assert.rejects(store.save(null, { scope: "user", draft }, ["read"]), /已存在/);
	await writeFile(join(home, "agents", `${draft.name}.md`), record.raw + "External edit\n");
	await assert.rejects(store.save(null, { id: record.id, revision: record.revision, scope: "user", draft }, ["read"]), /已被修改/);
	assert.match(await readFile(join(home, "agents", `${draft.name}.md`), "utf8"), /External edit/);
	assert.equal((await new AgentDefinitionStore(home).read(null, record.id)).definition.name, draft.name);
});

test("builtin overrides preserve advanced metadata, can be copied and restored with undo", async t => {
	const { store } = await fixture(t);
	const builtin = (await store.list(null)).find(item => item.scope === "builtin"); assert.ok(builtin);
	const edited = { ...draft, name: builtin.definition.name, tools: builtin.definition.tools, systemPrompt: "Custom instructions" };
	await store.save(null, { id: builtin.id, revision: builtin.revision, scope: "user", draft: edited }, []);
	const custom = (await store.list(null)).find(item => item.definition.name === edited.name); assert.ok(custom);
	assert.equal(custom.customized, true); assert.equal(custom.scope, "user");
	for (const key of ["output", "schemaMode", "spawns"] as const) assert.deepEqual(custom.definition[key], builtin.definition[key]);
	await store.save(null, { copyFrom: custom.id, scope: "user", draft: { ...edited, name: "qa-copy" } }, []);
	const copy = (await store.list(null)).find(item => item.definition.name === "qa-copy"); assert.ok(copy);
	assert.equal(copy.definition.systemPrompt.trim(), "Custom instructions");
	const token = await store.remove(null, custom.id, custom.revision);
	assert.equal((await store.list(null)).find(item => item.definition.name === edited.name)?.scope, "builtin");
	await store.restore(null, token);
	assert.equal((await store.read(null, custom.id)).raw, custom.raw);
});

test("project scope, serialized creation, and undo collision never overwrite another definition", async t => {
	const { store, cwd } = await fixture(t);
	await assert.rejects(store.save(null, { scope: "project", draft }, ["read"]), /选择项目/);
	const results = await Promise.allSettled([store.save(cwd, { scope: "project", draft }, ["read"]), store.save(cwd, { scope: "project", draft }, ["read"])]);
	assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
	assert.equal((await store.list(null)).some(item => item.definition.name === draft.name), false);
	const record = (await store.list(cwd)).find(item => item.definition.name === draft.name); assert.ok(record);
	const token = await store.remove(cwd, record.id, record.revision);
	await assert.rejects(store.restore(null, token), /不存在/);
	await store.save(cwd, { scope: "project", draft: { ...draft, systemPrompt: "Replacement" } }, ["read"]);
	await assert.rejects(store.restore(cwd, token), /EEXIST/);
	assert.equal((await store.read(cwd, record.id)).definition.systemPrompt.trim(), "Replacement");
});

test("path traversal, unknown tools and symbolic link destinations are rejected", async t => {
	const { store, home, cwd } = await fixture(t);
	await assert.rejects(store.save(null, { scope: "user", draft: { ...draft, name: "../escape" } }, ["read"]), /调用名/);
	await assert.rejects(store.save(null, { scope: "user", draft: { ...draft, tools: ["unknown"] } }, ["read"]), /不可用/);
	await symlink(cwd, join(home, "agents"), process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(store.save(null, { scope: "user", draft }, ["read"]), /符号链接/);
});

// Saved twice in a row, the second save lands on a file a Windows scanner is still reading.
test("on Windows a save refused for a moment is retried rather than failed", async t => {
	const { store } = await fixture(t);
	await store.save(null, { scope: "user", draft }, ["read"]);
	const record = (await store.list(null)).find(item => item.definition.name === draft.name); assert.ok(record);
	asWindows(t);
	const { refused } = refuseRenames(t, `${draft.name}.md`, "EPERM", 2);
	await store.save(null, { id: record.id, revision: record.revision, scope: "user", draft: { ...draft, systemPrompt: "Saved again." } }, ["read"]);
	assert.equal(refused(), 2, "the premise: the first two renames were refused");
	const saved = (await store.list(null)).find(item => item.definition.name === draft.name); assert.ok(saved);
	assert.match(saved.raw, /Saved again\./);
});

test("on Windows a removal refused for a moment is retried rather than failed", async t => {
	const { store } = await fixture(t);
	await store.save(null, { scope: "user", draft }, ["read"]);
	const record = (await store.list(null)).find(item => item.definition.name === draft.name); assert.ok(record);
	asWindows(t);
	// Removing moves the file aside under a name made up on the spot; refuse whatever that is.
	const { refused } = refuseRenames(t, /\.deleted$/, "EBUSY", 2);
	await store.remove(null, record.id, record.revision);
	assert.equal(refused(), 2, "the premise: the first two renames were refused");
	assert.equal((await store.list(null)).some(item => item.definition.name === draft.name), false);
});

test("editing YAML preserves unknown nested metadata and rejects malformed documents", () => {
	const raw = "---\nname: qa-agent\ncustom:\n  nested: [a, b]\n# preserve this note\nmodel: fast\n---\nOld prompt\n";
	const rendered = renderAgentDocument(draft, raw);
	assert.match(rendered, /nested: \[\s*a, b\s*\]/); assert.match(rendered, /# preserve this note/); assert.match(rendered, /model: fast/);
	assert.match(rendered, /Read before acting/);
	assert.throws(() => renderAgentDocument(draft, "broken"), /YAML/);
});
