/**
 * Which MCP server a tool call came from.
 *
 * A run of `mcp__context7__context7__get-library-docs` in the transcript used to draw the same
 * globe as every other MCP call and as `web_fetch` — so a conversation that touched three servers
 * showed three identical rows, and the only part of a tool run a person reads without reading was
 * saying nothing.
 *
 * The lookup is the whole difficulty and the reason it is a pure function with tests of its own.
 * Names are built as `mcp__${sanitize(server.id)}__${sanitize(tool)}` and `sanitize` is not
 * reversible, so the only sound direction is forwards: sanitise every configured id and ask which
 * prefix the tool name starts with. Splitting on `__` would be wrong for the ids this app actually
 * writes — installing Context7 produces the server id `context7__context7`, whose tools are named
 * `mcp__context7__context7__…`, and the first `__` lands in the middle of the id.
 *
 * Kept free of React and of `window.lyra` so a test can call it. The wiring is in `useMcpMark.ts`.
 */

import type { McpServerConfig } from "@lyra/core";

export const MCP_PREFIX = "mcp__";

/** What a row needs to draw a server: its picture, or failing that its colour and name. */
export interface McpMark {
	/** The server's name, for the accessible label on the mark. */
	name: string;
	/** A data URL from the bundle this server came from, when it shipped an icon. */
	logo?: string;
	brandColor?: string;
}

/** The picture and colour a bundle supplies, by the directory name its servers are stamped with. */
export type BundleMarks = Record<string, { logo?: string; brandColor?: string }>;

/** Same rule as `sanitize` in core's MCP client — anything else becomes an underscore. */
function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * The server a tool name belongs to, and how to draw it.
 *
 * Longest match wins. Two servers whose sanitised ids are prefixes of one another — `github` and
 * `github__enterprise` — both match a tool of the longer one, and the shorter is the wrong answer:
 * it would put one server's icon on another server's call.
 */
export function markFor(toolName: string, servers: McpServerConfig[], bundles: BundleMarks): McpMark | null {
	if (!toolName.startsWith(MCP_PREFIX)) return null;

	let best: McpServerConfig | null = null;
	for (const server of servers) {
		const prefix = `${MCP_PREFIX}${sanitize(server.id)}__`;
		if (!toolName.startsWith(prefix)) continue;
		if (!best || server.id.length > best.id.length) best = server;
	}
	/*
	 * A call from a server that is no longer configured.
	 *
	 * It happens to every transcript that outlives an uninstall, and the row still has to say what
	 * kind of thing it was — the alternative is that reading an old conversation turns its MCP calls
	 * into shell commands, which is what the terminal fallback would do.
	 */
	if (!best) return { name: "MCP" };

	const bundle = best.origin?.bundle ? bundles[best.origin.bundle] : undefined;
	return { name: best.name, logo: bundle?.logo, brandColor: bundle?.brandColor };
}
