/**
 * Layered configuration: how a project file combines with the global one, and what it may not say.
 *
 * Two rules carry the weight. Arrays replace rather than append — the choice people trip over, and
 * still the right one. And a project file cannot carry credentials, because that file is checked
 * into the repository and a credential in it is a published credential.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadProjectLayer, mergeLayer, PROJECT_FORBIDDEN, projectConfigPath, readConfigFile, sanitizeProjectConfig } from "../src/config/layers.ts";

let root: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-cfg-"));
	await mkdir(join(root, "good", ".lyra"), { recursive: true });
	await mkdir(join(root, "broken", ".lyra"), { recursive: true });
	await mkdir(join(root, "sneaky", ".lyra"), { recursive: true });
	await writeFile(projectConfigPath(join(root, "good")), JSON.stringify({ defaultModelId: "p/cheap", approval: { bash: "allow" } }), "utf8");
	await writeFile(projectConfigPath(join(root, "broken")), '{ "defaultModelId": "p/x", }', "utf8");
	await writeFile(projectConfigPath(join(root, "sneaky")), JSON.stringify({ defaultModelId: "p/x", providers: [{ apiKey: "sk-real" }] }), "utf8");
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

test("objects deepen", () => {
	const merged = mergeLayer({ approval: { bash: "prompt", read: "allow" } }, { approval: { bash: "allow" } });
	assert.deepEqual(merged, { approval: { bash: "allow", read: "allow" } }, "`read` survives from the layer below");
});

test("arrays replace, they do not append", () => {
	/*
	 * The surprising one, and still correct: with append semantics there is no way to express
	 * removing an entry, so a project could only ever add to a global list.
	 */
	const merged = mergeLayer({ disabledRules: ["no-force-push"] }, { disabledRules: ["verify-before-yield"] });
	assert.deepEqual(merged.disabledRules, ["verify-before-yield"]);
});

test("scalars replace", () => {
	assert.equal(mergeLayer({ maxConcurrentSubAgents: 4 }, { maxConcurrentSubAgents: 2 }).maxConcurrentSubAgents, 2);
});

test("an explicit undefined does not erase the layer below", () => {
	/*
	 * `JSON.parse` never produces `undefined`, but a caller assembling a layer in code can, and
	 * "this key is absent" must not read as "set this key to nothing".
	 */
	assert.equal(mergeLayer({ theme: "dark" }, { theme: undefined }).theme, "dark");
});

test("null does replace — it is a value somebody wrote", () => {
	assert.equal(mergeLayer({ theme: "dark" }, { theme: null }).theme, null);
});

// ---------------------------------------------------------------------------
// What a project file may not carry
// ---------------------------------------------------------------------------

test("credentials are refused, not merged with a warning", () => {
	/*
	 * A warning during load is not read, and the value would apply — a working session with a
	 * shared credential in it is exactly the mistake nobody catches.
	 */
	const { config, refused } = sanitizeProjectConfig({ defaultModelId: "p/x", providers: [{ apiKey: "sk-real" }] });
	assert.deepEqual(Object.keys(config), ["defaultModelId"]);
	assert.deepEqual(refused, ["providers"]);
});

test("every forbidden key is actually enforced", () => {
	const attempt = Object.fromEntries(PROJECT_FORBIDDEN.map((key) => [key, "x"]));
	const { config, refused } = sanitizeProjectConfig({ ...attempt, allowed: 1 });
	assert.deepEqual(Object.keys(config), ["allowed"]);
	assert.equal(refused.length, PROJECT_FORBIDDEN.length);
});

// ---------------------------------------------------------------------------
// Reading from disk
// ---------------------------------------------------------------------------

test("a project with a config file contributes it", async () => {
	const { config, error } = await loadProjectLayer(join(root, "good"));
	assert.equal(error, undefined);
	assert.equal(config.defaultModelId, "p/cheap");
});

test("no config file is not an error", async () => {
	const { config, error } = await loadProjectLayer(join(root, "does-not-exist"));
	assert.deepEqual(config, {});
	assert.equal(error, undefined);
});

test("a malformed file is reported and the session still starts", async () => {
	/*
	 * Someone mid-edit with a trailing comma should get their global settings and a message, not a
	 * window that will not open.
	 */
	const { config, error } = await loadProjectLayer(join(root, "broken"));
	assert.deepEqual(config, {});
	assert.ok(error);
	assert.match(error, /JSON/);
});

test("a credential in a project file on disk never reaches the merged config", async () => {
	const { config, refused } = await loadProjectLayer(join(root, "sneaky"));
	assert.equal(config.providers, undefined);
	assert.equal(config.defaultModelId, "p/x", "the rest of the file still applies");
	assert.deepEqual(refused, ["providers"]);
});

test("a file that parses to something other than an object is reported", async () => {
	await writeFile(projectConfigPath(join(root, "good")), "[1,2,3]", "utf8");
	const { error } = await readConfigFile(projectConfigPath(join(root, "good")));
	assert.match(error ?? "", /不是一个对象/);
});
