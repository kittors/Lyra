/**
 * What an MCP server's `inputSchema` is turned into before it becomes a tool's parameters.
 *
 * Servers write these for their own validator, and every provider accepts a different subset of
 * JSON Schema. The tool list goes out with every request, so one schema a provider refuses fails
 * every turn of every session — and the user does not connect that to the server they installed.
 * Provider-specific trimming lives with each adapter (`normalizeToolSchema` for Anthropic); what is
 * here is safe for all of them.
 */

import type { JsonSchema } from "../types.ts";

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Keywords whose value is a schema or a list of schemas. */
const SUBSCHEMAS = ["items", "prefixItems", "additionalProperties", "anyOf", "oneOf", "allOf", "not"] as const;
/** Keywords whose value maps names to schemas. */
const SUBSCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions"] as const;

/** A missing or non-object schema becomes an empty object one; the providers require an object schema. */
export function normalizeInputSchema(schema: unknown): JsonSchema {
	if (isPlainObject(schema) && schema.type === "object") return fillArrayItems(schema, new WeakMap()) as JsonSchema;
	return { type: "object", properties: {}, additionalProperties: true };
}

/*
 * An array that declares no `items` gets `items: {}`.
 *
 * JSON Schema allows the bare `{"type":"array"}`, meaning any element, and MCP servers emit it
 * often. Gemini's function declarations do not: through a relay that sends the protobuf
 * `parameters` field (CliRelay's Antigravity channel, for one) a single such argument fails the
 * request with "...parameters.properties[machineIds].items: missing field." `{}` is the schema
 * that accepts any value, so nothing changes for the providers that took the bare form.
 *
 * Not `{"type":"string"}`, which CLIProxyAPI fills in: that tells the model an array of objects
 * is an array of strings.
 *
 * Copies rather than edits: the parsed `tools/list` response belongs to the SDK.
 */
function fillArrayItems(schema: unknown, seen: WeakMap<object, unknown>): unknown {
	if (!isPlainObject(schema)) return schema;
	const already = seen.get(schema);
	if (already !== undefined) return already;
	const result: Record<string, unknown> = { ...schema };
	seen.set(schema, result);

	const visit = (value: unknown): unknown => (Array.isArray(value) ? value.map((child) => fillArrayItems(child, seen)) : fillArrayItems(value, seen));
	for (const key of SUBSCHEMAS) if (result[key] !== undefined) result[key] = visit(result[key]);
	for (const key of SUBSCHEMA_MAPS) {
		const children = result[key];
		if (isPlainObject(children)) result[key] = Object.fromEntries(Object.entries(children).map(([name, child]) => [name, fillArrayItems(child, seen)]));
	}

	const type = result.type;
	const isArray = type === "array" || (Array.isArray(type) && type.includes("array"));
	if (isArray && result.items === undefined) result.items = {};
	return result;
}
