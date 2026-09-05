/**
 * What other tools' configuration this repository carries — and that Lyra is already reading.
 *
 * The first time a project with a `.cursor/rules/` or an `AGENTS.md` is opened, the plan (15 §5)
 * wants one notice, worded as a fact rather than a question: not "import these?" but "these are
 * in use". Nothing to do is the whole point of reading every format in place.
 *
 * The lines come from the capability registry rather than from looking for directories, so they
 * say what was actually loaded: a `.cursor/rules/` holding nothing parseable is not "6 条规则",
 * it is nothing. Only this repository's files count — a user's own `~/.cursor/rules` is not what
 * the repository carries.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { createRegistry } from "../capability/index.ts";
import type { CapabilityId } from "../capability/types.ts";
import { lyraHome, projectIdFor } from "../session/store.ts";

export interface ForeignConfigLine {
	/** Provider id: `cursor`, `claude`, `agents-dir`, `codex`... */
	provider: string;
	label: string;
	/** Relative to the repository: `.cursor/rules/`, `AGENTS.md`. Sorted on. */
	where: string;
	kind: CapabilityId;
	count: number;
}

/** Providers that are ours: what they find is not another tool's configuration. */
const OURS = new Set(["native", "builtin", "plugins", "managed"]);
const KINDS: CapabilityId[] = ["rule", "skill", "command", "agent", "context-file"];

/**
 * Context files are read by the native provider whichever tool wrote them; the file name says
 * whose convention it is. `LYRA.md` is ours and is not listed.
 */
const CONTEXT_OWNERS: Record<string, { provider: string; label: string }> = {
	"AGENTS.md": { provider: "codex", label: "Codex / Agents 标准" },
	"CLAUDE.md": { provider: "claude", label: "Claude Code" },
	"GEMINI.md": { provider: "gemini", label: "Gemini CLI" },
};

function whereOf(cwd: string, path: string, kind: CapabilityId): string {
	const rel = relative(cwd, path).split(sep).join("/");
	if (kind === "context-file") return rel;
	// A skill is a directory with a SKILL.md in it; the line names the directory holding the skills.
	const dir = rel.endsWith("/SKILL.md") ? dirname(dirname(rel)) : dirname(rel);
	return `${dir}/`;
}

export async function foreignConfigsIn(cwd: string): Promise<ForeignConfigLine[]> {
	const registry = createRegistry({ home: lyraHome(), userHome: homedir() });
	const lines = new Map<string, ForeignConfigLine>();
	for (const kind of KINDS) {
		const result = await registry.load<{ name: string }>(kind, { cwd }).catch(() => null);
		if (!result) continue;
		for (const item of result.all) {
			const meta = item.provenance;
			if (meta.scope !== "project") continue;
			let provider: string = meta.provider;
			let label = meta.providerLabel;
			if (kind === "context-file") {
				const owner = CONTEXT_OWNERS[basename(meta.path)];
				if (!owner) continue;
				provider = owner.provider;
				label = owner.label;
			} else if (OURS.has(meta.provider)) {
				continue;
			}
			const where = whereOf(cwd, meta.path, kind);
			const key = `${provider} ${where} ${kind}`;
			const line = lines.get(key) ?? { provider, label, where, kind, count: 0 };
			line.count += 1;
			lines.set(key, line);
		}
	}
	return [...lines.values()].sort((a, b) => a.where.localeCompare(b.where) || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------------------
// Once per project
// ---------------------------------------------------------------------------

export const FOREIGN_CONFIGS_NOTICE = "foreign-configs";

/** Beside the project's memory, not in the repository: whether you have seen a notice is yours. */
export function projectNoticesPath(cwd: string): string {
	return join(lyraHome(), "projects", projectIdFor(cwd), "notices.json");
}

async function readNotices(cwd: string): Promise<Record<string, number>> {
	const raw = await readFile(projectNoticesPath(cwd), "utf8").catch(() => null);
	if (raw === null) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
	} catch {
		return {};
	}
}

export async function noticed(cwd: string, key: string): Promise<boolean> {
	return typeof (await readNotices(cwd))[key] === "number";
}

export async function markNoticed(cwd: string, key: string, at = Date.now()): Promise<void> {
	const file = projectNoticesPath(cwd);
	const current = await readNotices(cwd);
	current[key] = at;
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}
