/**
 * A bundle's README, for its page in the market.
 *
 * The market's web page shows each entry's README under its name; the app showed a line and a list of
 * facts, so the same entry was a page of documentation on the site and a stub in the app. This finds
 * the same text, from the first of three places that has it:
 *
 *   1. The platform the entry was listed on — `/v1/entries/<id>` beside the `/v1/index` it came
 *      from. That is the README the site shows, with the directory its relative links are written
 *      against, and it answers for a wrapped server too (with its long description, which is what
 *      that server has instead of a README).
 *   2. The bundle's own directory, once it is installed — offline, and exactly the version on disk.
 *   3. The repository on GitHub, for an index that is only a file and has no detail page.
 *
 * The text goes back to the window as text. The window parses it with `lib/readme/parse.ts`, which
 * builds a tree and never markup, so nothing in a README becomes an element the page did not choose
 * to make; its pictures go through `system:remoteImage` like every other remote picture.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface ReadmeQuery {
	id: string;
	repository?: string;
	/** The entry's directory inside its repository, for a repository holding several. */
	path?: string;
	/** Where it is installed, when it is. Only read if it lies under `home`. */
	dir?: string;
}

export interface ReadmeAnswer {
	markdown: string;
	/** `owner/name` on GitHub, for resolving the README's relative links and pictures. */
	repo?: string;
	/** The directory those relative links are written against. */
	dir?: string;
}

/** A README past this is not documentation; nobody reads four hundred pages in a side panel. */
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;
/** As long as the index itself is reused. A README changes when the entry is rebuilt, not more often. */
const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; answer: ReadmeAnswer | null }>();

export async function readmeFor(query: ReadmeQuery, registries: readonly string[], home: string): Promise<ReadmeAnswer | null> {
	if (!isId(query.id)) return null;
	const key = JSON.stringify([query.id, query.repository ?? "", query.path ?? "", query.dir ?? "", registries]);
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.answer;

	const answer = (await fromPlatform(query, registries)) ?? (await fromDisk(query, home)) ?? (await fromGitHub(query));
	cache.set(key, { at: Date.now(), answer });
	return answer;
}

/** `owner/name` of a GitHub repository URL, or undefined for anything else. */
export function githubRepo(repository: string | undefined): string | undefined {
	const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec((repository ?? "").trim());
	return match ? `${match[1]}/${match[2]}` : undefined;
}

async function fromPlatform(query: ReadmeQuery, registries: readonly string[]): Promise<ReadmeAnswer | null> {
	const origins = new Set<string>();
	for (const url of registries) {
		// Only an index served by the platform has a detail page beside it; a JSON file does not.
		const match = /^(https:\/\/[^/?#]+)\/v1\/index(?:[?#].*)?$/i.exec(url.trim());
		if (match?.[1]) origins.add(match[1]);
	}
	for (const origin of origins) {
		const detail = await fetchJson(`${origin}/v1/entries/${encodeURIComponent(query.id)}`);
		if (!detail || typeof detail.readme !== "string" || !detail.readme.trim()) continue;
		// The same id on another platform is another entry.
		const listed = githubRepo(typeof detail.repository === "string" ? detail.repository : undefined);
		const asked = githubRepo(query.repository);
		if (asked && listed && asked.toLowerCase() !== listed.toLowerCase()) continue;
		return {
			markdown: detail.readme,
			repo: listed,
			dir: typeof detail.readmeBase === "string" ? detail.readmeBase : "",
		};
	}
	return null;
}

async function fromDisk(query: ReadmeQuery, home: string): Promise<ReadmeAnswer | null> {
	if (!query.dir) return null;
	const root = resolve(home);
	const dir = resolve(query.dir);
	// Installed bundles live under the Lyra home. A directory anywhere else is not one this reads.
	if (!dir.startsWith(root + sep)) return null;
	const names = await readdir(dir).catch(() => [] as string[]);
	const name = names.find((candidate) => /^readme(?:\.md|\.markdown)?$/i.test(candidate));
	if (!name) return null;
	const file = join(dir, name);
	const info = await stat(file).catch(() => null);
	if (!info?.isFile() || info.size > MAX_BYTES) return null;
	const markdown = await readFile(file, "utf8").catch(() => "");
	return markdown.trim() ? { markdown, repo: githubRepo(query.repository), dir: cleanPath(query.path) ?? "" } : null;
}

async function fromGitHub(query: ReadmeQuery): Promise<ReadmeAnswer | null> {
	const repo = githubRepo(query.repository);
	const path = cleanPath(query.path);
	if (!repo || path === null) return null;
	const response = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${path ? `${path}/` : ""}README.md`, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	}).catch(() => null);
	if (!response?.ok) return null;
	if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
	const markdown = await response.text().catch(() => "");
	return markdown.trim() && markdown.length <= MAX_BYTES ? { markdown, repo, dir: path } : null;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
		if (!response.ok) return null;
		if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
		const value: unknown = await response.json();
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** A registry id: what goes into a URL path segment here. */
function isId(id: unknown): id is string {
	return typeof id === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(id);
}

/** A directory inside a repository: segments only, never climbing out. Empty for the root; null when refused. */
function cleanPath(path: string | undefined): string | null {
	const parts = (path ?? "").split("/").filter((part) => part && part !== ".");
	if (parts.some((part) => part === ".." || !/^[\w.@+-]+$/.test(part))) return null;
	return parts.join("/");
}
