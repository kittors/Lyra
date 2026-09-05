/**
 * Reading rules off disk and sorting them into the three buckets.
 *
 * Sources, in precedence order — the first file to claim a name wins:
 *
 *   <project>/.lyra/rules/*.md   travels with the repository, shared with the team
 *   ~/.lyra/rules/*.md           yours, everywhere
 *
 * A rule that would do nothing gets a diagnostic rather than silence. That is a deliberate
 * departure from the tool this borrows from, where a file with no `description`, no
 * `alwaysApply` and no `condition` simply does not exist — the user wrote something, and it
 * quietly was not there. Nothing is more discouraging than a feature that ignores you.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../skills/loader.ts";
import { BUILTIN_RULES } from "./builtin.ts";
import { compileCondition } from "./condition.ts";
import { type Dialect, normalizeFrontmatter } from "./dialects.ts";
import type { Rule, RuleDiagnostic, RuleScope, RuleSet } from "./types.ts";

const MAX_DESCRIPTION = 400;
/** Above this a regex is refused: pathological backtracking would stall every stream chunk. */
export interface RuleSource {
	dir: string;
	source: Rule["source"];
	/** Whose frontmatter conventions this directory follows. */
	dialect: Dialect;
	/** Which file extensions count here. */
	extensions?: RegExp;
}

/**
 * Every directory a rule could come from, in the order that decides collisions.
 *
 * Project before user, ours before everyone else's. The first is the ordinary rule for layered
 * configuration; the second is a tie-break that lets a rule written for Lyra deliberately shadow
 * one of the same name found elsewhere.
 *
 * Other tools' PROJECT directories are always read: they are what the team wrote for this
 * repository, and they should work the moment you open it. Their USER directories are not, and
 * that asymmetry is deliberate — your private `~/.cursor` rules following you into someone else's
 * repository would mean you and your colleague get different agents on the same code, with
 * nothing on screen to explain why.
 */
export function ruleSources(cwd: string | null, home: string): RuleSource[] {
	const sources: RuleSource[] = [];
	if (cwd) {
		sources.push({ dir: join(cwd, ".lyra", "rules"), source: "workspace", dialect: "lyra" });
		sources.push({ dir: join(cwd, ".cursor", "rules"), source: "workspace", dialect: "cursor", extensions: /\.mdc?$/i });
		sources.push({ dir: join(cwd, ".windsurf", "rules"), source: "workspace", dialect: "windsurf" });
		sources.push({ dir: join(cwd, ".clinerules"), source: "workspace", dialect: "cline" });
		sources.push({ dir: join(cwd, ".github", "instructions"), source: "workspace", dialect: "copilot", extensions: /\.instructions\.md$/i });
	}
	sources.push({ dir: join(home, "rules"), source: "user", dialect: "lyra" });
	return sources;
}

export interface LoadRulesOptions {
	/** Rule names the user switched off. Applies to built-ins and discovered rules alike. */
	disabled?: string[];
	/** Set false to drop the shipped rules entirely. */
	builtin?: boolean;
}

