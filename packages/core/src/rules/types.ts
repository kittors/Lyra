/**
 * Rules: what the user wants the agent to do, and not do.
 *
 * Today the only place to say that is a project instruction file, which is injected whole, every
 * turn, regardless of what the turn is about. That has two consequences worth naming: it can only
 * hold a few things before it costs more than it is worth, and it cannot say "when editing CSS"
 * — so the rules that are domain-specific have nowhere to live.
 *
 * One file format, three behaviours, chosen by what the frontmatter says:
 *
 *   always    `alwaysApply: true` — the body goes into the system prompt. What AGENTS.md does now,
 *             but per-file, individually switchable.
 *   book      has a `description` — only the name and description are in the prompt; the body is
 *             read on demand. This is what makes it affordable to write a long rule.
 *   stream    has a `condition` — costs nothing at all until the model says or writes something
 *             that matches, and then interrupts mid-sentence.
 *
 * The third is the one that changes the experience. The other two still only get read when the
 * model decides to; a stream rule fires whether or not the model was paying attention.
 */

export type RuleBucket = "always" | "book" | "stream";

/** Which parts of the model's output a stream rule watches. */
export type RuleScope =
	| { kind: "text" }
	| { kind: "thinking" }
	/** Any tool's arguments. */
	| { kind: "tool" }
	/** One tool's arguments, optionally narrowed to paths matching a glob. */
	| { kind: "tool"; tool: string; glob?: string };

export interface Rule {
	/** Filename without extension. Also the dedupe key and what `rule://` resolves. */
	name: string;
	path: string;
	/** The body, frontmatter stripped. */
	content: string;
	/** Required for the rulebook: it is how the model decides to read the rule. */
	description?: string;
	/** Files this rule is about. Advisory in the prompt; a hard gate for stream rules. */
	globs?: string[];
	alwaysApply?: boolean;
	/** Compiled stream triggers. Empty means this is not a stream rule. */
	conditions: RegExp[];
	/** Where the conditions are watched. Defaults to prose plus every tool, never thinking. */
	scopes: RuleScope[];
	/** Whether a match aborts the stream or is delivered afterwards. */
	interrupt: "always" | "prose-only" | "tool-only" | "never";
	/** How often the same rule may fire. */
	repeat: "once" | "always" | { afterTurns: number };
	source: "workspace" | "user" | "builtin";
	bucket: RuleBucket;
}

export interface RuleDiagnostic {
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface RuleSet {
	/** Bodies injected into the system prompt. */
	always: Rule[];
	/** Listed by name and description; bodies read on demand. */
	book: Rule[];
	/** Watched against the output stream. */
	stream: Rule[];
	diagnostics: RuleDiagnostic[];
}

export const EMPTY_RULE_SET: RuleSet = { always: [], book: [], stream: [], diagnostics: [] };
