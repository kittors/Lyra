/**
 * What an MCP server's input schema becomes before it is sent as a tool's parameters.
 *
 * The bug this pins down: a server declared `machineIds: { type: "array" }` with no `items`, and a
 * relay forwarding to Gemini refused every request of every session, because the whole tool list
 * goes out each turn.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { McpManager } from "../src/mcp/client.ts";
import { normalizeInputSchema } from "../src/mcp/schema.ts";

test("an array argument with no items gets the any-element schema", () => {
	const schema = normalizeInputSchema({ type: "object", properties: { machineIds: { type: "array", description: "Target machines" } } });
	assert.deepEqual(schema, { type: "object", properties: { machineIds: { type: "array", description: "Target machines", items: {} } } });
});

test("declared items are left exactly as they were", () => {
	const input = { type: "object", properties: { tags: { type: "array", items: { type: "string", enum: ["a", "b"] } }, pairs: { type: "array", items: [{ type: "string" }, { type: "number" }] } } };
	assert.deepEqual(normalizeInputSchema(input), input);
});

test("arrays are filled wherever a schema can nest", () => {
	const bare = { type: "array" };
	const filled = { type: "array", items: {} };
	const schema = normalizeInputSchema({
		type: "object",
		properties: {
			grid: { type: "array", items: bare },
			nullable: { type: ["array", "null"] },
			either: { anyOf: [bare, { type: "string" }] },
			one: { oneOf: [bare] },
			all: { allOf: [bare] },
			not: { not: bare },
			tuple: { type: "array", prefixItems: [bare], items: false },
			map: { type: "object", additionalProperties: bare },
			patterned: { type: "object", patternProperties: { "^x": bare } },
		},
		$defs: { batch: bare },
		definitions: { legacy: bare },
	}) as Record<string, any>;
	const p = schema.properties;
	assert.deepEqual(p.grid, { type: "array", items: filled });
	assert.deepEqual(p.nullable, { type: ["array", "null"], items: {} });
	assert.deepEqual(p.either.anyOf[0], filled);
	assert.deepEqual(p.one.oneOf[0], filled);
	assert.deepEqual(p.all.allOf[0], filled);
	assert.deepEqual(p.not.not, filled);
	assert.deepEqual(p.tuple, { type: "array", prefixItems: [filled], items: false });
	assert.deepEqual(p.map.additionalProperties, filled);
	assert.deepEqual(p.patterned.patternProperties["^x"], filled);
	assert.deepEqual(schema.$defs.batch, filled);
	assert.deepEqual(schema.definitions.legacy, filled);
});

test("a property named items or type is a property, not a keyword", () => {
	const schema = normalizeInputSchema({ type: "object", properties: { items: { type: "string" }, type: { type: "array" } } });
	assert.deepEqual(schema, { type: "object", properties: { items: { type: "string" }, type: { type: "array", items: {} } } });
});

test("the server's own schema object is not modified", () => {
	const input = { type: "object", properties: { ids: { type: "array" }, nested: { type: "object", properties: { more: { type: "array" } } } } };
	const before = structuredClone(input);
	normalizeInputSchema(input);
	assert.deepEqual(input, before);
});

test("a subschema used in two places is filled in both", () => {
	const shared = { type: "array" };
	const schema = normalizeInputSchema({ type: "object", properties: { a: shared, b: shared } }) as Record<string, any>;
	assert.deepEqual(schema.properties.a, { type: "array", items: {} });
	assert.deepEqual(schema.properties.b, { type: "array", items: {} });
});

test("a missing or non-object schema still becomes an empty object schema", () => {
	const empty = { type: "object", properties: {}, additionalProperties: true };
	for (const input of [undefined, null, "schema", [], { type: "array" }, { properties: {} }]) assert.deepEqual(normalizeInputSchema(input), empty);
});

/** A stdio MCP server publishing one tool whose array argument declares no items. */
const SERVER = `
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const tool = { name: "batch_run", description: "Run a command on machines.", inputSchema: { type: "object", properties: { machineIds: { type: "array", description: "Target machines" }, command: { type: "string" } }, required: ["command"] } };
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let end;
	while ((end = buffer.indexOf("\\n")) !== -1) {
		const line = buffer.slice(0, end);
		buffer = buffer.slice(end + 1);
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.id === undefined) continue;
		if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "batch", version: "0" } } });
		else if (message.method === "tools/list") send({ id: message.id, result: { tools: [tool] } });
		else send({ id: message.id, error: { code: -32601, message: "no such method" } });
	}
});
process.stdin.on("end", () => process.exit(0));
`;

test("tools from a real stdio server carry the filled schema", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "lyra-mcp-schema-"));
	const script = join(dir, "server.cjs");
	await writeFile(script, SERVER);
	const manager = new McpManager();
	t.after(async () => {
		await manager.closeAll();
		await rm(dir, { recursive: true, force: true });
	});

	await manager.connect({ id: "batch", name: "batch", transport: "stdio", command: process.execPath, args: [script], enabled: true });
	const tool = manager.allTools().find((candidate) => candidate.name === "mcp__batch__batch_run");
	assert.ok(tool, "the server's tool was not exposed");
	assert.deepEqual(tool.parameters.properties?.machineIds, { type: "array", description: "Target machines", items: {} });
	assert.deepEqual(tool.parameters.properties?.command, { type: "string" });
});