export async function loadRules(sources: RuleSource[], options: LoadRulesOptions = {}): Promise<RuleSet> {
	const diagnostics: RuleDiagnostic[] = [];
	const seen = new Set<string>();
	const rules: Rule[] = [];

	for (const source of sources) {
		const dir = source.dir;

		/*
		 * `.clinerules` is a file about as often as it is a directory.
		 *
		 * Both spellings are in the wild and Cline reads either, so a loader that only calls
		 * readdir silently ignores half of them — the worst kind of compatibility, because the
		 * user sees no error and no rule.
		 */
		const info = await stat(dir).catch(() => null);
		if (info?.isFile()) {
			const raw = await readFile(dir, "utf8").catch(() => null);
			if (raw !== null) {
				/*
				 * 去掉开头的点，也去掉扩展名。
				 *
				 * `.clinerules` → `clinerules`，`GEMINI.md` → `GEMINI`。规则名是去重键，也是用户在
				 * `disabledRules` 里关掉它时写的那个词——目录里的规则一直是去过扩展名的，单文件这条
				 * 路径漏了，于是同一份东西按放在哪儿会有两个名字。
				 */
				const name = dir.split(/[/\\]/).pop()?.replace(/^\./, "").replace(/\.mdc?$/i, "") ?? "rules";
				const built = await buildFromFile(name, dir, source, raw, seen, diagnostics);
				if (built) rules.push(built);
			}
			continue;
		}

		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) continue;

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isFile()) continue;
			const extensions = source.extensions ?? /\.mdc?$/i;
			if (!extensions.test(entry.name)) continue;
			const path = join(dir, entry.name);
			const raw = await readFile(path, "utf8").catch(() => null);
			if (raw === null) continue;

			// Copilot's double extension has to come off in one piece, or the name keeps `.instructions`.
			const name = entry.name.replace(/\.instructions\.md$/i, "").replace(/\.mdc?$/i, "");

			const built = await buildFromFile(name, path, source, raw, seen, diagnostics);
			if (built) rules.push(built);
		}
	}

	/*
	 * Built-ins go last, so a user or project rule of the same name simply replaces one.
	 *
	 * That is the whole override mechanism: no precedence field, no "extends". If you do not like
	 * `no-force-push`, write your own `no-force-push.md` — or name it in `disabledRules`.
	 */
	if (options.builtin !== false) {
		for (const rule of BUILTIN_RULES) {
			if (seen.has(rule.name)) continue;
			seen.add(rule.name);
			rules.push(rule);
		}
	}

	const disabled = new Set(options.disabled ?? []);
	const live = disabled.size > 0 ? rules.filter((rule) => !disabled.has(rule.name)) : rules;

	return {
		always: live.filter((r) => r.bucket === "always"),
		book: live.filter((r) => r.bucket === "book"),
		stream: live.filter((r) => r.bucket === "stream"),
		diagnostics,
	};
}

/** One file → one rule, shared by the directory walk and the single-file `.clinerules` case. */
async function buildFromFile(
	name: string,
	path: string,
	source: RuleSource,
	raw: string,
	seen: Set<string>,
	diagnostics: RuleDiagnostic[],
): Promise<Rule | null> {
	if (seen.has(name)) {
		diagnostics.push({ path, severity: "warning", message: `规则 "${name}" 已由更高优先级的来源提供，这一份未生效。` });
		return null;
	}

	const parsed = parseFrontmatter(raw);
	if (!parsed) {
		diagnostics.push({ path, severity: "error", message: "文件开头的 YAML 无法解析，这条规则未加载。" });
		return null;
	}

	const normalized = normalizeFrontmatter(source.dialect, parsed.frontmatter, name);
	if (normalized.note) diagnostics.push({ path, severity: "warning", message: normalized.note });

	const built = buildRule(name, path, source.source, normalized.frontmatter, parsed.body, diagnostics);
	if (!built) return null;
	seen.add(name);
	return built;
}

function buildRule(
	name: string,
	path: string,
	source: Rule["source"],
	frontmatter: Record<string, unknown>,
	body: string,
	diagnostics: RuleDiagnostic[],
): Rule | null {
	const content = body.trim();
	if (!content) {
		diagnostics.push({ path, severity: "warning", message: "规则正文是空的。" });
		return null;
	}

	const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : undefined;
	if (description && description.length > MAX_DESCRIPTION) {
		diagnostics.push({ path, severity: "warning", message: `description 超过 ${MAX_DESCRIPTION} 字符，已截断。` });
	}

	const conditions = compileConditions(frontmatter.condition, path, diagnostics);
	const scopes = parseScopes(frontmatter.scope, path, diagnostics);
	const alwaysApply = frontmatter.alwaysApply === true;

	/*
	 * Bucketing, in this order.
	 *
	 * A stream rule wins over the other two even when it also carries `alwaysApply`: putting the
	 * body in the prompt AND firing on a match would say the same thing twice, and the whole
	 * point of the stream form is that it costs nothing until it is needed.
	 */
	const bucket: Rule["bucket"] = conditions.length > 0 ? "stream" : alwaysApply ? "always" : description ? "book" : "none" as never;

	if (bucket === ("none" as never)) {
		diagnostics.push({
			path,
			severity: "warning",
			message:
				"这条规则不会生效：需要 description（进规则库，按需读取）、alwaysApply: true（常驻系统提示词）、" +
				"或 condition（模型说出/写出匹配内容时纠正）中的至少一个。",
		});
		return null;
	}

	return {
		name,
		path,
		content,
		description: description?.slice(0, MAX_DESCRIPTION),
		globs: parseStringList(frontmatter.globs),
		alwaysApply,
		conditions,
		scopes,
		interrupt: parseInterrupt(frontmatter.interrupt),
		repeat: parseRepeat(frontmatter.repeat),
		source,
		bucket,
	};
}

