/**
 * Settings that can differ per repository, without changing them back by hand every time.
 *
 * One flat global file means working on two projects with different needs — a cheap model and
 * strict approval here, a strong model and loose approval there — is a manual edit on every
 * switch. And the failure is not the editing: it is forgetting to edit back, which makes the next
 * project's session run under the previous project's rules with nothing on screen saying so.
 *
 * Five layers, each more specific than the last:
 *
 *   built-in defaults → global (`~/.lyra`) → project (`<cwd>/.lyra`) → one-shot → runtime
 *
 * The interesting decisions are two: how the layers merge, and what a project file is *not*
 * allowed to carry.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Where a value came from, so the settings page can say which file to edit. */
export type ConfigLayer = "default" | "global" | "project" | "session";

export interface LayeredValue<T> {
	value: T;
	from: ConfigLayer;
}

/**
 * Keys a project file may not set, whatever it says.
 *
 * `.lyra/config.json` is checked into the repository — that is the point of it — so anything that
 * lands there is shared with everyone who clones it and with anyone who reads the repository. A
 * credential in that file is a published credential, and the person who put it there is usually
 * the last to find out.
 *
 * Refused rather than merged-and-warned. A warning that appears once during a load is not read;
 * the value would apply and the session would work, which is exactly the shape of a mistake nobody
 * catches.
 */
export const PROJECT_FORBIDDEN = ["providers", "apiKey", "credentials", "githubToken", "mcpServers"] as const;

export interface MergeReport {
	/** Keys a project file tried to set and was refused. */
	refused: string[];
	/** Which layer each top-level key ended up coming from. */
	origin: Record<string, ConfigLayer>;
}

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge one layer over another: objects deepen, everything else replaces.
 *
 * Arrays replace rather than concatenate, and that is the choice people trip over — omp's docs
 * call it the most common surprise. It is still right: with append semantics there is no way to
 * express *removing* an entry, so a project could add to a global `disabledRules` and never
 * subtract from it. The cost is that a project listing one rule replaces the global list entirely,
 * which the settings page has to say out loud rather than leave to be discovered.
 */
export function mergeLayer(base: Plain, over: Plain): Plain {
	const out: Plain = { ...base };
	for (const [key, value] of Object.entries(over)) {
		if (value === undefined) continue;
		out[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeLayer(base[key], value) : value;
	}
	return out;
}

/** Strip what a project file is not allowed to carry, reporting what was taken out. */
export function sanitizeProjectConfig(config: Plain): { config: Plain; refused: string[] } {
	const refused: string[] = [];
	const out: Plain = {};
	for (const [key, value] of Object.entries(config)) {
		if ((PROJECT_FORBIDDEN as readonly string[]).includes(key)) {
			refused.push(key);
			continue;
		}
		out[key] = value;
	}
	return { config: out, refused };
}

/**
 * Apply every layer in order and record where each key ended up coming from.
 *
 * The provenance is not decoration. "Why is this project using that model" is answered by naming
 * the file, and without it the settings page can only show a value and leave the person to search
 * three files for whichever one set it.
 */
export function resolveLayers(layers: { layer: ConfigLayer; config: Plain }[]): { config: Plain; report: MergeReport } {
	let config: Plain = {};
	const origin: Record<string, ConfigLayer> = {};
	const refused: string[] = [];

	for (const { layer, config: raw } of layers) {
		const { config: clean, refused: rejected } = layer === "project" ? sanitizeProjectConfig(raw) : { config: raw, refused: [] };
		refused.push(...rejected);
		for (const key of Object.keys(clean)) origin[key] = layer;
		config = mergeLayer(config, clean);
	}

	return { config, report: { refused, origin } };
}

/** Read a JSON config file. A missing file is not an error; a malformed one is reported. */
export async function readConfigFile(path: string): Promise<{ config: Plain; error?: string }> {
	const raw = await readFile(path, "utf8").catch(() => null);
	if (raw === null) return { config: {} };
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isPlainObject(parsed)) return { config: {}, error: `${path} 的内容不是一个对象。` };
		return { config: parsed };
	} catch (error) {
		/*
		 * A broken project config must not stop the session. Someone mid-edit with a trailing comma
		 * should get their global settings and a message, not a window that will not open.
		 */
		return { config: {}, error: `${path} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}` };
	}
}

export function projectConfigPath(cwd: string): string {
	return join(cwd, ".lyra", "config.json");
}

/**
 * Load the project layer for a working directory.
 *
 * Global settings stay where they are — this only adds the layer above them, so a project with no
 * `.lyra/config.json` behaves exactly as before.
 */
export async function loadProjectLayer(cwd: string | null): Promise<{ config: Plain; refused: string[]; error?: string }> {
	if (!cwd) return { config: {}, refused: [] };
	const { config, error } = await readConfigFile(projectConfigPath(cwd));
	const { config: clean, refused } = sanitizeProjectConfig(config);
	return { config: clean, refused, error };
}
