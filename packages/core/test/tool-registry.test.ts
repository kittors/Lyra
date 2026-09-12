/**
 * That every tool written is a tool the model is told about.
 *
 * The defect this exists for: the kernel's tools plugin registered four groups, `tools/index.ts`
 * kept a flat list beside them, and `rule`, `recall`, `learn`, `lsp` and `web_search` were only in
 * the flat one. The desktop binds the kernel registry, so on the desktop those five did not exist.
 * They type-checked, they had tests, they were shipped — and 23,000 tool calls of real session logs
 * contain not one of them. Nothing compared the two lists.
 *
 * So the assertion is not "the two lists agree" (they now read the same constant, which makes that
 * true by construction and therefore worthless). It is against the source tree: every `*Tool`
 * exported under `src/tools/` has to reach the registry. Forgetting to register the next one fails
 * here rather than in a year of nobody noticing.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createContext } from "../src/kernel/index.ts";
import { TOOLS, type ToolRegistry } from "../src/kernel/services.ts";
import { builtinTools, staticTools } from "../src/tools/index.ts";

const srcDir = join(fileURLToPath(new URL("../src", import.meta.url)));

/**
 * The tool names declared in the source, found by reading it rather than by importing it.
 *
 * Reading keeps the check honest: an import list is the very thing that went stale, so a test that
 * imports what it checks would have passed throughout. Files are walked with `node:fs` rather than
 * a shell so this behaves the same on Windows.
 */
function declaredToolNames(): Map<string, string> {
	const found = new Map<string, string>();
	// `skills/tool.ts` is a tool that happens not to live in `tools/`; it is in the registry too.
	const files = [
		...readdirSync(join(srcDir, "tools"))
			.filter((name) => name.endsWith(".ts"))
			.map((name) => join(srcDir, "tools", name)),
		join(srcDir, "skills", "tool.ts"),
	];
	for (const path of files) {
		const text = readFileSync(path, "utf8");
		for (const match of text.matchAll(/export const (\w+Tool)\s*:\s*Tool</g)) {
			const declaration = text.slice(match.index);
			const name = /\bname:\s*"([^"]+)"/.exec(declaration);
			assert.ok(name, `${match[1]} in ${path} has no name literal`);
			found.set(name[1], match[1]);
		}
	}
	return found;
}

test("every tool in the source reaches the static list", () => {
	const declared = declaredToolNames();
	// A guard on the guard: if the scan stops finding tools, it must fail rather than pass empty.
	assert.ok(declared.size >= 20, `expected at least 20 declared tools, found ${declared.size}`);

	const listed = new Set(staticTools().map((tool) => tool.name));
	const missing = [...declared.keys()].filter((name) => !listed.has(name));
	assert.deepEqual(missing, [], `written but never advertised: ${missing.map((n) => declared.get(n)).join(", ")}`);
});

test("the kernel registry advertises the same tools as the static list", async () => {
	const ctx = await createContext();
	try {
		const registered = ctx.require<ToolRegistry>(TOOLS).all().map((tool) => tool.name);
		assert.deepEqual([...registered].sort(), staticTools().map((tool) => tool.name).sort());
	} finally {
		await ctx.dispose();
	}
});

test("the five tools the desktop used to be missing are in the registry", async () => {
	/*
	 * Named individually on purpose. A set comparison passes the moment both sides are wrong the
	 * same way, and these five are the ones that were actually lost — `recall` is how compacted
	 * history is retrieved, `learn` is where project memory comes from, and the settings pages for
	 * both were drawn and reachable the whole time.
	 */
	const ctx = await createContext();
	try {
		const registry = ctx.require<ToolRegistry>(TOOLS);
		for (const name of ["rule", "recall", "learn", "lsp", "web_search"]) {
			assert.ok(registry.byName(name), `${name} is not registered`);
		}
	} finally {
		await ctx.dispose();
	}
});

test("a bound registry is what builtinTools reads, and it can displace a built-in", async () => {
	const ctx = await createContext();
	try {
		const registry = ctx.require<ToolRegistry>(TOOLS);
		const replacement = { name: "bash", description: "not the real one", parameters: {}, run: async () => ({ content: [] }) };
		const remove = registry.register([replacement as never]);
		const { useToolRegistry } = await import("../src/tools/index.ts");
		useToolRegistry(registry);
		try {
			assert.equal(builtinTools().find((tool) => tool.name === "bash")?.description, "not the real one");
		} finally {
			useToolRegistry(null);
			remove();
		}
	} finally {
		await ctx.dispose();
	}
});
