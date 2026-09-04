/**
 * The address space: parsing, routing, the four shipped schemes, and the two boundaries.
 *
 * The boundaries are the reason most of this file exists. One is that a path cannot climb out of
 * the namespace it names — including through a symlink, where the textual path never leaves and
 * the read does. The other is that almost nothing is writable, so a model cannot edit the rule
 * that constrains it by addressing it.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { BUILTIN_RESOURCES } from "../src/resources/handlers.ts";
import { parseResourceUrl, ResourceRouter, resolveInside } from "../src/resources/router.ts";
import type { ResourceContext } from "../src/resources/types.ts";
import { readTool } from "../src/tools/read.ts";
import { writeTool } from "../src/tools/write.ts";
import type { ToolContext } from "../src/types.ts";

let root: string;
let skillDir: string;
let scratchDir: string;
let outside: string;

function router(): ResourceRouter {
	const r = new ResourceRouter();
	for (const handler of BUILTIN_RESOURCES) r.register(handler);
	return r;
}

function state(): Map<string, unknown> {
	return new Map<string, unknown>([
		[
			"skills",
			[
				{
					name: "pdf",
					description: "读 PDF",
					content: "# PDF 技能\n\n第一步。\n第二步。\n第三步。",
					path: join(skillDir, "SKILL.md"),
					dir: skillDir,
					source: "workspace",
					disableModelInvocation: false,
				},
			],
		],
		[
			"rules",
			{
				always: [],
				book: [{ name: "style", content: "用 tab 缩进。", path: "/rules/style.md", bucket: "book", source: "workspace", conditions: [], scopes: [], interrupt: "always", repeat: "once" }],
				stream: [],
				diagnostics: [],
			},
		],
	]);
}

function ctx(): ResourceContext {
	return { cwd: root, sessionId: "s1", scratchDir, state: state() };
}

function toolCtx(): ToolContext {
	return { cwd: root, sessionId: "s1", state: state(), resources: router(), scratchDir } as unknown as ToolContext;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-res-"));
	skillDir = join(root, "skills", "pdf");
	scratchDir = join(root, "scratch");
	outside = join(root, "secret.txt");
	await mkdir(skillDir, { recursive: true });
	await mkdir(scratchDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), "# PDF 技能\n");
	await writeFile(join(skillDir, "template.txt"), "模板内容\n");
	await writeFile(outside, "不该被读到\n");
	await symlink(outside, join(skillDir, "escape.txt")).catch(() => {});
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("an address needs a scheme and `://`", () => {
	assert.equal(parseResourceUrl("skill://pdf")?.scheme, "skill");
	assert.equal(parseResourceUrl("src/app.ts"), null);
	assert.equal(parseResourceUrl("note:todo"), null, "a bare colon is not an address");
});

test("a Windows drive letter is not a scheme", () => {
	/*
	 * The `://` is required for this. A looser pattern captures `C:\Users\me\file.ts`, and the
	 * failure is a path that silently stops resolving on one platform only.
	 */
	assert.equal(parseResourceUrl("C:\\Users\\me\\file.ts"), null);
	assert.equal(parseResourceUrl("C:/Users/me/file.ts"), null);
});

test("a trailing line range is parsed off the path", () => {
	const parsed = parseResourceUrl("skill://pdf:10-40");
	assert.equal(parsed?.path, "pdf");
	assert.deepEqual(parsed?.range, { from: 10, to: 40 });

	const single = parseResourceUrl("skill://pdf:7");
	assert.deepEqual(single?.range, { from: 7, to: undefined });
});

