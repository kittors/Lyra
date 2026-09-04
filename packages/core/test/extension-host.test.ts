/**
 * What a badly-behaved extension does to the session hosting it.
 *
 * Every extension here is written to fail in a specific way, because that is the point of the
 * host: none of these should require the extension's author to have done anything right. omp's
 * documentation is explicit that in its design a thrown callback tears the session down — with a
 * plugin registry that cannot be the deal.
 *
 * Real workers throughout. A fake host that resolves promises on a timer would pass all of this
 * while proving nothing about isolation.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ExtensionHost } from "../src/extensions/host.ts";
import { FAILURE_LIMIT, validateManifest } from "../src/extensions/types.ts";

let root: string;

/** Write an extension directory and return its path. */
async function extension(name: string, manifest: Record<string, unknown>, source: string): Promise<string> {
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "extension.json"), JSON.stringify({ name, main: "index.mjs", ...manifest }), "utf8");
	await writeFile(join(dir, "index.mjs"), source, "utf8");
	return dir;
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-ext-"));
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

test("a manifest without a name or an entry is refused", () => {
	assert.ok("error" in validateManifest({ main: "index.mjs" }));
	assert.ok("error" in validateManifest({ name: "x" }));
});

test("an entry path that climbs out of the directory is refused at the manifest, not at load", () => {
	/*
	 * By the time a path is being resolved the decision has been made. The manifest is where
	 * "this extension is asking for something it should not" is still a readable statement.
	 */
	assert.ok("error" in validateManifest({ name: "x", main: "../../../etc/passwd" }));
	assert.ok("error" in validateManifest({ name: "x", main: "/etc/passwd" }));
});

test("an unknown event is refused with the list of real ones", () => {
	const result = validateManifest({ name: "x", main: "i.mjs", events: ["tool_call", "nonsense"] });
	assert.ok("error" in result);
	assert.match(result.error, /tool_call/, "the message says what is available");
});

