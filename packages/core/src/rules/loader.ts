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

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../skills/loader.ts";
import type { Rule, RuleDiagnostic, RuleScope, RuleSet } from "./types.ts";

const MAX_DESCRIPTION = 400;
/** Above this a regex is refused: pathological backtracking would stall every stream chunk. */
const MAX_CONDITION_LENGTH = 500;

export interface RuleSource {
	dir: string;
	source: Rule["source"];
}

export function ruleSources(cwd: string | null, home: string): RuleSource[] {
	const sources: RuleSource[] = [];
	if (cwd) sources.push({ dir: join(cwd, ".lyra", "rules"), source: "workspace" });
	sources.push({ dir: join(home, "rules"), source: "user" });
	return sources;
}

export async function loadRules(sources: RuleSource[]): Promise<RuleSet> {
	const diagnostics: RuleDiagnostic[] = [];
	const seen = new Set<string>();
	const rules: Rule[] = [];

	for (const { dir, source } of sources) {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) continue;

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isFile() || !/\.mdc?$/i.test(entry.name)) continue;
			const path = join(dir, entry.name);
			const raw = await readFile(path, "utf8").catch(() => null);
			if (raw === null) continue;

			const name = entry.name.replace(/\.mdc?$/i, "");
			if (seen.has(name)) {
				diagnostics.push({ path, severity: "warning", message: `规则 "${name}" 已由更高优先级的来源提供，这一份未生效。` });
				continue;
			}

			const parsed = parseFrontmatter(raw);
			if (!parsed) {
				diagnostics.push({ path, severity: "error", message: "文件开头的 YAML 无法解析，这条规则未加载。" });
				continue;
			}

			const built = buildRule(name, path, source, parsed.frontmatter, parsed.body, diagnostics);
			if (!built) continue;
			seen.add(name);
			rules.push(built);
		}
	}

	return {
		always: rules.filter((r) => r.bucket === "always"),
		book: rules.filter((r) => r.bucket === "book"),
		stream: rules.filter((r) => r.bucket === "stream"),
		diagnostics,
	};
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
 * A bad regex disables its own rule and says so; it never takes the others down with it. The
 * length cap is the cheap half of ReDoS defence — the other half is the per-match time budget in
 * `stream.ts`, because a short pattern can still backtrack catastrophically.
 */
function compileConditions(raw: unknown, path: string, diagnostics: RuleDiagnostic[]): RegExp[] {
	const patterns = parseStringList(raw);
	if (!patterns) return [];

	const out: RegExp[] = [];
	for (const pattern of patterns) {
		if (pattern.length > MAX_CONDITION_LENGTH) {
			diagnostics.push({ path, severity: "warning", message: `condition 超过 ${MAX_CONDITION_LENGTH} 字符，已忽略。` });
			continue;
		}
		/*
		 * Refuse nested quantifiers outright.
		 *
		 * `(a+)+`, `(a*)*`, `(\w+\s?)+` and friends are the classic catastrophic-backtracking
		 * shapes, and they cannot be defended against after the fact — a JS regex runs to
		 * completion with nothing able to interrupt it. The matcher also caps how much text it
		 * sees, but refusing the pattern is the honest answer: a rule that cannot be evaluated
		 * safely should say so at load time, not stall a stream months later.
		 */
		if (/\([^)]*[+*]\s*\)\s*[+*]/.test(pattern)) {
			diagnostics.push({
				path,
				severity: "warning",
				message: `condition 里有嵌套量词（形如 (a+)+），这类正则可能指数级回溯，已忽略：${pattern.slice(0, 60)}`,
			});
			continue;
		}

		// `(?i)` and friends are how the pattern would be written in most other tools.
		let flags = "";
		let body = pattern;
		const inline = /^\(\?([ims]+)\)/.exec(body);
		if (inline) {
			flags = inline[1].replace("s", "s");
			body = body.slice(inline[0].length);
		}
		try {
			out.push(new RegExp(body, flags));
		} catch (error) {
			diagnostics.push({
				path,
				severity: "warning",
				message: `condition 不是合法正则，已忽略：${error instanceof Error ? error.message : String(error)}`,
			});
		}
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