/**
 * Compile the regex triggers.
 *
 * A bad regex disables its own rule and says so; it never takes the others down with it. What
 * counts as bad lives in `condition.ts`, shared with the settings page — the length cap and the
 * nested-quantifier refusal are the cheap half of ReDoS defence, the per-match time budget in
 * `stream.ts` is the other half, because a short pattern can still backtrack catastrophically.
 */
function compileConditions(raw: unknown, path: string, diagnostics: RuleDiagnostic[]): RegExp[] {
	const patterns = parseStringList(raw);
	if (!patterns) return [];

	const out: RegExp[] = [];
	for (const pattern of patterns) {
		const compiled = compileCondition(pattern);
		if (compiled.ok) out.push(compiled.regex);
		else diagnostics.push({ path, severity: "warning", message: compiled.reason });
	}
	return out;
}

/**
 * Parse the scope list.
 *
 * The default watches assistant prose and every tool's arguments, but NOT thinking: exploring a
 * wrong idea in thinking is how thinking works, and correcting it there would suppress the
 * exploration rather than the mistake.
 */
function parseScopes(raw: unknown, path: string, diagnostics: RuleDiagnostic[]): RuleScope[] {
	const tokens = parseStringList(raw)?.flatMap((t) => t.split(",")).map((t) => t.trim()).filter(Boolean);
	if (!tokens || tokens.length === 0) return [{ kind: "text" }, { kind: "tool" }];

	const scopes: RuleScope[] = [];
	for (const token of tokens) {
		if (token === "text") scopes.push({ kind: "text" });
		else if (token === "thinking") scopes.push({ kind: "thinking" });
		else if (token === "tool" || token === "toolcall") scopes.push({ kind: "tool" });
		else {
			const match = /^tool:([a-z_][\w-]*)(?:\(([^)]*)\))?$/i.exec(token);
			if (match) scopes.push({ kind: "tool", tool: match[1], glob: match[2] || undefined });
			else diagnostics.push({ path, severity: "warning", message: `scope 里无法识别的项 "${token}"，已忽略。` });
		}
	}
	return scopes.length > 0 ? scopes : [{ kind: "text" }, { kind: "tool" }];
}

function parseInterrupt(raw: unknown): Rule["interrupt"] {
	return raw === "never" || raw === "prose-only" || raw === "tool-only" ? raw : "always";
}

function parseRepeat(raw: unknown): Rule["repeat"] {
	if (raw === "always") return "always";
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return { afterTurns: Math.floor(raw) };
	if (raw && typeof raw === "object" && typeof (raw as { afterTurns?: unknown }).afterTurns === "number") {
		return { afterTurns: Math.max(1, Math.floor((raw as { afterTurns: number }).afterTurns)) };
	}
	return "once";
}

function parseStringList(raw: unknown): string[] | undefined {
	if (typeof raw === "string") return raw.trim() ? [raw] : undefined;
	if (Array.isArray(raw)) {
		const out = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
		return out.length > 0 ? out : undefined;
	}
	return undefined;
}