test("the memory ceiling is clamped rather than trusted", () => {
	const low = validateManifest({ name: "x", main: "i.mjs", memoryLimitMb: 1 });
	const high = validateManifest({ name: "x", main: "i.mjs", memoryLimitMb: 99_999 });
	assert.equal("manifest" in low && low.manifest.memoryLimitMb, 32);
	assert.equal("manifest" in high && high.manifest.memoryLimitMb, 512);
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("an extension sees the events it subscribed to", async () => {
	const dir = await extension(
		"observer",
		{ events: ["tool_call"] },
		`export default { tool_call: (payload) => ({ replace: { seen: payload.toolName } }) };`,
	);
	const host = new ExtensionHost();
	assert.equal(await host.load(dir), true);

	const replies = await host.dispatch("tool_call", { toolName: "bash" });
	assert.equal(replies.length, 1);
	await host.dispose();
});

test("an extension does not see events it did not subscribe to", async () => {
	const dir = await extension("narrow", { events: ["turn_start"] }, `export default { tool_call: () => ({ block: { reason: "不该被调到" } }) };`);
	const host = new ExtensionHost();
	await host.load(dir);

	assert.deepEqual(await host.dispatch("tool_call", {}), []);
	await host.dispose();
});

// ---------------------------------------------------------------------------
// Interception is declared, not assumed
// ---------------------------------------------------------------------------

test("an extension that declared intercepts can stop a call, and says why", async () => {
	const dir = await extension(
		"gatekeeper",
		{ events: ["tool_call"], intercepts: true },
		`export default { tool_call: (p) => (p.toolName === "bash" ? { block: { reason: "这个项目里不允许直接跑命令" } } : {}) };`,
	);
	const host = new ExtensionHost();
	await host.load(dir);

	const stopped = await host.intercept("tool_call", { toolName: "bash" });
	assert.match(stopped.block ?? "", /不允许直接跑命令/, "the reason reaches the model, not just a refusal");

	const allowed = await host.intercept("tool_call", { toolName: "read" });
	assert.equal(allowed.block, undefined);
	await host.dispose();
});

test("an extension that did not declare intercepts cannot block, however it answers", async () => {
	/*
	 * The manifest is the contract shown at install time. An observer that turns out to block
	 * things is the install decision having been about something else.
	 */
	const dir = await extension("sneaky", { events: ["tool_call"] }, `export default { tool_call: () => ({ block: { reason: "拦一下" } }) };`);
	const host = new ExtensionHost();
	await host.load(dir);

	assert.equal((await host.intercept("tool_call", { toolName: "bash" })).block, undefined);
	await host.dispose();
});

// ---------------------------------------------------------------------------
// The three failures
// ---------------------------------------------------------------------------

test("an extension that throws does not take the session with it", async () => {
	const dir = await extension("thrower", { events: ["tool_call"] }, `export default { tool_call: () => { throw new Error("我坏了"); } };`);
	const host = new ExtensionHost();
	await host.load(dir);

	const replies = await host.dispatch("tool_call", {});
	assert.equal(replies.length, 1);
	assert.match(replies[0].error ?? "", /我坏了/);
	await host.dispose();
});

test("an extension that hangs costs a timeout, not the turn", async () => {
	const dir = await extension("hanger", { events: ["tool_call"] }, `export default { tool_call: () => new Promise(() => {}) };`);
	const host = new ExtensionHost();
	await host.load(dir);

	const started = Date.now();
	const replies = await host.dispatch("tool_call", {});
	assert.equal(replies[0].error, "timeout");
	assert.ok(Date.now() - started < 5000, "it gave up rather than waiting forever");
	await host.dispose();
});

test("an extension that fails every time is switched off", async () => {
	/*
	 * Otherwise a broken extension costs a timeout per tool call for the life of the session —
	 * slow in a way nobody would attribute to an extension.
	 */
	const dir = await extension("always-broken", { events: ["tool_call"] }, `export default { tool_call: () => { throw new Error("又坏了"); } };`);
	const host = new ExtensionHost();
	await host.load(dir);

	for (let i = 0; i < FAILURE_LIMIT; i += 1) await host.dispatch("tool_call", {});

	assert.equal(host.isDisabled("always-broken"), true);
	assert.deepEqual(await host.dispatch("tool_call", {}), [], "it is not asked again");
	assert.ok(host.diagnostics.some((d) => /不再调用它/.test(d.message)), "and the reason is recorded");
	await host.dispose();
});

test("one broken extension does not stop a working one", async () => {
	const bad = await extension("bad", { events: ["tool_call"] }, `export default { tool_call: () => { throw new Error("x"); } };`);
	const good = await extension("good", { events: ["tool_call"], intercepts: true }, `export default { tool_call: () => ({ block: { reason: "好的那个说了话" } }) };`);
	const host = new ExtensionHost();
	await host.load(bad);
	await host.load(good);

	const result = await host.intercept("tool_call", {});
	assert.match(result.block ?? "", /好的那个/);
	await host.dispose();
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

test("a directory with no manifest is not an extension, and not an error", async () => {
	const dir = join(root, "empty");
	await mkdir(dir, { recursive: true });
	const host = new ExtensionHost();
	assert.equal(await host.load(dir), false);
	assert.equal(host.diagnostics.length, 0, "an absent manifest is not a complaint");
	await host.dispose();
});

test("a malformed manifest is reported", async () => {
	const dir = join(root, "broken-manifest");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "extension.json"), "{ not json", "utf8");
	const host = new ExtensionHost();

	assert.equal(await host.load(dir), false);
	assert.ok(host.diagnostics.some((d) => /JSON/.test(d.message)));
	await host.dispose();
});

test("dispose stops every worker", async () => {
	const dir = await extension("tidy", { events: ["tool_call"] }, `export default { tool_call: () => ({}) };`);
	const host = new ExtensionHost();
	await host.load(dir);
	assert.deepEqual(host.names(), ["tidy"]);

	await host.dispose();
	assert.deepEqual(await host.dispatch("tool_call", {}), [], "nothing is left listening");
});
