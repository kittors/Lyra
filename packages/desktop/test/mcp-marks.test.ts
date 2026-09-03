/**
 * Which server a tool call belongs to.
 *
 * The interesting cases are all the same shape: a name built by a function that cannot be undone.
 * `mcp__${sanitize(id)}__${sanitize(tool)}` is written by core, read here, and the two ends only
 * agree because this side never tries to take the name apart — it matches candidates forwards.
 */

import type { McpServerConfig } from "@lyra/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { markFor } from "../src/features/conversation/mcp-marks.ts";

function server(id: string, name = id, bundle?: string): McpServerConfig {
	return {
		id,
		name,
		transport: "stdio",
		command: "node",
		enabled: true,
		...(bundle ? { origin: { bundle } } : {}),
	};
}

test("a tool that is not an MCP call has no server", () => {
	assert.equal(markFor("bash", [server("demo")], {}), null);
	assert.equal(markFor("skill", [server("demo")], {}), null);
	// Not `mcp__`-prefixed, however much it looks like it.
	assert.equal(markFor("mcp_demo__thing", [server("demo")], {}), null);
});

test("the server's own icon is found through the bundle it was installed from", () => {
	const mark = markFor("mcp__demo__echo", [server("demo", "Demo", "demo-mcp")], {
		"demo-mcp": { logo: "data:image/svg+xml;base64,abc", brandColor: "#8b5cf6" },
	});
	assert.deepEqual(mark, { name: "Demo", logo: "data:image/svg+xml;base64,abc", brandColor: "#8b5cf6" });
});

test("an id holding the separator is matched whole, not up to its first __", () => {
	/*
	 * The case this function exists for. Installing Context7 writes the server id
	 * `context7__context7` — bundle id and server key joined — so its tools are named
	 * `mcp__context7__context7__get-library-docs`. Anything that split on `__` would read the
	 * server as `context7`, find no such server, and drop the icon for every call it makes.
	 */
	const mark = markFor(
		"mcp__context7__context7__get-library-docs",
		[server("context7__context7", "context7", "context7")],
		{ context7: { brandColor: "#8b5cf6" } },
	);
	assert.equal(mark?.name, "context7");
	assert.equal(mark?.brandColor, "#8b5cf6");
});

test("when one id is a prefix of another, the longer one wins", () => {
	/*
	 * Both prefixes match, and the shorter is not merely less precise — it is a different server,
	 * so taking it would draw one product's logo on another product's call.
	 */
	const servers = [server("github", "GitHub", "gh"), server("github__enterprise", "GHE", "ghe")];
	assert.equal(markFor("mcp__github__enterprise__search", servers, {})?.name, "GHE");
	assert.equal(markFor("mcp__github__search", servers, {})?.name, "GitHub");

	// And the order they are configured in does not decide it.
	assert.equal(markFor("mcp__github__enterprise__search", [...servers].reverse(), {})?.name, "GHE");
});

test("characters a name cannot carry are matched as the underscores they became", () => {
	// `sanitize` turns everything outside [A-Za-z0-9_-] into `_`, so the id in the tool name is not
	// the id in settings, and only the forward direction can connect them.
	const mark = markFor("mcp__my_server_1__run", [server("my.server 1", "My Server", "mine")], {
		mine: { brandColor: "#0ea5e9" },
	});
	assert.equal(mark?.name, "My Server");
	assert.equal(mark?.brandColor, "#0ea5e9");
});

test("a call from a server that is gone is still an MCP call", () => {
	/*
	 * Every transcript that outlives an uninstall has these. Returning null would fall through to
	 * the terminal glyph, which would redraw an old conversation's MCP calls as shell commands.
	 */
	const mark = markFor("mcp__removed__thing", [], {});
	assert.deepEqual(mark, { name: "MCP" });
});

test("a server with no bundle behind it has a name and no picture", () => {
	// Typed in by hand on the MCP settings page: there is no directory to have shipped an icon.
	assert.deepEqual(markFor("mcp__local__ping", [server("local", "Local")], {}), {
		name: "Local",
		logo: undefined,
		brandColor: undefined,
	});
});