test("segments drop empty parts, so a trailing slash is not a segment", () => {
	assert.deepEqual(parseResourceUrl("skill://pdf/docs/a.md")?.segments, ["pdf", "docs", "a.md"]);
	assert.deepEqual(parseResourceUrl("skill://")?.segments, []);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("an unknown scheme is not claimed, so it can fall through to the filesystem", () => {
	const r = router();
	assert.equal(r.canResolve("skill://pdf"), true);
	assert.equal(r.canResolve("acme://thing"), false);
	assert.equal(r.looksLikeUrl("acme://thing"), true, "it is still recognisably an address");
});

test("registering a scheme twice is refused", () => {
	const r = router();
	assert.throws(() => r.register(BUILTIN_RESOURCES[0]), /already registered/);
});

test("a bare scheme lists what is in it", async () => {
	const listed = await router().resolve("rule://", ctx());
	assert.match(listed.content, /rule:\/\/style/);
});

// ---------------------------------------------------------------------------
// skill://
// ---------------------------------------------------------------------------

test("skill:// returns the body, and a range slices it", async () => {
	const whole = await router().resolve("skill://pdf", ctx());
	assert.match(whole.content, /第一步/);

	const sliced = await router().resolve("skill://pdf:3-3", ctx());
	assert.equal(sliced.content, "第一步。");
});

test("skill://<name>/<path> reads a file from the skill directory", async () => {
	const file = await router().resolve("skill://pdf/template.txt", ctx());
	assert.match(file.content, /模板内容/);
});

test("a path that climbs out of the skill directory is refused", async () => {
	await assert.rejects(() => router().resolve("skill://pdf/../../../etc/passwd", ctx()), /技能目录外面/);
});

test("a symlink out of the skill directory is refused", async () => {
	/*
	 * The textual path never leaves — `escape.txt` is right there in the directory — so the string
	 * check passes and the read would succeed. Only resolving the link catches it.
	 */
	await assert.rejects(() => router().resolve("skill://pdf/escape.txt", ctx()), /软链/);
});

test("an unknown skill names the ones that exist", async () => {
	await assert.rejects(() => router().resolve("skill://nope", ctx()), /现有的是：pdf/);
});

// ---------------------------------------------------------------------------
// rule://
// ---------------------------------------------------------------------------

test("rule:// returns a rule body", async () => {
	const rule = await router().resolve("rule://style", ctx());
	assert.equal(rule.content, "用 tab 缩进。");
	assert.equal(rule.meta?.bucket, "book");
});

// ---------------------------------------------------------------------------
// scratch://
// ---------------------------------------------------------------------------

test("scratch:// round-trips", async () => {
	const r = router();
	await r.write("scratch://notes/a.md", "写下来的内容", ctx());
	const back = await r.resolve("scratch://notes/a.md", ctx());
	assert.equal(back.content, "写下来的内容");
});

test("a scratch path cannot climb out", async () => {
	await assert.rejects(() => router().write("scratch://../escaped.md", "x", ctx()), /临时目录外面/);
});

// ---------------------------------------------------------------------------
// The write boundary
// ---------------------------------------------------------------------------

test("everything except scratch is read-only", async () => {
	const r = router();
	for (const url of ["rule://style", "skill://pdf", "lyra://addresses"]) {
		await assert.rejects(() => r.write(url, "改掉", ctx()), /只读/, `${url} must not be writable`);
	}
});

test("the router reports which schemes are writable", () => {
	const schemes = router().schemes();
	assert.deepEqual(
		schemes.filter((s) => s.writable).map((s) => s.scheme),
		["scratch"],
	);
});

// ---------------------------------------------------------------------------
// lyra://
// ---------------------------------------------------------------------------

test("lyra:// serves its own documentation and lists its topics", async () => {
	const doc = await router().resolve("lyra://writing-rules", ctx());
	assert.match(doc.content, /alwaysApply/, "the doc says what the frontmatter looks like");
	assert.equal(doc.immutable, true);

	const index = await router().resolve("lyra://", ctx());
	assert.match(index.content, /writing-skills/);
});

// ---------------------------------------------------------------------------
// Through the tools
// ---------------------------------------------------------------------------

test("read resolves an address, and matches reading the file directly", async () => {
	const viaAddress = await readTool.execute({ path: "skill://pdf/template.txt" } as never, toolCtx());
	assert.match(textOf(viaAddress), /模板内容/);

	const viaPath = await readTool.execute({ path: join(skillDir, "template.txt") } as never, toolCtx());
	assert.match(textOf(viaPath), /模板内容/);
});

test("read falls through to the filesystem for a scheme nobody owns", async () => {
	const result = await readTool.execute({ path: "acme://thing" } as never, toolCtx());
	assert.ok(result.isError);
	assert.match(textOf(result), /File not found/, "it failed as a path, not as an address");
});

test("write goes to scratch through the tool, and is refused for a rule", async () => {
	const ok = await writeTool.execute({ path: "scratch://from-tool.md", content: "内容" } as never, toolCtx());
	assert.equal(ok.isError, undefined);

	const refused = await writeTool.execute({ path: "rule://style", content: "把规则改掉" } as never, toolCtx());
	assert.ok(refused.isError);
	assert.match(textOf(refused), /只读/);
});

test("a session with no router reads addresses as ordinary paths", async () => {
	const bare = { cwd: root, sessionId: "s", state: new Map() } as unknown as ToolContext;
	const result = await readTool.execute({ path: "skill://pdf" } as never, bare);
	assert.ok(result.isError, "no router means no address space, and it fails as a path would");
});

// ---------------------------------------------------------------------------
// The shared guard
// ---------------------------------------------------------------------------

test("resolveInside uses path.relative rather than string prefixes", () => {
	assert.ok(resolveInside("/a/b", "c/d"));
	assert.equal(resolveInside("/a/b", "../x"), null);
	assert.equal(resolveInside("/a/b", "/etc/passwd"), null, "an absolute path is never inside");
	/*
	 * The case a prefix comparison gets wrong: `/a/bc` starts with the string `/a/b` but is not
	 * under it. `plugins/loader.ts` carries the note from when this was written that way.
	 */
	assert.equal(resolveInside("/a/b", "../bc/d"), null);
});
