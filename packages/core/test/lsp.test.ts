/**
 * Code intelligence, and specifically what happens when there is none.
 *
 * The exact path needs a language server and a built program, so it is measured in
 * `test/tool-eval/lsp-eval.ts` against a real `tsserver`. What belongs here is everything that
 * must hold when the server is absent, slow or broken — which is the common case, and the one
 * where a wrong answer is most expensive:
 *
 *   The tool still answers. A missing server must degrade, not fail.
 *   The answer says it is textual. "Found 6" and "text search found 6" are different claims.
 *   A rename is refused outright, because a textual rename is the exact failure this layer exists
 *   to prevent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { textualReferences, TEXTUAL_CAVEAT } from "../src/lsp/fallback.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../src/lsp/manager.ts";
import type { CodeIntelBackend } from "../src/lsp/types.ts";
import { lspTool } from "../src/tools/lsp.ts";
import type { ToolContext } from "../src/types.ts";

let root: string;

/** A context with no backends at all, which is what most projects look like. */
function bareCtx(): ToolContext {
	return {
		cwd: root,
		sessionId: "s",
		state: new Map<string, unknown>([[CODE_INTEL_KEY, new CodeIntelManager([])]]),
	} as unknown as ToolContext;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((c) => c.text ?? "").join("");
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-lsp-"));
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src", "core.ts"), "export function parseConfig(text: string): object {\n\treturn JSON.parse(text);\n}\n", "utf8");
	await writeFile(join(root, "src", "aliased.ts"), 'import { parseConfig as pc } from "./core.ts";\n\nexport function load(t: string) {\n\treturn pc(t);\n}\n', "utf8");
	await writeFile(join(root, "src", "commented.ts"), "// parseConfig is mentioned here but not called\nexport const x = 1;\n", "utf8");
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

test("a textual search finds the plain occurrences", async () => {
	const found = await textualReferences([join(root, "src", "core.ts"), join(root, "src", "aliased.ts")], "parseConfig", root);
	assert.equal(found.length, 2, "the declaration and the import");
	assert.ok(found.every((f) => !f.path.startsWith("/")), "paths come back relative to the workspace");
});

test("a textual search cannot see the aliased callsite — which is the whole problem", async () => {
	/*
	 * `return pc(t)` contains no occurrence of `parseConfig`. This assertion is not testing our
	 * code so much as pinning the limitation the caveat has to describe: if this ever starts
	 * passing, the caveat is lying and should be rewritten.
	 */
	const found = await textualReferences([join(root, "src", "aliased.ts")], "parseConfig", root);
	assert.ok(!found.some((f) => f.line === 4), "line 4 is `return pc(t)` and text search cannot reach it");
});

test("comment-only lines are skipped, so a rename driven by this does not edit prose", async () => {
	const found = await textualReferences([join(root, "src", "commented.ts")], "parseConfig", root);
	assert.equal(found.length, 0);
});

// ---------------------------------------------------------------------------
// Degrading
// ---------------------------------------------------------------------------

test("with no backend, references still answers", async () => {
	const result = await lspTool.execute({ operation: "references", path: "src/core.ts", symbol: "parseConfig" } as never, bareCtx());
	assert.equal(result.isError, undefined);
	assert.match(textOf(result), /文本搜索找到/);
});

test("and the answer names what a text search cannot see", async () => {
	/*
	 * The dangerous outcome is not a missing answer, it is a partial one presented as complete. The
	 * caveat is the difference between the model checking and the model proceeding.
	 */
	const result = await lspTool.execute({ operation: "references", path: "src/core.ts", symbol: "parseConfig" } as never, bareCtx());
	assert.match(textOf(result), /别名导入/);
	assert.match(textOf(result), /重导出/);
	assert.equal((result.details as { confidence?: string }).confidence, "textual");
});

test("the caveat is one string, so it cannot drift between call sites", () => {
	assert.match(TEXTUAL_CAVEAT, /别名导入/);
	assert.match(TEXTUAL_CAVEAT, /重导出/);
});

test("rename with no backend is refused rather than approximated", async () => {
	/*
	 * A textual rename is precisely the operation this layer exists to prevent: it edits every line
	 * it found, looks complete, and leaves the aliased callsite pointing at a name that no longer
	 * exists. Doing it "best effort" would be doing the bug on purpose.
	 */
	const result = await lspTool.execute(
		{ operation: "rename", path: "src/core.ts", symbol: "parseConfig", newName: "parseSettings" } as never,
		bareCtx(),
	);
	assert.ok(result.isError);
	assert.match(textOf(result), /漏掉别名导入/);
	assert.match(textOf(result), /lsp references/, "and it says what to do instead");
});

test("diagnostics with no backend says so instead of inventing something", async () => {
	const result = await lspTool.execute({ operation: "diagnostics", path: "src/core.ts" } as never, bareCtx());
	assert.equal(result.isError, undefined);
	assert.match(textOf(result), /没有可用的语言服务器/);
});

// ---------------------------------------------------------------------------
// Routing and lifecycle
// ---------------------------------------------------------------------------

test("a file type nobody handles gets no backend", async () => {
	const manager = new CodeIntelManager([]);
	assert.equal(manager.backendFor("a.rs"), null);
	assert.equal(await manager.acquire(join(root, "a.rs"), root), null);
});

test("a backend whose binary is missing is not an error, just an absence", async () => {
	/*
	 * The default server table will eventually list rust-analyzer, gopls and friends. A user who
	 * has none of them installed must get a working degraded tool, not a warning per language.
	 */
	const missing: CodeIntelBackend = {
		name: "ghost",
		extensions: [".ts"],
		available: async () => false,
		start: async () => {
			throw new Error("must not be started");
		},
		ready: () => false,
		references: async () => [],
		definition: async () => [],
		diagnostics: async () => [],
		rename: async () => [],
		dispose: async () => {},
	};
	const manager = new CodeIntelManager([missing]);
	assert.equal(await manager.acquire(join(root, "src", "core.ts"), root), null);
});

test("a backend that throws on start degrades rather than propagating", async () => {
	const broken: CodeIntelBackend = {
		name: "broken",
		extensions: [".ts"],
		available: async () => true,
		start: async () => {
			throw new Error("boom");
		},
		ready: () => false,
		references: async () => [],
		definition: async () => [],
		diagnostics: async () => [],
		rename: async () => [],
		dispose: async () => {},
	};
	const manager = new CodeIntelManager([broken]);
	assert.equal(await manager.acquire(join(root, "src", "core.ts"), root), null, "a broken server is the same as no server");
});

test("dispose reaches every backend", async () => {
	let disposed = 0;
	const backend = (ext: string): CodeIntelBackend => ({
		name: ext,
		extensions: [ext],
		available: async () => true,
		start: async () => {},
		ready: () => true,
		references: async () => [],
		definition: async () => [],
		diagnostics: async () => [],
		rename: async () => [],
		dispose: async () => {
			disposed += 1;
		},
	});
	await new CodeIntelManager([backend(".ts"), backend(".go")]).dispose();
	assert.equal(disposed, 2, "a language server left running is hundreds of megabytes");
});

test("an unknown symbol is refused with advice rather than an empty list", async () => {
	const result = await lspTool.execute({ operation: "references", path: "src/core.ts", symbol: "notAThing" } as never, bareCtx());
	assert.ok(result.isError);
	assert.match(textOf(result), /找不到符号/);
});
