/**
 * Skills: user-authored instruction bundles loaded from disk.
 *
 * A skill is a directory containing `SKILL.md` with YAML frontmatter. The frontmatter's
 * `name` and `description` are listed in the system prompt so the model can decide when a
 * skill applies; the body is only injected when the `skill` tool is called, which keeps
 * dozens of skills affordable in context.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { normalizeKeys } from "../capability/fs.ts";

export interface Skill {
	name: string;
	description: string;
	/** Markdown body, without frontmatter. */
	content: string;
	/** Absolute path to SKILL.md. */
	path: string;
	/** Directory holding the skill and its resources. */
	dir: string;
	/** Where the skill came from, shown in the UI. */
	source: "workspace" | "user" | "builtin";
	/** Restrict which tools the agent may use while the skill is active. */
	allowedTools?: string[];
	/** Hide from the model; only invocable by the user through a slash command. */
	disableModelInvocation: boolean;
	/** Set when the skill came from a plugin bundle rather than a loose directory. */
	pluginId?: string;
}

export interface SkillDiagnostic {
	path: string;
	message: string;
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;

export async function loadSkills(
	sources: { dir: string; source: Skill["source"] }[],
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
	const skills: Skill[] = [];
	const diagnostics: SkillDiagnostic[] = [];
	const seen = new Set<string>();

	for (const { dir, source } of sources) {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) continue;

		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			const skillDir = join(dir, entry.name);
			if (entry.isSymbolicLink() && !(await stat(skillDir).then((s) => s.isDirectory()).catch(() => false))) continue;

			const file = join(skillDir, "SKILL.md");
			const raw = await readFile(file, "utf8").catch(() => null);
			if (raw === null) continue;

			const parsed = parseFrontmatter(raw);
			if (!parsed) {
				diagnostics.push({ path: file, message: "Frontmatter is not valid YAML." });
				continue;
			}
			if (parsed.problem) diagnostics.push({ path: file, message: parsed.problem });

			/*
			 * 两种拼写当成同一个键。
			 *
			 * `disable-model-invocation` 和 `disableModelInvocation` 在外面都有人写——启发这些
			 * 格式的那几个工具彼此就不一致——而这里原本只认连字符那一种。写了驼峰的人得到的是一个
			 * 被静默忽略的字段：技能照常加载、照常出现在列表里，只是那个开关不起作用。
			 */
			const { body } = parsed;
			const frontmatter = normalizeKeys(parsed.frontmatter);
			const name = typeof frontmatter.name === "string" && frontmatter.name ? frontmatter.name : entry.name;
			const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";

			if (!description) {
				diagnostics.push({ path: file, message: "`description` is required — it is how the model decides to use this skill." });
				continue;
			}
			if (description.length > MAX_DESCRIPTION) {
				diagnostics.push({ path: file, message: `\`description\` exceeds ${MAX_DESCRIPTION} characters.` });
				continue;
			}
			if (!NAME_PATTERN.test(name)) {
				diagnostics.push({ path: file, message: `\`name\` must be lowercase kebab-case; got "${name}".` });
				continue;
			}
			// Workspace skills are loaded first, so a later user-level skill of the same name loses.
			if (seen.has(name)) {
				diagnostics.push({ path: file, message: `Skill "${name}" is already defined by a higher-priority source.` });
				continue;
			}

			seen.add(name);
			skills.push({
				name,
				description,
				content: body,
				path: file,
				dir: skillDir,
				source,
				allowedTools: Array.isArray(frontmatter["allowed-tools"])
					? (frontmatter["allowed-tools"] as unknown[]).filter((t): t is string => typeof t === "string")
					: undefined,
				disableModelInvocation: frontmatter["disable-model-invocation"] === true || frontmatter.disableModelInvocation === true,
			});
		}
	}

	return { skills, diagnostics };
}

export interface ParsedFrontmatter {
	frontmatter: Record<string, unknown>;
	body: string;
	/**
	 * Set when the document opened a frontmatter block and never closed it.
	 *
	 * The parse still succeeds — the whole document becomes the body, which is the only reading
	 * left once the delimiters are unusable. But that reading injects `name:` and `description:`
	 * into the model's context as prose, and the author is looking at a file that appears to have
	 * metadata and behaves as if it has none. Callers surface this; nothing depends on it.
	 */
	problem?: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter | null {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) {
		return {
			frontmatter: {},
			body: normalized,
			problem: "Frontmatter opens with `---` but is never closed, so the whole file is being treated as body text.",
		};
	}
	try {
		const frontmatter = (parseYaml(normalized.slice(4, end)) ?? {}) as Record<string, unknown>;
		return { frontmatter, body: normalized.slice(end + 4).replace(/^\n+/, "") };
	} catch {
		return null;
	}
}

/** Wrap a skill body for injection, telling the model where its relative paths resolve. */
export function formatSkillInvocation(skill: Skill, extra?: string): string {
	const header = `<skill name="${skill.name}" dir="${skill.dir}">\nFile references inside this skill are relative to ${skill.dir}.\n\n`;
	return `${header}${skill.content}\n</skill>${extra ? `\n\n${extra}` : ""}`;
}

/** The compact catalogue injected into the system prompt. */
export function formatSkillCatalogue(skills: Skill[]): string {
	const visible = skills.filter((s) => !s.disableModelInvocation);
	if (visible.length === 0) return "";
	const lines = visible.map((s) => `- ${s.name}: ${s.description}`);
	return [
		"## Skills",
		"",
		"These skills are available. When a task matches one, call the `skill` tool with its name **before** starting your own approach — the skill's instructions replace your default plan for that task.",
		"",
		...lines,
	].join("\n");
}
