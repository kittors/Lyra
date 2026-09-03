/**
 * Carrying an installed bundle's icon to the transcript rows that report its calls.
 *
 * The rule for which server a tool name belongs to is in `mcp-marks.ts`; this is the half that
 * needs a window — the configured servers come from the store, and the pictures come from a scan of
 * the extension directories in the main process.
 */

import type { Settings } from "@lyra/core";
import { useEffect, useState } from "react";

import { useApp } from "../store.ts";
import { markFor, type BundleMarks, type McpMark } from "./mcp-marks.ts";
import { bridge } from "../services/index.ts";

/**
 * The installed bundles' marks, read once per window and re-read when something is installed.
 *
 * Module-level rather than in the store because it is not state anyone acts on — it is the answer
 * to a question about the disk, and every transcript row asks the same one. Without the shared copy
 * a conversation with forty tool runs would send forty identical IPC calls on mount.
 */
let cached: { nonce: number; marks: BundleMarks } | null = null;
let inFlight: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

async function load(nonce: number, cwd: string): Promise<void> {
	const scan = await bridge.plugins.list(cwd);
	const marks: BundleMarks = {};
	for (const bundle of scan.mcpBundles) {
		marks[bundle.id] = { logo: bundle.manifest.interface?.logo, brandColor: bundle.manifest.interface?.brandColor };
	}
	cached = { nonce, marks };
	for (const listener of listeners) listener();
}

/**
 * A lookup from tool name to the server that answered it.
 *
 * Returns a function rather than a map so a row can ask about its own tool without a shape that
 * invites callers to iterate over every server on every render.
 */
export function useMcpMark(): (toolName: string) => McpMark | null {
	const settings = useApp((s) => s.settings) as Settings | null;
	const workspace = useApp((s) => s.workspace);
	const nonce = useApp((s) => s.extensionsNonce);
	const [, redraw] = useState(0);

	useEffect(() => {
		const listener = () => redraw((n) => n + 1);
		listeners.add(listener);
		if (cached?.nonce !== nonce && !inFlight) {
			/*
			 * A failure leaves the marks empty, which draws the glyph for an MCP call — the same as a
			 * server whose bundle shipped no icon. Nothing in a transcript should depend on this
			 * succeeding, so there is nothing to report and nothing to retry.
			 */
			inFlight = load(nonce, workspace?.path ?? "")
				.catch(() => {})
				.finally(() => {
					inFlight = null;
				});
		}
		return () => {
			listeners.delete(listener);
		};
	}, [nonce, workspace?.path]);

	const servers = settings?.mcpServers ?? [];
	return (toolName: string) => markFor(toolName, servers, cached?.marks ?? {});
}
