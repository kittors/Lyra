/**
 * Symbol index.
 *
 * `grep` answers "where does this text appear"; this answers "where is this thing defined".
 * The difference matters on a large repo: asking for `applyDiscount` by grep returns every
 * call site, while the index returns the one line that defines it.
 *
 * Definitions are matched by regex rather than parsed. A real parser per language would be
 * more precise, but it would also need a toolchain per language; a regex that recognises the
 * declaration forms of the languages in the tree gets the agent to the right file and line,
 * which is what it needs before reading.
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { lyraHome } from "../session/store.ts";
import { looksBinary } from "../tools/paths.ts";

export interface SymbolEntry {
	name: string;
	kind: string;
	/** Workspace-relative path. */
	file: string;
	line: number;
	/** The declaration line, trimmed. */
	text: string;
}

export interface SymbolIndex {
	cwd: string;
	builtAt: number;
	fileCount: number;
	symbols: SymbolEntry[];
	/** Files skipped because they were binary or too large. */
	skipped: number;
}

const MAX_FILE_BYTES = 800_000;
const MAX_SYMBOLS = 40_000;

const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "target", "vendor",
	"__pycache__", ".venv", "venv", ".turbo", ".cache", "Pods", ".gradle", ".expo", "coverage",
]);

/** Extensions whose declarations these patterns understand. Shared with the `read` outline. */
export const CODE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".swift",
	".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".scala", ".sh", ".sql", ".vue", ".svelte",
]);

/** Declaration forms, in priority order. The first capture group is the symbol name. */
export const PATTERNS: { kind: string; re: RegExp }[] = [
	{ kind: "function", re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
	{ kind: "class", re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
	{ kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
	{ kind: "type", re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
	{ kind: "enum", re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
	// `export const foo = (…) =>` and `export const Foo: Type = {` both count as definitions.
	{ kind: "const", re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
	{ kind: "func", re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/ },
	{ kind: "def", re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
	{ kind: "struct", re: /^\s*(?:pub\s+)?(?:struct|trait|impl|enum)\s+([A-Za-z_][\w]*)/ },
	{ kind: "method", re: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>[\],\s]+\s+([A-Za-z_]\w*)\s*\(/ },
];

export async function buildIndex(cwd: string, signal?: AbortSignal): Promise<SymbolIndex> {
	const symbols: SymbolEntry[] = [];
	let fileCount = 0;
	let skipped = 0;

	const walk = async (dir: string): Promise<void> => {
		if (signal?.aborted || symbols.length >= MAX_SYMBOLS) return;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (signal?.aborted) return;
			const full = join(dir, entry.name);

			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
				await walk(full);
				continue;
			}
			if (!entry.isFile()) continue;

			const dot = entry.name.lastIndexOf(".");
			if (dot === -1 || !CODE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) continue;

			const info = await stat(full).catch(() => null);
			if (!info || info.size > MAX_FILE_BYTES) {
				skipped += 1;
				continue;
			}

			const buffer = await readFile(full).catch(() => null);
			if (!buffer || looksBinary(buffer)) {
				skipped += 1;
				continue;
			}

			fileCount += 1;
			const rel = relative(cwd, full).split(sep).join("/");
			const lines = buffer.toString("utf8").split("\n");

			for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS; i++) {
				const line = lines[i];
				// Long minified lines are not declarations worth indexing.
				if (line.length > 400) continue;
				for (const { kind, re } of PATTERNS) {
					const match = re.exec(line);
					if (!match) continue;
					symbols.push({ name: match[1], kind, file: rel, line: i + 1, text: line.trim().slice(0, 200) });
					break;
				}
			}
		}
	};

	await walk(cwd);
	return { cwd, builtAt: Date.now(), fileCount, symbols, skipped };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function indexPath(cwd: string): string {
	const id = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	return join(lyraHome(), "index", `${id}.json`);
}

export async function saveIndex(index: SymbolIndex): Promise<void> {
	const path = indexPath(index.cwd);
	await mkdir(join(lyraHome(), "index"), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, JSON.stringify(index), "utf8");
	await rename(tmp, path);
}

export async function loadIndex(cwd: string): Promise<SymbolIndex | null> {
	const raw = await readFile(indexPath(cwd), "utf8").catch(() => null);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as SymbolIndex;
		return parsed.cwd === cwd && Array.isArray(parsed.symbols) ? parsed : null;
	} catch {
		return null;
	}
}

export async function indexStats(cwd: string): Promise<{ exists: boolean; builtAt?: number; files?: number; symbols?: number; bytes?: number }> {
	const path = indexPath(cwd);
	const info = await stat(path).catch(() => null);
	if (!info) return { exists: false };
	const index = await loadIndex(cwd);
	return {
		exists: true,
		builtAt: index?.builtAt,
		files: index?.fileCount,
		symbols: index?.symbols.length,
		bytes: info.size,
	};
}

/**
 * Rank matches so the most likely definition comes first: exact name, then prefix, then
 * substring, and within each, declarations that look exported over local ones.
 */
export function searchIndex(index: SymbolIndex, query: string, kind?: string, limit = 40): SymbolEntry[] {
	const needle = query.toLowerCase();
	const scored: { entry: SymbolEntry; score: number }[] = [];

	for (const entry of index.symbols) {
		if (kind && entry.kind !== kind) continue;
		const name = entry.name.toLowerCase();
		let score: number;
		if (name === needle) score = 0;
		else if (name.startsWith(needle)) score = 1;
		else if (name.includes(needle)) score = 2;
		else continue;
		if (entry.text.startsWith("export") || entry.text.startsWith("pub ")) score -= 0.5;
		scored.push({ entry, score });
	}

	scored.sort((a, b) => a.score - b.score || a.entry.file.localeCompare(b.entry.file) || a.entry.line - b.entry.line);
	return scored.slice(0, limit).map((s) => s.entry);
}
