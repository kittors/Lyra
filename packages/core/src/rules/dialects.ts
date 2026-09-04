/**
 * Reading the rule files other tools already wrote.
 *
 * A team's repository usually has `.cursor/rules/` or `.github/instructions/` in it already,
 * accumulated over months. Requiring them to be rewritten in our format before they do anything
 * asks for work with no payoff attached — and that is the step where most people stop.
 *
 * `commands/loader.ts` made this argument for slash commands and it holds for rules too: a rule
 * file is Markdown with some frontmatter. There is nothing in it that belongs to one program.
 *
 * What differs between the dialects is the frontmatter's semantics, and each one has a trap in it.
 * They are normalised here, in one place, so `loader.ts` only ever sees our own shape.
 */

export type Dialect = "lyra" | "cursor" | "windsurf" | "cline" | "copilot";

export interface Normalized {
	frontmatter: Record<string, unknown>;
	/** Set when the dialect could not express something and the user should know. */
	note?: string;
}

/**
 * Bring one dialect's frontmatter into ours.
 *
 * The output only ever uses our keys: `description`, `globs`, `alwaysApply`, `condition`,
 * `scope`, `interrupt`, `repeat`. Nothing downstream needs to know where a rule came from.
 */
export function normalizeFrontmatter(dialect: Dialect, raw: Record<string, unknown>, name: string): Normalized {
	switch (dialect) {
		case "cursor":
			return normalizeCursor(raw);
		case "windsurf":
			return normalizeWindsurf(raw);
		case "cline":
			return normalizeCline(raw, name);
		case "copilot":
			return normalizeCopilot(raw, name);
		default:
			return { frontmatter: raw };
	}
}

/**
 * Cursor `.mdc`.
 *
 * The trap is `alwaysApply`. Cursor's own UI writes it out for every rule, including as `false`
 * and occasionally as other values — so a tolerant reading ("is it truthy?") turns a directory of
 * conditional rules into a directory of rules that are always in the prompt. Only a literal
 * `true` counts.
 */
function normalizeCursor(raw: Record<string, unknown>): Normalized {
	const out: Record<string, unknown> = {};
	if (typeof raw.description === "string" && raw.description.trim()) out.description = raw.description;
	if (raw.alwaysApply === true) out.alwaysApply = true;

	const globs = toStringList(raw.globs);
	if (globs) out.globs = globs;

	/*
	 * A Cursor rule with globs and no description is meant to apply when those files are in play.
	 * We have no equivalent of that — the rulebook needs a description for the model to choose by —
	 * so the globs become the description. It is worse than what the author wrote, and better than
	 * dropping the rule.
	 */
	if (!out.description && !out.alwaysApply && globs) out.description = `适用于 ${globs.join(", ")}`;

	return { frontmatter: out };
}

/** Windsurf. Same shape as Cursor minus the `alwaysApply` quirk; the global file has no frontmatter at all. */
function normalizeWindsurf(raw: Record<string, unknown>): Normalized {
	const out: Record<string, unknown> = {};
	if (typeof raw.description === "string" && raw.description.trim()) out.description = raw.description;
	if (raw.alwaysApply === true) out.alwaysApply = true;
	const globs = toStringList(raw.globs);
	if (globs) out.globs = globs;
	// A Windsurf rule with no metadata is an always-on instruction — that is what the format means.
	if (!out.description && !out.alwaysApply) out.alwaysApply = true;
	return { frontmatter: out };
}

/** Cline. `.clinerules` files carry no frontmatter at all: the whole file is a standing instruction. */
function normalizeCline(raw: Record<string, unknown>, _name: string): Normalized {
	const out: Record<string, unknown> = { ...raw };
	if (!out.description && out.alwaysApply !== true) out.alwaysApply = true;
	return { frontmatter: out };
}

/**
 * GitHub Copilot `*.instructions.md`.
 *
 * `applyTo` is the whole of it, and it means different things at different values:
 *
 *   '*' / '**' / '**\/*'   applies everywhere → an always-apply rule, with the glob dropped
 *   'src/**'               applies to a subtree → a rulebook entry scoped to it
 *   missing                unspecified → a rulebook entry, and worth a note
 */
function normalizeCopilot(raw: Record<string, unknown>, name: string): Normalized {
	const out: Record<string, unknown> = {};
	if (typeof raw.description === "string" && raw.description.trim()) out.description = raw.description;

	const applyTo = raw.applyTo;
	if (applyTo === undefined || applyTo === null || applyTo === "") {
		if (!out.description) out.description = `来自 .github/instructions/${name}`;
		return { frontmatter: out, note: "缺少 applyTo，已作为按需读取的规则加载。" };
	}

	const globs = typeof applyTo === "string" ? applyTo.split(",").map((g) => g.trim()).filter(Boolean) : toStringList(applyTo) ?? [];
	const universal = globs.length > 0 && globs.every((g) => g === "*" || g === "**" || g === "**/*");

	if (universal) {
		out.alwaysApply = true;
		return { frontmatter: out };
	}

	if (globs.length > 0) out.globs = globs;
	if (!out.description) out.description = `适用于 ${globs.join(", ")}`;
	return { frontmatter: out };
}

function toStringList(raw: unknown): string[] | undefined {
	if (typeof raw === "string") {
		const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
		return parts.length > 0 ? parts : undefined;
	}
	if (Array.isArray(raw)) {
		const out = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
		return out.length > 0 ? out : undefined;
	}
	return undefined;
}
